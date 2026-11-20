// Messages are taken from the frame's own view only (contracts/frame.md); site views sit under the bars, never above.
import { app, BaseWindow, WebContentsView, ipcMain, Menu, nativeTheme, nativeImage, Notification, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseAddress, nameError, shortKey, upsert, move, remove, checkShare, gb, joinError, inviteRows, invitedLine, storageText, totalText } from './model.js'
import { startTray, hasTray } from './tray.js'

/**
 * @typedef {import('electron').WebContents} WebContents
 * @typedef {import('electron').WebContentsView} View
 * @typedef {import('./model.js').Icon} Icon
 * @typedef {import('./ui/frame.js').FrameState} FrameState
 * @typedef {import('./ui/frame.js').NotifyState} NotifyState
 * @typedef {import('./ui/frame.js').Note} Note
 * @typedef {{ code?: string, message: string }} Thrown An engine's error, or any Error.
 * @typedef {object} SiteView A site's view, open (main.js openSite()).
 * @property {string} key the site's key (the app's, for an instance)
 * @property {string | null} [instance]
 * @property {import('../engine/manifest.js').Manifest} manifest
 * @property {View} view
 * @property {WebContents} webContents
 * @property {() => void} close
 * @typedef {object} Side A preview docked beside a tab.
 * @property {string} key
 * @property {boolean} pending
 * @property {View} [view]
 * @property {WebContents} [wc]
 * @property {() => void} [close]
 * @property {View} [handle] the line between the two, a view of its own
 * @property {boolean} [dragging]
 * @typedef {object} Tab
 * @property {number} id 0: the desktop
 * @property {string | null} key
 * @property {string} [site] the app's key, for an instance's tab
 * @property {string} [name] the name@authority it was opened by
 * @property {string} title
 * @property {'opening' | 'ready' | 'error'} status
 * @property {string | null} [icon]
 * @property {string} [error]
 * @property {View} [view]
 * @property {WebContents} [wc]
 * @property {() => void} [close]
 * @property {boolean} [canBack]
 * @property {boolean} [canForward]
 * @property {boolean} [loading]
 * @property {{ complete: boolean, peers: number }} [state]
 * @property {{ bytes: number, kept: boolean }} [held]
 * @property {Side | null} [side]
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HANDLE = 6
const SPLIT_MIN = 240
const POLL = 2000
const HELD = 10000 // site.held reads every file record of the site: every 10 s, not every poll
/** @type {Set<unknown>} */
const KINDS = new Set(['installed', 'bookmark'])
/** @type {Set<unknown>} */
const THEMES = new Set(['system', 'light', 'dark'])
/** @type {Set<unknown>} */
const ACCENTS = new Set(['#1f4fd1', '#c2410c', '#0b7a52'])
const DEV = !app.isPackaged
const NOTICE = 'HyperBrowser keeps running in the tray to host your sites; turn this off in HyperBrowser ▾'
const CIRCLES = new Set(['circles.list', 'circles.members', 'circles.invite', 'circles.rename', 'circles.setRole', 'circles.remove', 'circles.leave', 'holding.get', 'holding.set'])

// Sent to the frame as SVG paths (one 1×1 run a row), so they keep currentColor.
export function readGlyphs (dir = path.join(HERE, 'icons')) {
  /** @type {Record<string, { width: number, height: number, d: string }>} */
  const glyphs = {}
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
    const img = nativeImage.createFromPath(path.join(dir, f))
    const { width, height } = img.getSize()
    const px = img.toBitmap() // BGRA
    /** @param {number} x @param {number} y */
    const ink = (x, y) => { const i = (y * width + x) * 4; return px[i + 3] >= 128 && px[i] + px[i + 1] + px[i + 2] < 384 }
    let d = ''
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!ink(x, y)) continue
        let w = 1
        while (x + w < width && ink(x + w, y)) w++
        d += `M${x} ${y}h${w}v1H${x}z`
        x += w
      }
    }
    glyphs[f.slice(0, -4)] = { width, height, d }
  }
  return glyphs
}

/**
 * The window: the frame page (tabs, address bar, desktop, menus) over the site views.
 * @param {object} opts
 * @param {Pick<import('../engine/protocol.js').Rpc, 'request'>} opts.rpc
 * @param {(key: string, query?: string) => Promise<SiteView>} opts.openSite
 * @param {(key: string, manifest: import('../engine/manifest.js').Manifest) => Promise<string | null>} opts.readIcon
 * @param {string | null} opts.identity
 * @param {string} opts.file shell.json
 * @param {string | null} [opts.open] a key to open at once
 * @param {() => string | null} [opts.update] the version an update has ready
 * @param {(() => void) | null} [opts.restart]
 * @param {((code: string) => void) | null} [opts.join] join another device's identity
 * @param {(wc: WebContents) => Promise<string | null>} [opts.readViewed] marks the place the page shows read
 * @param {string | null} [opts.contacts] the Contacts app's key
 */
export function startFrame ({ rpc, openSite, readIcon, identity, file, open = null, update = () => null, restart = null, join = null, readViewed = async () => null, contacts = null }) {
  /** @type {FrameState['joined']} */
  let joined = null
  /** @type {Icon[]} */
  const preset = JSON.parse(fs.readFileSync(path.join(HERE, 'preset.json'), 'utf-8'))
  let data = load()
  const glyphs = readGlyphs()
  nativeTheme.themeSource = data.settings.theme
  Menu.setApplicationMenu(null) // no File/Edit/View: copy, paste and undo still work in pages (Windows, Linux)
  const win = new BaseWindow({ width: 1280, height: 820, minWidth: 560, minHeight: 360, frame: false, title: 'HyperBrowser', backgroundColor: '#ffffff' })
  const frame = new WebContentsView({
    webPreferences: { preload: path.join(HERE, 'frame-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const fwc = frame.webContents
  frame.setBackgroundColor('#00000000')
  fwc.setWindowOpenHandler(() => ({ action: 'deny' }))
  fwc.on('will-navigate', (e) => e.preventDefault())
  fwc.loadFile(path.join(HERE, 'ui', 'index.html'))
  win.contentView.addChildView(frame)

  /** @type {Tab[]} */
  const tabs = [{ id: 0, key: null, title: 'Desktop', status: 'ready' }]
  let current = 0
  let nextId = 1
  let bars = 68 // the frame measures itself and says (op 'bars')
  let cover = false
  /** @type {NotifyState} */
  let notes = { items: [], unread: { total: 0, byApp: {}, byPlace: {} }, apps: [] }
  /** @type {Map<string, Notification>} */
  const popups = new Map()
  let popupsShown = 0
  /** The current tab: there always is one (the desktop is never closed). */
  const now = () => /** @type {Tab} */ (tabOf(current))

  /** @returns {{ desktop: { icons: Icon[] }, settings: FrameState['settings'] }} */
  function load () {
    /** @type {any} */
    let saved = null // shell.json as written by any version: each field checked below
    try { saved = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch {}
    /** @type {Icon[] | null} */
    let icons = Array.isArray(saved?.desktop?.icons) ? saved.desktop.icons : null
    if (!icons) icons = preset.reduce((all, p) => upsert(all, { ...p, id: p.key || p.id }), /** @type {Icon[]} */ ([]))
    for (const p of preset) if (p.key && /** @type {Icon[]} */ (icons).some((i) => i.id === p.id)) icons = upsert(/** @type {Icon[]} */ (icons), { id: p.key, key: p.key }, p.id)
    const s = saved?.settings || {}
    return {
      desktop: { icons },
      settings: { theme: THEMES.has(s.theme) ? s.theme : 'system', accent: ACCENTS.has(s.accent) ? s.accent : '#1f4fd1', tray: s.tray !== false, trayNoticed: !!s.trayNoticed, circleNoticed: !!s.circleNoticed,
        split: typeof s.split === 'number' && s.split >= 0.1 && s.split <= 0.9 ? s.split : 0.55 }
    }
  }

  function save () {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
      fs.renameSync(file + '.tmp', file)
    } catch (err) {
      console.error('could not save the desktop:', /** @type {Error} */ (err).message)
    }
  }

  /** @param {unknown} id */
  const tabOf = (id) => tabs.find((t) => t.id === id)
  /** @param {string | null | undefined} key */
  const iconOf = (key) => data.desktop.icons.find((i) => i.key === key)

  /** @returns {FrameState} */
  function snapshot () {
    const tab = tabOf(current)
    return {
      current,
      tabs: tabs.map((t) => ({
        id: t.id, key: t.key, name: t.name || null, short: t.key ? shortKey(t.key) : '', title: t.title, icon: t.icon || null, status: t.status,
        error: t.error || null, canBack: !!t.canBack, canForward: !!t.canForward, loading: !!t.loading, state: t.state || null, held: t.held || null,
        kind: t.key ? iconOf(t.key)?.kind || null : null
      })),
      desktop: data.desktop,
      settings: data.settings,
      notes,
      identity,
      joined,
      version: app.getVersion(),
      update: update(),
      open: tabs.length - 1,
      ready: !!tab?.view,
      maximized: win.isMaximized()
    }
  }

  function push () {
    if (!fwc.isDestroyed()) fwc.send('frame-state', snapshot())
  }

  function layout () {
    if (win.isDestroyed()) return
    const { width, height } = win.getContentBounds()
    const tab = now()
    for (const t of tabs) if (t.view) t.view.setVisible(t === tab)
    for (const t of tabs) if (t.side?.view) t.side.view.setVisible(t === tab)
    for (const t of tabs) if (t.side?.handle) t.side.handle.setVisible(t === tab)
    const h = Math.max(0, height - bars)
    const main = tab.side ? splitAt(width) : width
    if (tab.view) tab.view.setBounds({ x: 0, y: bars, width: main, height: h })
    if (tab.side?.view) tab.side.view.setBounds({ x: main, y: bars, width: width - main, height: h })
    const handle = tab.side?.handle
    if (tab.side && handle) { // a strip over the line; while dragged, over both views, so the pointer never leaves it
      handle.setBounds(tab.side.dragging ? { x: 0, y: bars, width, height: h } : { x: main - HANDLE / 2, y: bars, width: HANDLE, height: h })
      if (!handle.webContents.isDestroyed()) handle.webContents.send('split-at', { at: tab.side.dragging ? main - HANDLE / 2 : 0, value: Math.round(100 * main / width) })
    }
    frame.setBounds({ x: 0, y: 0, width, height: cover || !tab.view ? height : bars })
  }

  /** @param {unknown} id */
  function select (id) {
    if (!tabOf(id)) return
    current = /** @type {number} */ (id)
    layout()
    push()
    const tab = now()
    if (tab.wc && !cover) tab.wc.focus()
    looked()
  }

  async function refresh () {
    const s = await rpc.request('notify.state').catch(() => null)
    if (!s) return
    notes = s
    if (tray) tray.mark(notes.unread.total)
    push()
  }

  // Believed only while that tab is current and the window focused.
  const viewingNow = () => win.isFocused() && now().wc ? now().wc : null
  /** @type {string | null} */
  let lookedPlace = null
  async function looked () {
    const wc = viewingNow()
    lookedPlace = wc ? await readViewed(wc) : null
    if (lookedPlace) refresh()
  }

  /** @param {{ items: Note[], summary: { count: number } | null }} told the engine's notify event */
  async function notify ({ items, summary }) {
    await looked() // what the person looks at is read before it is counted
    await refresh()
    const fresh = items.filter((x) => x.place !== lookedPlace && x.popup !== false)
    if (!fresh.length || !Notification.isSupported()) return
    /** @param {Note} x */
    const title = (x) => (notes.apps.find((a) => a.key === x.app)?.title || 'HyperBrowser')
    /** @param {string} place @param {string} head @param {string} body @param {Note | null} item */
    const show = (place, head, body, item) => {
      popups.get(place)?.close()
      const n = new Notification({ title: head, body, silent: false })
      n.on('click', () => { showWindow(); if (item) openItem(item) })
      n.on('close', () => { if (popups.get(place) === n) popups.delete(place) })
      n.show()
      popups.set(place, n)
      popupsShown++
    }
    if (summary) return show('*', 'HyperBrowser', summary.count + ' new notifications', null)
    /** @type {Map<string, Note[]>} */
    const byPlace = new Map()
    for (const x of fresh) byPlace.set(x.place, [...(byPlace.get(x.place) || []), x])
    for (const [place, list] of byPlace) {
      const x = list[0]
      const shown = notes.items.find((i) => i.id === x.id) || x
      const who = shown.name || shortKey(shown.author)
      show(place, title(x) + ': ' + who, (shown.text || 'New message') + (list.length > 1 ? ` (+${list.length - 1})` : ''), x)
    }
  }

  /** @param {Note} x */
  function openItem (x) {
    if (x.app === 'contacts') return contacts ? openKey(contacts, '?person=' + x.author) : null
    openKey(x.place, x.open || '')
    rpc.request('notify.read', { place: x.place }).then(refresh, () => {})
  }

  /** @param {unknown} id */
  function closeTab (id) {
    const i = tabs.findIndex((t) => t.id === id)
    if (i <= 0) return
    const [tab] = tabs.splice(i, 1)
    undock(tab)
    if (tab.view) {
      win.contentView.removeChildView(tab.view)
      tab.close?.()
    }
    if (current === id) current = tabs[i - 1].id
    layout()
    push()
  }

  /** @param {WebContents} wc @param {string} key */
  function dock (wc, key) {
    const tab = tabs.find((t) => t.wc === wc)
    if (!tab) return false
    // A (re)load of the preview must not take the keyboard from the IDE: give it back, while loading and 300ms after.
    const had = wc.isFocused()
    /** @param {Side & { wc: WebContents }} side */
    const keep = (side) => {
      if (!had) return
      let done = false
      const back = () => { if (!done && !wc.isDestroyed() && !wc.isFocused()) wc.focus() }
      const stop = () => { done = true; if (!side.wc.isDestroyed()) side.wc.removeListener('focus', back) }
      side.wc.on('focus', back)
      side.wc.once('did-finish-load', () => { back(); setTimeout(stop, 300) })
      setTimeout(stop, 10000) // a load that never ends
    }
    if (tab.side?.key === key) {
      if (tab.side.wc) keep(/** @type {Side & { wc: WebContents }} */ (tab.side))
      tab.side.wc?.reload()
      return true
    }
    undock(tab)
    /** @type {Side} */
    const side = { key, pending: true }
    tab.side = side
    openSite(key).then((v) => {
      if (tab.side !== side || !tabs.includes(tab)) return v.close()
      const open = Object.assign(side, { view: v.view, wc: v.webContents, close: v.close, pending: false })
      keep(open)
      const handle = side.handle = new WebContentsView({ webPreferences: { preload: path.join(HERE, 'split-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
      handle.setBackgroundColor('#00000000')
      handle.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      handle.webContents.on('will-navigate', (e) => e.preventDefault())
      handle.webContents.loadFile(path.join(HERE, 'ui', 'split.html'))
      handle.webContents.on('before-input-event', (e, input) => { if (keys(input, handle.webContents)) e.preventDefault() })
      handle.webContents.once('did-finish-load', layout)
      win.contentView.addChildView(v.view)
      win.contentView.addChildView(handle)
      win.contentView.addChildView(frame) // on top of every site
      layout()
    }, () => { if (tab.side === side) tab.side = null })
    return true
  }

  /** @param {Tab | undefined} tab */
  function undock (tab) {
    const side = tab?.side
    if (!side) return false
    tab.side = null
    if (side.view) {
      win.contentView.removeChildView(side.view)
      side.close?.()
    }
    if (side.handle) {
      win.contentView.removeChildView(side.handle)
      side.handle.webContents.close()
    }
    layout()
    return true
  }

  /** @param {number} width */
  function splitAt (width) {
    if (width < 2 * SPLIT_MIN) return Math.round(width / 2)
    return Math.min(width - SPLIT_MIN, Math.max(SPLIT_MIN, Math.round(width * data.settings.split)))
  }

  /** @param {number} px @param {number} width */
  function setSplit (px, width) {
    const at = width < 2 * SPLIT_MIN ? width / 2 : Math.min(width - SPLIT_MIN, Math.max(SPLIT_MIN, px))
    data.settings.split = Math.min(0.9, Math.max(0.1, at / width))
    layout()
  }

  ipcMain.on('split', (evt, msg) => {
    const tab = tabs.find((t) => t.side?.handle?.webContents === evt.sender)
    if (!tab?.side || !msg || typeof msg !== 'object') return
    const { width } = win.getContentBounds()
    const now = splitAt(width)
    if (msg.op === 'start') { tab.side.dragging = true; layout() }
    if (msg.op === 'move' && tab.side.dragging && Number.isFinite(msg.x)) setSplit(Math.round(msg.x), width)
    if (msg.op === 'end') { tab.side.dragging = false; layout(); save() }
    if (msg.op === 'key' && Number.isFinite(msg.step)) { setSplit(now + Math.max(-100, Math.min(100, msg.step)) * 24, width); save() }
    if (msg.op === 'leave') tab.wc?.focus()
  })

  /** @param {unknown} input @returns {{ result?: number, error?: { code: string, message: string } }} */
  function openKey (input, query = '') {
    const a = parseAddress(input)
    if (a.error) return { error: { code: 'INVALID_KEY', message: a.error } }
    if (a.name) return openName(a.name, query)
    const key = /** @type {string} */ (a.key) // neither an error nor a name
    const have = tabs.find((t) => t.key === key)
    if (have) {
      const at = have.key !== have.site ? '?instance=' + have.key + (query.startsWith('#') ? query : '') : query
      if (query && have.wc) have.wc.loadURL('hyper://' + have.site + '/' + at)
      select(have.id)
      show()
      return { result: have.id }
    }
    /** @type {Tab} */
    const tab = { id: nextId++, key, title: shortKey(key), status: 'opening', icon: iconOf(key)?.icon }
    tabs.push(tab)
    select(tab.id)
    show()
    loadTab(tab, key, query)
    return { result: tab.id }
  }

  /** @param {string} name @param {string} query */
  function openName (name, query) {
    const have = tabs.find((t) => t.name === name)
    if (have) {
      select(have.id)
      show()
      return { result: have.id }
    }
    /** @type {Tab} */
    const tab = { id: nextId++, key: null, name, title: name, status: 'opening' }
    tabs.push(tab)
    select(tab.id)
    show()
    rpc.request('names.resolve', { address: name }).then((/** @type {{ key: string }} */ { key }) => {
      if (!tabs.includes(tab)) return
      const open = tabs.find((t) => t !== tab && t.key === key)
      if (open) {
        open.name = name
        closeTab(tab.id)
        select(open.id)
        show()
        return
      }
      tab.key = key
      tab.icon = iconOf(key)?.icon
      push()
      loadTab(tab, key, query)
    }, (err) => {
      if (!tabs.includes(tab)) return
      tab.status = 'error'
      tab.error = nameError(err)
      push()
    })
    return { result: tab.id }
  }

  /** @param {Tab} tab @param {string} key @param {string} query */
  function loadTab (tab, key, query) {
    openSite(key, query).then((v) => {
      if (!tabs.includes(tab)) return v.close() // closed while opening
      Object.assign(tab, { key: v.instance || v.key, site: v.key, title: v.manifest.title, status: 'ready', view: v.view, wc: v.webContents, close: v.close })
      const sync = () => {
        // canGoBack() answers false here while there is a page to go back to (Electron 42, Windows)
        tab.canBack = v.webContents.navigationHistory.canGoToOffset(-1)
        tab.canForward = v.webContents.navigationHistory.canGoToOffset(1)
        tab.loading = v.webContents.isLoading()
        push()
      }
      for (const e of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) v.webContents.on(/** @type {'did-navigate'} */ (e), sync) // sync reads no argument: any of these events
      v.webContents.on('before-input-event', (e, input) => { if (keys(input, v.webContents)) e.preventDefault() })
      win.contentView.addChildView(v.view)
      win.contentView.addChildView(frame) // added again: on top of every site
      if (current === tab.id) select(tab.id)
      else layout()
      poll()
      readIcon(v.key, v.manifest).then((icon) => {
        tab.icon = icon
        const known = iconOf(v.key)
        if (known) {
          data.desktop.icons = upsert(data.desktop.icons, { id: known.id, title: v.manifest.title, icon })
          save()
        }
        push()
      }, () => {})
    }, (err) => {
      if (!tabs.includes(tab)) return
      tab.status = 'error'
      tab.error = (err.code === 'NOT_FOUND' || err.code === 'NO_MANIFEST' ? 'This key is not a site, or it has no site.json.' : 'Could not reach this site: nobody serving it was found.') + ' (' + (err.code || 'ERROR') + ')'
      push()
    })
  }

  /** @param {number} offset */
  function go (offset) {
    const h = now().wc?.navigationHistory
    if (h?.canGoToOffset(offset)) h.goToOffset(offset)
  }

  // The few keys the frame answers even while a site has the focus (there is no app menu to give them).
  /** @param {import('electron').Input} input @param {WebContents} wc */
  function keys (input, wc) {
    if (input.type !== 'keyDown') return false
    const mod = input.control || input.meta
    if (DEV && (input.key === 'F12' || (mod && input.shift && input.key.toLowerCase() === 'i'))) { wc.toggleDevTools(); return true }
    if (mod && input.key.toLowerCase() === 't') { select(0); fwc.focus(); fwc.send('frame-focus'); return true }
    if (mod && input.key.toLowerCase() === 'l') { fwc.focus(); fwc.send('frame-focus'); return true }
    if (mod && input.key.toLowerCase() === 'w') { closeTab(current); return true }
    if (input.control && input.key === 'Tab') {
      const i = tabs.findIndex((t) => t.id === current)
      select(tabs[(i + (input.shift ? -1 : 1) + tabs.length) % tabs.length].id)
      return true
    }
    if (input.key === 'F5' || (mod && input.key.toLowerCase() === 'r')) { now().wc?.reload(); return true }
    const line = now().side?.handle
    if (input.key === 'F6' && line && wc !== line.webContents) { line.webContents.focus(); return true }
    if (input.alt && input.key === 'ArrowLeft') { go(-1); return true }
    if (input.alt && input.key === 'ArrowRight') { go(1); return true }
    return false
  }

  let polling = false
  let heldAt = 0
  async function poll (held = Date.now() - heldAt >= HELD) {
    if (polling) return
    polling = true
    if (held) heldAt = Date.now()
    try {
      for (const t of tabs.filter((t) => t.view)) {
        const s = await rpc.request('site.state', { key: t.site }).catch(() => null)
        if (s) t.state = s
        const h = held && await rpc.request('site.held', { key: t.site }).catch(() => null)
        if (h) t.held = h
      }
    } finally {
      polling = false
    }
    push()
  }
  const timer = setInterval(poll, POLL)

  // `kept` means the engine confirmed it, so a site that couldn't be reached is tried again at the next launch.
  /** @param {string} key @param {boolean} on */
  function keepSite (key, on) {
    rpc.request('site.open', { key })
      .then((/** @type {{ key: string }} */ { key: site }) => rpc.request('site.keep', { key: site, keep: on, timeout: 30000 }).then(() => site).finally(() => rpc.request('site.close', { key: site }).catch(() => {})))
      .then((site) => {
        const icon = iconOf(key)
        if (icon && (icon.kind === 'installed') === on) setIcons(upsert(data.desktop.icons, { id: icon.id, kept: on, site }))
        heldAt = 0
        poll()
      }, (/** @type {Error} */ err) => console.error('could not ' + (on ? 'install ' : 'uninstall ') + key + ':', err.message))
  }

  async function follow () {
    const r = await rpc.request('site.installed').catch(() => null)
    if (!r) return
    for (const s of /** @type {Array<{ key: string, title: string }>} */ (r.sites)) {
      const icon = data.desktop.icons.find((i) => i.key === s.key || i.site === s.key)
      if (icon?.kind === 'installed') continue
      setIcons(upsert(data.desktop.icons, { id: icon?.id || s.key, key: s.key, title: icon?.title || s.title || shortKey(s.key), kind: 'installed' }))
      keepSite(icon?.key || s.key, true)
    }
    for (const i of data.desktop.icons) {
      if (i.kind !== 'installed' || !i.kept || !r.uninstalled.includes(i.site || i.key)) continue
      setIcons(upsert(data.desktop.icons, { id: i.id, kind: 'bookmark' }))
      keepSite(/** @type {string} */ (i.key), false) // kept: it has a key
    }
  }
  const following = setInterval(follow, HELD)

  /**
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<{ result?: any, error?: { code: string, message: string } }>} the result is that method's
   */
  const engine = (method, params) => rpc.request(method, params).then((result) => ({ result }), (/** @type {Thrown} */ err) => ({ error: { code: err.code || 'ERROR', message: err.message } }))

  async function circleNotice () {
    if (data.settings.circleNoticed) return true
    const h = await rpc.request('holding.get').catch(() => ({ bytes: 1e9 }))
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['OK', 'Not now'], defaultId: 0, cancelId: 1, message: 'Keep copies for your circle?',
      detail: `Your computer will keep copies of your circle's conversations and boards (up to ${gb(h.bytes)}), so they stay reachable while their people are offline. It can't read private ones. Holders see how many spaces each member has, their sizes, when they change, and your IP address. Members see each computer's share and how much it holds.`
    })
    if (r.response !== 0) return false
    data.settings.circleNoticed = true
    save()
    return true
  }

  // The name comes from the page, so the question says so. A pasted link needs no question: pasting was the yes.
  /** @param {string} link @param {string | null} name the page's word for it @param {{ pasted?: boolean }} [opts] */
  async function joinCircle (link, name, { pasted = false } = {}) {
    if (!pasted) show()
    const named = name ? `"${name.slice(0, 64)}"` : 'this circle'
    const first = !data.settings.circleNoticed
    if (first ? !(await circleNotice()) : !pasted && (await dialog.showMessageBox(win, { type: 'question', buttons: ['Join', 'Cancel'], defaultId: 0, cancelId: 1, message: `Join ${named}?`, detail: 'Your computer will keep copies of its people\'s conversations and boards. The name comes from the invite: you see the real one once in.' })).response !== 0) return { joined: false }
    try {
      const c = await rpc.request('circles.join', { link })
      if (!pasted && !fwc.isDestroyed()) fwc.send('frame-circles', { open: true, note: `You joined "${c.name}".` })
      return { joined: true, name: c.name }
    } catch (e) {
      const err = /** @type {Thrown} */ (e)
      if (pasted) return { joined: false, error: joinError(err) }
      await dialog.showMessageBox(win, { type: 'warning', message: 'Could not join', detail: joinError(err) })
      return { joined: false }
    }
  }

  /** @param {string} key */
  async function invitees (key) {
    const [friends, members] = await Promise.all([rpc.request('contacts.list'), rpc.request('circles.members', { key })])
    return inviteRows(friends, members)
  }
  // One at a time: each makes an invite in the circle.
  /** @param {string} key @param {unknown} friends the frame's */
  async function inviteContacts (key, friends) {
    /** @type {Array<{ name: string, error?: string }>} */
    const results = []
    for (const f of Array.isArray(friends) ? friends : []) {
      const error = await rpc.request('contacts.inviteToCircle', { identity: f.identity, circle: key }).then(() => undefined, (/** @type {Error} */ err) => err.message)
      results.push({ name: String(f.name), error })
    }
    return invitedLine(results)
  }

  /** @param {unknown} name */
  async function createCircle (name) {
    if (!(await circleNotice())) return { result: null }
    return engine('circles.create', { name })
  }

  /** @param {Icon[]} icons */
  function setIcons (icons) {
    data.desktop.icons = icons
    save()
    push()
  }

  /**
   * @param {string} op
   * @param {Record<string, any>} [a] the frame's args: checked per op
   */
  function handle (op, a = {}) {
    const tab = now()
    switch (op) {
      case 'hello': return { result: snapshot() }
      case 'glyphs': return { result: glyphs }
      case 'open': return openKey(a.input)
      case 'select': select(a.id); return { result: true }
      case 'close': closeTab(a.id); return { result: true }
      case 'back': go(-1); return { result: true }
      case 'forward': go(1); return { result: true }
      case 'reload': tab.wc?.reload(); return { result: true }
      case 'bookmark': {
        if (!tab.key || tab.status !== 'ready') return { result: false }
        const icon = iconOf(tab.key)
        if (icon?.kind === 'installed') return { result: false } // ☆ never removes an installed site
        setIcons(icon ? remove(data.desktop.icons, icon.id) : upsert(data.desktop.icons, { id: tab.key, key: tab.key, title: tab.title, icon: tab.icon || null, kind: 'bookmark' }))
        return { result: !icon }
      }
      case 'icon.open': {
        const icon = data.desktop.icons.find((i) => i.id === a.id)
        if (!icon) return { error: { code: 'NOT_FOUND', message: 'no such icon' } }
        if (!icon.key) return { error: { code: 'NOT_PUBLISHED', message: icon.title + ' is not published yet.' } }
        return openKey(icon.key)
      }
      case 'icon.move': setIcons(move(data.desktop.icons, a.id, a.col, a.row)); return { result: true }
      case 'icon.kind': {
        const icon = data.desktop.icons.find((i) => i.id === a.id)
        if (!KINDS.has(a.kind) || !icon) return { error: { code: 'INVALID_PARAMS', message: 'installed or bookmark' } }
        setIcons(upsert(data.desktop.icons, { id: a.id, kind: a.kind }))
        if (icon.key && icon.kind !== a.kind) keepSite(icon.key, a.kind === 'installed')
        return { result: true }
      }
      case 'icon.remove': {
        const icon = data.desktop.icons.find((i) => i.id === a.id)
        setIcons(remove(data.desktop.icons, a.id))
        if (icon?.key && icon.kept) keepSite(icon.key, false)
        return { result: true }
      }
      case 'settings':
        if (THEMES.has(a.theme)) nativeTheme.themeSource = data.settings.theme = a.theme
        if (ACCENTS.has(a.accent)) data.settings.accent = a.accent
        if (typeof a.tray === 'boolean') { data.settings.tray = a.tray; setTray() }
        save()
        push()
        return { result: true }
      case 'restart': if (restart && update()) restart(); return { result: true }
      case 'devices': return engine('devices.list')
      case 'devices.add': return engine('devices.add', { password: a.password || undefined })
      case 'devices.remove': return engine('devices.remove', { publicKey: a.publicKey, password: a.password || undefined })
      case 'devices.phrase': return engine('devices.phrase', { password: a.password || undefined })
      case 'devices.protect': return engine('devices.protect', { password: a.password })
      case 'devices.join':
        if (!join || typeof a.code !== 'string' || !a.code.trim()) return { error: { code: 'INVALID_PARAMS', message: 'Paste the code first.' } }
        join(a.code.trim())
        return { result: true }
      case 'cover': cover = !!a.full; layout(); return { result: true }
      case 'circles.create': return createCircle(a.name)
      case 'circles.invitees': return invitees(a.key).then((result) => ({ result }), (/** @type {Thrown} */ err) => ({ error: { code: err.code || 'ERROR', message: err.message } }))
      case 'circles.inviteContacts': return inviteContacts(a.key, a.friends).then((result) => ({ result }))
      case 'circles.join': return joinCircle(typeof a.link === 'string' ? a.link.trim() : '', null, { pasted: true }).then((result) => ({ result }))
      case 'share.check': return rpc.request('holding.get').then((h) => { const r = checkShare(a.text, h); return r.error ? { error: { code: 'INVALID_PARAMS', message: r.error } } : { result: r } }, (/** @type {Thrown} */ err) => ({ error: { code: err.code || 'ERROR', message: err.message } }))
      case 'notify.open': {
        const x = notes.items.find((i) => i.id === a.id)
        if (!x) return { error: { code: 'NOT_FOUND', message: 'no such notification' } }
        openItem(x)
        return { result: true }
      }
      case 'notify.set':
        return rpc.request('notify.set', { app: a.app, allow: a.allow, hide: a.hide, place: a.place, mute: a.mute })
          .then(() => refresh()).then(() => ({ result: true }), (/** @type {Thrown} */ err) => ({ error: { code: err.code || 'ERROR', message: err.message } }))
      case 'window':
        if (a.act === 'minimize') win.minimize()
        else if (a.act === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
        else if (a.act === 'close') win.close()
        return { result: true }
      case 'bars':
        if (Number.isFinite(a.height) && a.height > 0 && a.height < 400) bars = Math.ceil(a.height)
        layout()
        return { result: true }
      case 'circles.members': return engine(op, a).then((r) => (r.result ? { result: r.result.map((/** @type {{ share: number | null, used: number | null }} */ m) => ({ ...m, held: storageText(m) })) } : r))
      case 'circles.list': return engine(op, a).then((r) => (r.result ? { result: r.result.map((/** @type {import('../engine/circles.js').Circle} */ c) => ({ ...c, totalLine: totalText(c.total) })) } : r))
      default: return CIRCLES.has(op) ? engine(op, a) : { error: { code: 'UNKNOWN_METHOD', message: 'unknown op ' + op } }
    }
  }

  ipcMain.handle('frame', (evt, msg) => {
    if (evt.sender !== fwc) return { error: { code: 'NOT_ALLOWED', message: 'not the frame' } }
    try {
      return handle(msg?.op, msg?.args || {})
    } catch (e) {
      const err = /** @type {Thrown} */ (e)
      return { error: { code: err.code || 'ERROR', message: err.message } }
    }
  })
  fwc.on('before-input-event', (e, input) => { if (DEV && input.type === 'keyDown' && (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'))) { e.preventDefault(); fwc.toggleDevTools() } })

  // Hidden to the tray, its views kept (Chromium throttles hidden pages). Quit destroys it: window-all-closed then stops the engine.
  /** @type {ReturnType<typeof startTray> | null} */
  let tray = null
  let notices = 0
  const TRAY = hasTray()
  function setTray () {
    if (data.settings.tray && TRAY && !tray) { tray = startTray({ rpc, show, quit: () => win.destroy() }); tray.mark(notes.unread.total) }
    else if (!data.settings.tray && tray) { tray.destroy(); tray = null }
  }
  function show () {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  win.on('close', (e) => {
    if (!tray) return
    e.preventDefault()
    win.hide()
    if (data.settings.trayNoticed) return
    data.settings.trayNoticed = true
    save()
    notices++
    tray.notice(NOTICE)
  })
  setTray()

  const showWindow = show
  win.on('focus', looked)
  win.on('resize', layout)
  win.on('maximize', push)
  win.on('unmaximize', push)
  win.on('closed', () => {
    clearInterval(timer)
    clearInterval(following)
    if (tray) tray.destroy()
    ipcMain.removeHandler('frame')
    ipcMain.removeAllListeners('split')
    for (const t of tabs) if (t.close) t.close()
  })
  layout()

  // an install (or uninstall) the engine never confirmed: again (a site unreachable then, a desktop from an older version)
  for (const i of data.desktop.icons) if (i.key && !!i.kept !== (i.kind === 'installed')) keepSite(i.key, i.kind === 'installed')
  if (open) openKey(open)
  follow()
  refresh()
  const side = () => now().side
  const inspect = () => ({ bars, frame: frame.getBounds(), views: tabs.filter((t) => t.view).map((t) => /** @type {View} */ (t.view).getBounds()),
    wcs: tabs.filter((t) => t.wc).map((t) => /** @type {WebContents} */ (t.wc)), side: side()?.view?.getBounds() || null, handle: side()?.handle || null, sideWc: side()?.wc || null, split: data.settings.split, ready: tabs.filter((t) => t.status === 'ready').length - 1, fwc, tray, notices, settings: data.settings, popups: popupsShown })
  const devices = () => { if (!fwc.isDestroyed()) fwc.send('frame-devices') }
  const circlesChanged = () => { if (!fwc.isDestroyed()) fwc.send('frame-circles', {}) }
  // Another engine, maybe another identity: the open tabs were the old engine's.
  /** @param {{ identity: string, said: string }} p */
  function joinedNow ({ identity: id, said }) {
    identity = id
    joined = { said, n: (joined?.n || 0) + 1 }
    for (const t of tabs.slice(1)) closeTab(t.id)
    setIcons(data.desktop.icons.map((i) => ({ ...i, kept: false })))
    for (const i of data.desktop.icons) if (i.key && i.kind === 'installed') keepSite(i.key, true)
    follow()
  }
  /** @param {string} key */
  const installed = (key) => data.desktop.icons.some((i) => (i.key === key || i.site === key) && i.kind === 'installed')
  /** @param {string} key @param {string} title */
  function install (key, title) {
    const icon = iconOf(key)
    setIcons(upsert(data.desktop.icons, { id: icon?.id || key, key, title: icon?.title || title, kind: 'installed' }))
    keepSite(key, true)
  }
  return { win, inspect, show, devices, circles: circlesChanged, joinCircle, joined: joinedNow, open: openKey, installed, install, notify: (/** @type {Parameters<typeof notify>[0]} */ d) => notify(d).catch(() => {}),
    notice: (/** @type {string} */ text) => { if (tray) tray.notice(text); else if (Notification.isSupported()) new Notification({ title: 'HyperBrowser', body: text }).show() }, looked: () => looked().catch(() => {}), dock, undock: (/** @type {WebContents} */ wc) => undock(tabs.find((t) => t.wc === wc)) }
}
