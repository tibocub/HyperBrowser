// The frame (spec 002): the window, the tabs, and the one trusted view HyperBrowser draws itself (top bar,
// taskbar, toolbar, desktop, menus: shell/ui/). Site views sit under the bars and never above the frame;
// the frame covers the whole window on the desktop tab, while a tab has no page yet, and while a menu is
// open (transparent over the site). Its messages are taken from its own view only (contracts/frame.md).
// No OS frame and no app menu: the taskbar row is the title bar (drag, double-click, our window buttons).
import { app, BaseWindow, WebContentsView, ipcMain, Menu, nativeTheme, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseAddress, shortKey, upsert, move, remove } from './model.js'
import { startTray, hasTray } from './tray.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const POLL = 2000
const HELD = 10000 // site.held reads every file record of the site: every 10 s, not every poll
const KINDS = new Set(['installed', 'bookmark'])
const THEMES = new Set(['system', 'light', 'dark'])
const ACCENTS = new Set(['#1f4fd1', '#c2410c', '#0b7a52'])
const DEV = !app.isPackaged // devtools: F12, Ctrl+Shift+I
const NOTICE = 'HyperBrowser keeps running in the tray to host your sites; turn this off in HyperBrowser ▾'

// The frame's pixel icons (spec 008): one PNG a glyph in shell/icons/, dark pixels are the glyph (white or
// transparent around). Sent to the frame as SVG paths, one 1×1 run a row, so they keep currentColor.
export function readGlyphs (dir = path.join(HERE, 'icons')) {
  const glyphs = {}
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
    const img = nativeImage.createFromPath(path.join(dir, f))
    const { width, height } = img.getSize()
    const px = img.toBitmap() // BGRA
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

// openSite(key) → { key, manifest, view, webContents, close }; readIcon(key, manifest) → data URL or null.
// update() → the version an update is ready for, or null; restart() starts it (spec 011).
// join(code): this computer joins another device's identity; then main calls joined() (spec 012).
export function startFrame ({ rpc, openSite, readIcon, identity, file, open = null, update = () => null, restart = null, join = null }) {
  let joined = null // { said, n }: what the last join did, for the Devices window
  const preset = JSON.parse(fs.readFileSync(path.join(HERE, 'preset.json'), 'utf-8'))
  let data = load()
  const glyphs = readGlyphs()
  // the look's theme for every page: the frame and each site's prefers-color-scheme (spec 008)
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

  const tabs = [{ id: 0, key: null, title: 'Desktop', status: 'ready' }]
  let current = 0
  let nextId = 1
  let bars = 68 // the frame measures itself and says (op 'bars')
  let cover = false

  function load () {
    let saved = null
    try { saved = JSON.parse(fs.readFileSync(file, 'utf-8')) } catch {}
    let icons = Array.isArray(saved?.desktop?.icons) ? saved.desktop.icons : null
    if (!icons) icons = preset.reduce((all, p) => upsert(all, { ...p, id: p.key || p.id }), [])
    for (const p of preset) if (p.key && icons.some((i) => i.id === p.id)) icons = upsert(icons, { id: p.key, key: p.key }, p.id)
    const s = saved?.settings || {}
    return {
      desktop: { icons },
      settings: { theme: THEMES.has(s.theme) ? s.theme : 'system', accent: ACCENTS.has(s.accent) ? s.accent : '#1f4fd1', tray: s.tray !== false, trayNoticed: !!s.trayNoticed }
    }
  }

  function save () {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
      fs.renameSync(file + '.tmp', file)
    } catch (err) {
      console.error('could not save the desktop:', err.message)
    }
  }

  const tabOf = (id) => tabs.find((t) => t.id === id)
  const iconOf = (key) => data.desktop.icons.find((i) => i.key === key)

  function snapshot () {
    const tab = tabOf(current)
    return {
      current,
      tabs: tabs.map((t) => ({
        id: t.id, key: t.key, short: t.key ? shortKey(t.key) : '', title: t.title, icon: t.icon || null, status: t.status,
        error: t.error || null, canBack: !!t.canBack, canForward: !!t.canForward, loading: !!t.loading, state: t.state || null, held: t.held || null,
        kind: t.key ? iconOf(t.key)?.kind || null : null
      })),
      desktop: data.desktop,
      settings: data.settings,
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
    const tab = tabOf(current)
    for (const t of tabs) if (t.view) t.view.setVisible(t === tab)
    if (tab.view) tab.view.setBounds({ x: 0, y: bars, width, height: Math.max(0, height - bars) })
    frame.setBounds({ x: 0, y: 0, width, height: cover || !tab.view ? height : bars })
  }

  function select (id) {
    if (!tabOf(id)) return
    current = id
    layout()
    push()
    const tab = tabOf(id)
    if (tab.wc && !cover) tab.wc.focus()
  }

  function closeTab (id) {
    const i = tabs.findIndex((t) => t.id === id)
    if (i <= 0) return
    const [tab] = tabs.splice(i, 1)
    if (tab.view) {
      win.contentView.removeChildView(tab.view)
      tab.close()
    }
    if (current === id) current = tabs[i - 1].id
    layout()
    push()
  }

  // `query`: for the shell's own calls (spec 013: Contacts on one person, '?person=<key>')
  function openKey (input, query = '') {
    const a = parseAddress(input)
    if (a.error) return { error: { code: 'INVALID_KEY', message: a.error } }
    const have = tabs.find((t) => t.key === a.key)
    if (have) {
      if (query && have.wc) have.wc.loadURL('hyper://' + have.site + '/' + query)
      select(have.id)
      show()
      return { result: have.id }
    }
    const tab = { id: nextId++, key: a.key, title: shortKey(a.key), status: 'opening', icon: iconOf(a.key)?.icon }
    tabs.push(tab)
    select(tab.id)
    show()
    openSite(a.key, query).then((v) => {
      if (!tabs.includes(tab)) return v.close() // closed while opening
      // key: the address (an app's instance shows its own key, spec 009); site: the site whose pages run
      Object.assign(tab, { key: v.instance || v.key, site: v.key, title: v.manifest.title, status: 'ready', view: v.view, wc: v.webContents, close: v.close })
      const sync = () => {
        // canGoBack() answers false here while there is a page to go back to (Electron 42, Windows)
        tab.canBack = v.webContents.navigationHistory.canGoToOffset(-1)
        tab.canForward = v.webContents.navigationHistory.canGoToOffset(1)
        tab.loading = v.webContents.isLoading()
        push()
      }
      for (const e of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) v.webContents.on(e, sync)
      v.webContents.on('before-input-event', (e, input) => { if (keys(input, v.webContents)) e.preventDefault() })
      win.contentView.addChildView(v.view)
      win.contentView.addChildView(frame) // added again: on top of every site
      if (current === tab.id) select(tab.id)
      else layout()
      poll()
      readIcon(v.key, v.manifest).then((icon) => {
        tab.icon = icon
        if (iconOf(v.key)) {
          data.desktop.icons = upsert(data.desktop.icons, { id: iconOf(v.key).id, title: v.manifest.title, icon })
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
    return { result: tab.id }
  }

  function go (offset) {
    const h = tabOf(current)?.wc?.navigationHistory
    if (h?.canGoToOffset(offset)) h.goToOffset(offset)
  }

  // The few keys the frame answers even while a site has the focus (there is no app menu to give them).
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
    if (input.key === 'F5' || (mod && input.key.toLowerCase() === 'r')) { tabOf(current)?.wc?.reload(); return true }
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

  // Installed = kept whole here and served (SwarmFS site.keep, remembered by SwarmFS); the icon's `kept` says
  // the engine confirmed it, so a site that couldn't be reached is tried again at the next launch. An app's
  // instance (spec 009) installs its app: the instance itself always stays joined.
  function keepSite (key, on) {
    rpc.request('site.open', { key })
      .then(({ key: site }) => rpc.request('site.keep', { key: site, keep: on, timeout: 30000 }).then(() => site).finally(() => rpc.request('site.close', { key: site }).catch(() => {})))
      .then((site) => {
        const icon = iconOf(key)
        if (icon && (icon.kind === 'installed') === on) setIcons(upsert(data.desktop.icons, { id: icon.id, kept: on, site }))
        heldAt = 0
        poll()
      }, (err) => console.error('could not ' + (on ? 'install ' : 'uninstall ') + key + ':', err.message))
  }

  // Installs follow the person (spec 012): a site installed on another of their devices is installed here
  // too, one uninstalled there is a bookmark here. `site`: the key keepSite installed (an instance's app).
  async function follow () {
    const r = await rpc.request('site.installed').catch(() => null)
    if (!r) return
    for (const s of r.sites) {
      const icon = data.desktop.icons.find((i) => i.key === s.key || i.site === s.key)
      if (icon?.kind === 'installed') continue
      setIcons(upsert(data.desktop.icons, { id: icon?.id || s.key, key: s.key, title: icon?.title || s.title || shortKey(s.key), kind: 'installed' }))
      keepSite(icon?.key || s.key, true)
    }
    for (const i of data.desktop.icons) {
      if (i.kind !== 'installed' || !i.kept || !r.uninstalled.includes(i.site || i.key)) continue
      setIcons(upsert(data.desktop.icons, { id: i.id, kind: 'bookmark' }))
      keepSite(i.key, false)
    }
  }
  const following = setInterval(follow, HELD)

  // The Devices window's calls (spec 012): the engine's devices.*, its errors as they are.
  const engine = (method, params) => rpc.request(method, params).then((result) => ({ result }), (err) => ({ error: { code: err.code || 'ERROR', message: err.message } }))

  function setIcons (icons) {
    data.desktop.icons = icons
    save()
    push()
  }

  function handle (op, a = {}) {
    const tab = tabOf(current)
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
      case 'window':
        if (a.act === 'minimize') win.minimize()
        else if (a.act === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
        else if (a.act === 'close') win.close()
        return { result: true }
      case 'bars':
        if (Number.isFinite(a.height) && a.height > 0 && a.height < 400) bars = Math.ceil(a.height)
        layout()
        return { result: true }
      default: return { error: { code: 'UNKNOWN_METHOD', message: 'unknown op ' + op } }
    }
  }

  ipcMain.handle('frame', (evt, msg) => {
    if (evt.sender !== fwc) return { error: { code: 'NOT_ALLOWED', message: 'not the frame' } }
    try {
      return handle(msg?.op, msg?.args || {})
    } catch (err) {
      return { error: { code: err.code || 'ERROR', message: err.message } }
    }
  })
  fwc.on('before-input-event', (e, input) => { if (DEV && input.type === 'keyDown' && (input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'))) { e.preventDefault(); fwc.toggleDevTools() } })

  // The tray (spec 010): while there is one, closing the window hides it; the engine, the open tabs and their
  // views stay (the window comes back as it was, and Chromium throttles hidden pages). Quit destroys the
  // window: 'closed' below, then main.js's window-all-closed stops the engine and quits, as without a tray.
  let tray = null
  let notices = 0
  const TRAY = hasTray()
  function setTray () {
    if (data.settings.tray && TRAY && !tray) tray = startTray({ rpc, show, quit: () => win.destroy() })
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

  win.on('resize', layout)
  win.on('maximize', push)
  win.on('unmaximize', push)
  win.on('closed', () => {
    clearInterval(timer)
    clearInterval(following)
    if (tray) tray.destroy()
    ipcMain.removeHandler('frame')
    for (const t of tabs) if (t.close) t.close()
  })
  layout()

  // an install (or uninstall) the engine never confirmed: again (a site unreachable then, a desktop from 002)
  for (const i of data.desktop.icons) if (i.key && !!i.kept !== (i.kind === 'installed')) keepSite(i.key, i.kind === 'installed')
  if (open) openKey(open)
  follow()
  // for the frame check (npm run test:sandbox): where everything is
  const inspect = () => ({ bars, frame: frame.getBounds(), views: tabs.filter((t) => t.view).map((t) => t.view.getBounds()), ready: tabs.filter((t) => t.status === 'ready').length - 1, fwc, tray, notices, settings: data.settings })
  const devices = () => { if (!fwc.isDestroyed()) fwc.send('frame-devices') } // the engine's 'devices' event
  // After a join (or a failed one, back on the old folder): another engine, maybe another identity. The open
  // tabs were the old engine's; installed icons are installed again on this one.
  function joinedNow ({ identity: id, said }) {
    identity = id
    joined = { said, n: (joined?.n || 0) + 1 }
    for (const t of tabs.slice(1)) closeTab(t.id)
    setIcons(data.desktop.icons.map((i) => ({ ...i, kept: false })))
    for (const i of data.desktop.icons) if (i.key && i.kind === 'installed') keepSite(i.key, true)
    follow()
  }
  return { win, inspect, show, devices, joined: joinedNow, open: openKey }
}
