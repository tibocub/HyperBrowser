// Built with DOM calls, never from HTML strings: titles come from sites.
/* global frame */

/**
 * @typedef {import('./frame.js').FrameState} FrameState
 * @typedef {import('./frame.js').TabView} TabView
 * @typedef {import('./frame.js').Note} Note
 * @typedef {import('./frame.js').Circle} Circle
 * @typedef {import('./frame.js').CircleMember} CircleMember
 * @typedef {import('../model.js').Icon} Icon
 */

/** @type {Record<string, { width: number, height: number, d: string }>} */
let GLYPHS = {}
/** @type {Record<string, string | undefined>} */
const DARK_ACCENT = { '#1f4fd1': '#8fb0ff', '#c2410c': '#ff9a5c', '#0b7a52': '#4fd1a0' }
const SVG = 'http://www.w3.org/2000/svg'
// every id ui.js asks for is in index.html
const $ = /** @type {import('./frame.js').ById} */ (/** @type {unknown} */ ((/** @type {string} */ id) => document.getElementById(id)))

/** @param {string} name */
function glyph (name) {
  const g = GLYPHS[name] || GLYPHS.site || { width: 8, height: 8, d: '' }
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`)
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS(SVG, 'path')
  p.setAttribute('fill', 'currentColor')
  p.setAttribute('d', g.d)
  svg.append(p)
  return svg
}
/** @param {Element | null} el @param {string} name */
function setGlyph (el, name) { /** @type {Element} */ (el).replaceChildren(glyph(name)) }
/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} [cls]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el (tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
/** @param {string | null | undefined} src @param {string} name @returns {HTMLElement} */
function picture (src, name) {
  if (!src) { const g = el('span', 'g'); g.append(glyph(name)); return g }
  const img = el('img')
  img.alt = ''
  img.src = src
  img.onerror = () => img.replaceWith(picture(null, name))
  return img
}

let S = /** @type {FrameState} */ (/** @type {unknown} */ (null)) // set by the first state the shell sends
/** @type {string | null} */
let selected = null
/** @type {string | null} */
let note = null
/** @param {string} op @param {object} [args] */
const send = async (op, args) => {
  const r = await frame.send(op, args)
  if (r?.error) say(r.error.message)
  return r
}
const currentTab = () => /** @type {TabView} */ (S.tabs.find((t) => t.id === S.current)) // the current tab is always listed

/** @param {number} n */
function size (n) {
  if (n < 1024) return n + ' B'
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return n.toFixed(n < 100 ? 1 : 0) + ' ' + u[i]
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let saying
/** @param {string} text */
function say (text) {
  note = text
  clearTimeout(saying)
  saying = setTimeout(() => { note = null; render() }, 4000)
  render()
}

function look () {
  const dark = S.settings.theme === 'dark' || (S.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  const a = S.settings.accent
  // the frame is inverted in dark mode: give it the inverse of the light variant, so it shows that
  /** @param {string} hex */
  const inv = (hex) => '#' + [1, 3, 5].map((i) => (255 - parseInt(hex.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('')
  document.documentElement.style.setProperty('--accent', dark ? inv(DARK_ACCENT[a] || a) : a)
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S && look())

function render () {
  if (!S) return
  look()
  const tab = currentTab()
  const site = tab.id !== 0

  $('tabs').replaceChildren(...S.tabs.map((t) => {
    const b = el('button', 'tab' + (t.status === 'opening' || t.loading ? ' busy' : ''))
    if (t.id === S.current) b.setAttribute('aria-current', 'page')
    b.title = t.id === 0 ? 'Desktop' : t.title + ' · ' + (t.name && t.key ? t.name + ' · ' + t.key : t.key || t.name) // a named site's key stays reachable here
    b.append(t.id === 0 ? picture(null, 'desktop') : picture(t.icon, 'site'), el('span', 'name', t.title))
    b.onclick = () => send('select', { id: t.id })
    if (t.id !== 0) {
      const x = el('span', 'x')
      x.setAttribute('role', 'button')
      x.setAttribute('aria-label', 'Close ' + t.title)
      x.append(glyph('close'))
      x.onclick = (e) => { e.stopPropagation(); send('close', { id: t.id }) }
      b.append(x)
      b.onauxclick = (e) => { if (e.button === 1) send('close', { id: t.id }) }
    }
    return b
  }))
  sizeTabs()
  $('w-max').setAttribute('aria-label', S.maximized ? 'Restore' : 'Maximize')
  setGlyph($('w-max').firstElementChild, S.maximized ? 'restore' : 'max')

  $('back').disabled = !tab.canBack
  $('forward').disabled = !tab.canForward
  $('reload').disabled = !site || tab.status !== 'ready'
  const addr = $('address')
  if (document.activeElement !== addr) addr.value = !site ? '' : tab.name || tab.title + ' · ' + tab.short
  const star = $('star')
  star.disabled = !site || tab.status !== 'ready' || tab.kind === 'installed'
  star.setAttribute('aria-pressed', String(!!tab.kind))
  star.title = tab.kind === 'installed' ? 'Installed: kept and seeded' : tab.kind ? 'Bookmarked: click to remove' : 'Bookmark this site'
  setGlyph(star.firstElementChild, tab.kind ? 'marked' : 'mark')
  const st = $('state')
  st.classList.toggle('bad', !!note || tab.status === 'error')
  if (note) st.textContent = note
  else if (!site) st.textContent = 'online · ' + S.open + (S.open === 1 ? ' site open' : ' sites open')
  else if (tab.status === 'opening') st.textContent = tab.key ? 'opening…' : 'looking up…'
  else if (tab.status === 'error') st.textContent = 'unreachable'
  else if (!tab.state) st.textContent = 'loading'
  else {
    st.replaceChildren(el('span', tab.state.complete ? 'on' : '', tab.state.complete ? '■ ' : '□ '),
      tab.state.complete ? 'complete' : 'loading', ' · ' + tab.state.peers + (tab.state.peers === 1 ? ' peer' : ' peers'),
      tab.held ? ' · ' + size(tab.held.bytes) + (tab.held.kept ? ' kept' : '') : '')
  }

  $('desktop').hidden = site
  $('panel').hidden = !site || tab.status === 'ready'
  if (site && tab.status !== 'ready') {
    $('panel-title').textContent = tab.status === 'error' ? 'Could not open the site' : 'Opening ' + tab.title
    $('panel-text').textContent = tab.status === 'error' ? tab.error : tab.key ? 'Looking for peers who have ' + tab.key + ' …' : 'Looking up ' + tab.name + ' …'
    $('panel-retry').hidden = tab.status !== 'error'
  }
  if (!site) drawDesktop()
  drawMenu()
  drawNotes()
}

function drawDesktop () {
  $('grid').replaceChildren(...S.desktop.icons.map((i) => {
    const li = el('li')
    li.style.gridColumn = String(i.col + 1)
    li.style.gridRow = String(i.row + 1)
    const b = el('button', 'icon ' + i.kind + (selected === i.id ? ' sel' : ''))
    b.draggable = true
    b.title = i.key ? i.title + ' · ' + i.key : i.title + ' (not published yet)'
    const box = el('span', 'box')
    box.append(picture(i.icon, i.glyph || 'site'))
    const n = unreadOf(i)
    if (n) {
      const badge = el('span', 'badge', cap(n))
      badge.setAttribute('aria-label', n + ' new')
      box.append(badge)
    }
    b.append(box, el('span', 'label', i.title), el('span', 'kind', i.key ? i.kind : 'not published'))
    b.onclick = () => { selected = i.id; drawDesktop() }
    b.ondblclick = () => send('icon.open', { id: i.id })
    b.onkeydown = (e) => { if (e.key === 'Enter') send('icon.open', { id: i.id }) }
    b.oncontextmenu = (e) => { e.preventDefault(); selected = i.id; drawDesktop(); openCtx(i, e.clientX, e.clientY) }
    b.ondragstart = (e) => { /** @type {DataTransfer} */ (e.dataTransfer).setData('text/x-icon', i.id); /** @type {DataTransfer} */ (e.dataTransfer).effectAllowed = 'move'; b.classList.add('dragging') }
    b.ondragend = () => b.classList.remove('dragging')
    li.append(b)
    return li
  }))
}

const grid = $('grid')
$('desktop').ondragover = (e) => { if (/** @type {DataTransfer} */ (e.dataTransfer).types.includes('text/x-icon')) e.preventDefault() }
$('desktop').ondrop = (e) => {
  const id = /** @type {DataTransfer} */ (e.dataTransfer).getData('text/x-icon')
  if (!id) return
  e.preventDefault()
  const r = grid.getBoundingClientRect()
  send('icon.move', { id, col: Math.floor((e.clientX - r.left) / 112), row: Math.max(0, Math.floor((e.clientY - r.top) / 112)) })
}
$('desktop').onclick = (e) => { if (e.target === $('desktop') || e.target === grid) { selected = null; drawDesktop() } }

/** @type {HTMLElement | null} */
let menuOpen = null
/** @param {HTMLElement} which @param {number} [x] @param {number} [y] */
function showMenu (which, x, y) {
  closeMenus()
  menuOpen = which
  $('backdrop').hidden = false
  which.hidden = false
  if (x !== undefined) {
    which.style.left = Math.min(x, innerWidth - which.offsetWidth - 4) + 'px'
    which.style.top = Math.min(/** @type {number} */ (y), innerHeight - which.offsetHeight - 4) + 'px'
  }
  if (which === $('menu')) $('hb').setAttribute('aria-expanded', 'true')
  frame.send('cover', { full: true })
  which.querySelector('button')?.focus()
}
function closeMenus () {
  if (!menuOpen) return
  menuOpen.hidden = true
  menuOpen = null
  $('backdrop').hidden = true
  $('hb').setAttribute('aria-expanded', 'false')
  $('bell').setAttribute('aria-expanded', 'false')
  frame.send('cover', { full: false })
}
$('backdrop').onclick = closeMenus
$('backdrop').oncontextmenu = (e) => { e.preventDefault(); closeMenus() }
$('hb').onclick = () => menuOpen === $('menu') ? closeMenus() : showMenu($('menu'))

function drawMenu () {
  const me = S.identities.find((i) => i.current)
  $('me-name').textContent = me?.name || 'You'
  $('hb-text').textContent = me && S.identities.length > 1 ? 'HyperBrowser · ' + me.name + ' ▾' : 'HyperBrowser ▾'
  $('switch').replaceChildren(...S.identities.filter((i) => !i.current).map((i) => {
    const b = el('button', 'item', 'Switch to ' + i.name)
    b.setAttribute('role', 'menuitem')
    b.onclick = () => { closeMenus(); send('identities.open', { id: i.id }) }
    return b
  }))
  drawIdentities()
  $('anon').hidden = !S.i2p?.anonymous
  drawI2P()
  $('me').textContent = S.identity ? S.identity.slice(0, 6) + '…' + S.identity.slice(-3) : ''
  $('me').title = S.identity || ''
  const installed = S.desktop.icons.filter((i) => i.kind === 'installed')
  $('installed').replaceChildren(...(installed.length
    ? installed.map((i) => {
      const b = el('button', 'item', i.title + (i.key ? '' : ' (not published yet)'))
      b.setAttribute('role', 'menuitem')
      b.onclick = () => { closeMenus(); send('icon.open', { id: i.id }) }
      return b
    })
    : [el('div', 'empty', 'Nothing installed yet')]))
  $('m-update').hidden = !S.update
  $('m-update').textContent = S.update ? 'Update ready (' + S.update + '): restart' : ''
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-theme]'))) b.setAttribute('aria-pressed', String(b.dataset.theme === S.settings.theme))
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-tray]'))) b.setAttribute('aria-pressed', String((b.dataset.tray === 'on') === S.settings.tray))
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-accent]'))) {
    b.setAttribute('aria-pressed', String(b.dataset.accent === S.settings.accent))
    const swatch = /** @type {HTMLElement} */ (b.firstElementChild)
    swatch.style.background = /** @type {string} */ (b.dataset.accent)
  }
}
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-theme]'))) b.onclick = () => send('settings', { theme: b.dataset.theme })
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-accent]'))) b.onclick = () => send('settings', { accent: b.dataset.accent })
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-tray]'))) b.onclick = () => send('settings', { tray: b.dataset.tray === 'on' })
$('m-open').onclick = () => { closeMenus(); toAddress() }
$('m-config').onclick = () => { closeMenus(); openConfig() }
$('m-new').onclick = () => { closeMenus(); openIdentities(true) }
$('m-ids').onclick = () => { closeMenus(); openIdentities() }
$('m-update').onclick = () => { closeMenus(); send('restart') }
$('m-about').onclick = () => { closeMenus(); say('HyperBrowser ' + S.version + ': sites live with their owner and their visitors.') }

/** @type {Icon | null} */
let ctxIcon = null
/** @param {Icon} icon @param {number} x @param {number} y */
function openCtx (icon, x, y) {
  ctxIcon = icon
  const kind = /** @type {Element} */ ($('ctx').querySelector('[data-act="kind"]'))
  kind.textContent = icon.kind === 'installed' ? 'Keep as a bookmark only' : 'Install (keep and seed)'
  showMenu($('ctx'), x, y)
}
$('ctx').onclick = (e) => {
  const act = /** @type {HTMLElement} */ (e.target).dataset.act
  if (!act || !ctxIcon) return
  const id = ctxIcon.id
  closeMenus()
  if (act === 'open') send('icon.open', { id })
  if (act === 'kind') send('icon.kind', { id, kind: ctxIcon.kind === 'installed' ? 'bookmark' : 'installed' })
  if (act === 'remove') send('icon.remove', { id })
}

/** @param {number} n */
const cap = (n) => n > 99 ? '99+' : String(n)
/** @param {Icon} icon */
const unreadOf = (icon) => !icon.key ? 0 : S.notes.unread.byPlace[icon.key] || S.notes.unread.byApp[icon.site || icon.key] || 0
/** @param {string} app */
const titleOf = (app) => S.notes.apps.find((a) => a.key === app)?.title || 'HyperBrowser'
/** @param {Note} x */
const placeName = (x) => S.notes.apps.find((a) => a.key === x.app)?.places.find((p) => p.key === x.place)?.name

$('bell').onclick = () => menuOpen === $('notes') ? closeMenus() : (showMenu($('notes')), $('bell').setAttribute('aria-expanded', 'true'))

function drawNotes () {
  const n = S.notes.unread.total
  $('bell-n').textContent = cap(n)
  $('bell').classList.toggle('new', n > 0)
  $('bell').setAttribute('aria-label', n ? n + ' new notifications' : 'Notifications')
  if ($('notes').hidden) { $('bell').setAttribute('aria-expanded', 'false'); return }
  /** @type {Map<string, Note>} */
  const rows = new Map()
  for (const x of S.notes.items) if (!rows.has(x.place)) rows.set(x.place, x)
  $('notes-list').replaceChildren(...(rows.size
    ? [...rows.values()].map((x) => {
      const unread = S.notes.unread.byPlace[x.place] || 0
      const b = el('button', 'item' + (unread ? '' : ' read'))
      b.setAttribute('role', 'menuitem')
      const where = x.app === 'contacts' ? 'Contacts' : titleOf(x.app) + (placeName(x) ? ' · ' + placeName(x) : '')
      b.append(el('span', 'what', where + ': ' + (x.name || x.author.slice(0, 6) + '…')), el('span', 'n', unread ? cap(unread) + ' new' : ''), el('span', 'text', x.text || 'New message'))
      b.onclick = () => { closeMenus(); send('notify.open', { id: x.id }) }
      return b
    })
    : [el('div', 'empty', 'Nothing new')]))
}

function openConfig () {
  $('config').hidden = false
  frame.send('cover', { full: true })
  drawConfig()
  drawHolding()
  drawI2PConfig()
}

/** @param {{ relay: boolean, upnp: boolean, strict: string | null } | null} [got] */
async function drawI2PConfig (got) {
  const r = got === undefined ? (await frame.send('i2p.settings', {}))?.result : got
  $('cf-i2p').hidden = !r
  if (!r) return
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-relay]'))) {
    b.setAttribute('aria-pressed', String((b.dataset.relay === 'on') === (r.relay && !r.strict)))
    b.disabled = !!r.strict
  }
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-upnp]'))) b.setAttribute('aria-pressed', String((b.dataset.upnp === 'on') === r.upnp))
  $('cf-i2p-why').textContent = r.strict ? 'Relaying is off: this computer seems to be set up in a country where relaying I2P is risky (by its time zone or region).' : ''
}
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-relay]'))) {
  b.onclick = async () => drawI2PConfig((await frame.send('i2p.set', { relay: b.dataset.relay === 'on' }))?.result || null)
}
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-upnp]'))) {
  b.onclick = async () => drawI2PConfig((await frame.send('i2p.set', { upnp: b.dataset.upnp === 'on' }))?.result || null)
}
function closeConfig () {
  $('config').hidden = true
  if (!menuOpen && $('devices').hidden && $('circles').hidden && $('identities').hidden) frame.send('cover', { full: false })
}
$('cf-close').onclick = closeConfig
$('cf-devices').onclick = () => { closeConfig(); openDevices() }
$('cf-circles').onclick = () => { closeConfig(); openCircles() }

/** @param {string} label @param {boolean} on @param {() => void} fn */
function toggle (label, on, fn) {
  const b = el('button', 'choice', label)
  b.setAttribute('aria-pressed', String(on))
  b.onclick = fn
  return b
}
function drawConfig () {
  if ($('config').hidden) return
  const apps = S.notes.apps
  $('cf-apps').replaceChildren(...apps.map((a) => {
    const div = el('div', 'app')
    div.dataset.app = a.key
    div.append(el('div', '', a.title))
    const choices = el('div', 'choices')
    choices.append(toggle('Allowed', a.allow, () => send('notify.set', { app: a.key, allow: true })), toggle('Blocked', !a.allow, () => send('notify.set', { app: a.key, allow: false })),
      toggle('Hide text', a.hide, () => send('notify.set', { app: a.key, hide: !a.hide })))
    div.append(choices)
    for (const p of a.places) {
      const row = el('div', 'place')
      const box = el('input')
      box.type = 'checkbox'
      box.id = 'mute-' + p.key
      box.checked = p.muted
      box.onchange = () => send('notify.set', { place: p.key, mute: box.checked })
      const label = el('label', '', 'Mute ' + (p.name || p.key.slice(0, 8) + '…'))
      label.htmlFor = box.id
      row.append(box, label)
      div.append(row)
    }
    return div
  }))
}

/** @type {import('./frame.js').Devices | null} */
let D = null
const out = $('dv-out')
/** @param {...(Node | string)} nodes */
const show = (...nodes) => out.replaceChildren(...nodes)
/** @param {string} text @param {string} [cls] */
const line = (text, cls) => el('p', cls, text)
/** @param {string} text @param {() => void} fn */
function push (text, fn) {
  const b = el('button', 'push', text)
  b.onclick = fn
  return b
}
const password = () => $('dv-pass').value || undefined

/** @param {string | null} [note] */
function openDevices (note = null) {
  $('devices').hidden = false
  frame.send('cover', { full: true })
  show(...(note ? [line(note)] : []))
  devices()
}
function closeDevices () {
  $('devices').hidden = true
  if (!menuOpen) frame.send('cover', { full: false })
}
$('dv-close').onclick = closeDevices
frame.onDevices(() => { if (!$('devices').hidden) devices() })

async function devices () {
  const r = await frame.send('devices')
  if (r?.error) return
  D = /** @type {import('./frame.js').Devices} */ (r.result)
  $('dv-note').hidden = !D.removed
  $('dv-note').textContent = 'This computer was removed from your identity: what it does no longer counts. Join with a code to use it again.'
  $('dv-pass-row').hidden = D.phrase !== 'protected'
  $('dv-list').replaceChildren(...D.devices.map((d) => {
    const li = el('li')
    li.append(el('span', '', d.name || 'a device'), el('span', 'dim', d.current ? '(this computer)' : d.publicKey.slice(0, 6) + '…'))
    if (!d.current) {
      const b = el('button', 'choice', 'Remove')
      b.onclick = () => show(line('Remove "' + (d.name || 'this device') + '"? Nothing it does from now on counts as you, anywhere. This cannot be undone.'),
        push('Remove', async () => {
          const r = await frame.send('devices.remove', { publicKey: d.publicKey, password: password() })
          show(line(r?.error ? r.error.message : 'Removed.'))
          devices()
        }))
      li.append(b)
    }
    return li
  }))
}

$('dv-add').onclick = async () => {
  const r = await frame.send('devices.add', { password: password() })
  if (r?.error) return show(line(r.error.message))
  const code = r.result.code
  show(line('On the other computer: HyperBrowser ▾ → Devices → Join with a code, and paste this code (send it to yourself). It works once, for 10 minutes.'),
    line(code, 'code'), push('Copy', () => navigator.clipboard.writeText(code).then(() => say('Code copied'), () => say('Select the code and copy it'))))
}

$('dv-join').onclick = () => {
  const box = el('textarea')
  box.setAttribute('aria-label', 'The code')
  box.spellcheck = false
  const owns = D?.owns || []
  show(line('This computer becomes a device of the identity whose code you paste. Its own identity is replaced: its folder is kept (engine-before-join-<date>), nothing is deleted.'),
    ...(owns.length ? [line('It owns ' + owns.length + (owns.length === 1 ? ' site' : ' sites') + ' (' + owns.map((o) => o.name || o.key.slice(0, 6)).join(', ') + '): nobody will update ' + (owns.length === 1 ? 'it' : 'them') + ' from here until you switch back.')] : []),
    box, push('Join', async () => {
      const r = await frame.send('devices.join', { code: box.value })
      show(line(r?.error ? r.error.message : 'Joining… (up to a minute)'))
    }))
  box.focus()
}

$('dv-phrase').onclick = async () => {
  const r = await frame.send('devices.phrase', { password: password() })
  if (r?.error) return show(line(D?.phrase === 'protected' ? 'Type your password above first. (' + r.error.message + ')' : r.error.message))
  if (!r.result.words) return show(line('This computer no longer keeps the recovery phrase.'))
  /** @type {HTMLElement[]} */
  const nodes = [line('Your recovery phrase: write these 24 words down. Anyone with them is you; adding or removing a device needs them.'), line(r.result.words, 'code')]
  if (D?.phrase === 'plain') {
    const box = el('input')
    box.type = 'password'
    box.setAttribute('aria-label', 'A password for the phrase')
    nodes.push(line('Keep it on this computer behind a password (then asked to show it, and to add or remove a device):'), box,
      push('Protect', async () => {
        const p = await frame.send('devices.protect', { password: box.value })
        show(line(p?.error ? p.error.message : 'Protected: this computer now asks for that password.'))
        devices()
      }))
  }
  show(...nodes)
}

const idOut = $('id-out')
/** @param {...(Node | string)} nodes */
const idShow = (...nodes) => idOut.replaceChildren(...nodes)

function openIdentities (naming = false) {
  $('identities').hidden = false
  frame.send('cover', { full: true })
  idShow()
  drawIdentities()
  ;(naming ? $('id-name') : /** @type {HTMLElement} */ ($('id-list').querySelector('summary, button') || $('id-name'))).focus()
}
function closeIdentities () {
  $('identities').hidden = true
  idShow() // a restore's words typed and left go with it
  $('id-pass').value = ''
  $('id-pass-row').hidden = true
  if (!menuOpen) frame.send('cover', { full: false })
}
$('id-close').onclick = closeIdentities

/** @typedef {import('./frame.js').IdentityRow} IdentityRow */
function drawIdentities () {
  if ($('identities').hidden) return
  $('id-list').replaceChildren(...S.identities.map((i) => {
    const li = el('li')
    li.append(el('span', 'grow', i.name), ...(i.anonymous ? [el('span', 'badge', 'Anonymous')] : []), el('span', 'dim', i.current ? '(open)' : ''))
    if (!i.current) {
      const b = el('button', 'choice', 'Open')
      b.setAttribute('aria-label', 'Open ' + i.name)
      b.onclick = () => send('identities.open', { id: i.id })
      li.append(b)
    }
    li.append(more('More for ' + i.name, /** @type {Array<[string, () => void]>} */ ([
      ['Rename', () => renameIdentity(i)],
      ['Show recovery phrase', () => showPhrase(i)],
      ...(i.current ? [] : [['Delete…', () => askDelete(i)]])
    ])))
    return li
  }))
}

$('id-create').onclick = async () => {
  const anonymous = $('id-anon').checked
  const r = await frame.send('identities.create', { name: $('id-name').value, anonymous })
  if (r?.error) return idShow(line(r.error.message))
  const name = $('id-name').value.trim()
  $('id-name').value = ''
  $('id-anon').checked = false
  $('id-anon-note').hidden = true
  const b = push('Open "' + name + '" now', () => send('identities.open', { id: r.result }))
  idShow(line('"' + name + '" is ready: a new ' + (anonymous ? 'anonymous identity (over I2P, your IP hidden)' : 'identity of its own') + ', nothing shared with the others.'), b)
  b.focus()
}
$('id-name').onkeydown = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter') $('id-create').click() }
$('id-anon').onchange = () => { $('id-anon-note').hidden = !$('id-anon').checked }

// An anonymous identity before I2P is up (or while the router restarts): it says so, and nothing of it is online.
function drawI2P () {
  const waiting = !!S.i2p?.anonymous && S.i2p.state !== 'ready'
  $('i2p-wait').hidden = !waiting
  $('i2p-reason').textContent = waiting && S.i2p?.reason ? 'Not yet: ' + S.i2p.reason + '. Trying again.' : ''
}

// The words go to the engine once and leave the field: hypergraph keeps them in the new identity's folder, nothing else does.
$('id-restore').onclick = () => {
  const name = el('input')
  name.maxLength = 64
  name.autocomplete = 'off'
  name.setAttribute('aria-label', 'Name of the restored identity')
  const words = el('textarea')
  words.setAttribute('aria-label', 'Recovery phrase, 24 words')
  words.spellcheck = false
  words.autocomplete = 'off'
  words.setAttribute('autocapitalize', 'off')
  const go = async () => {
    const r = await frame.send('identities.restore', { name: name.value, words: words.value })
    words.value = ''
    if (r?.error) { idShow(line(r.error.message), name, words, restore, cancel); words.focus(); return }
    idShow(line('Restoring "' + name.value.trim() + '"…'))
  }
  const restore = push('Restore', go)
  const cancel = push('Cancel', () => { words.value = ''; idShow() })
  name.onkeydown = (e) => { if (e.key === 'Enter') words.focus() }
  idShow(line('Restore an identity from its recovery phrase: this computer becomes a new device of it. Name it here, then type its 24 words.'), name, words, restore, cancel)
  name.focus()
}

/** @param {IdentityRow} i */
function renameIdentity (i) {
  const box = el('input')
  box.value = i.name
  box.maxLength = 64
  box.setAttribute('aria-label', 'New name')
  const done = async () => {
    const r = await frame.send('identities.rename', { id: i.id, name: box.value })
    idShow(...(r?.error ? [line(r.error.message)] : []))
  }
  box.onkeydown = (e) => { if (e.key === 'Enter') done() }
  idShow(line('Rename "' + i.name + '" (only on this computer: nobody else sees this name):'), box, push('Rename', done))
  box.focus()
}

// undefined: it couldn't be read (said in the window); null: this computer doesn't keep it
/** @param {IdentityRow} i @returns {Promise<string | null | undefined>} */
async function phraseOf (i) {
  const r = await frame.send('identities.phrase', { id: i.id, password: $('id-pass').value || undefined })
  if (!r?.error) return r.result.words
  if (r.error.code !== 'NOT_ALLOWED') { idShow(line(r.error.message)); return undefined }
  $('id-pass-row').hidden = false
  idShow(line('The recovery phrase of "' + i.name + '" is protected: type its password above, then try again.'))
  $('id-pass').focus()
  return undefined
}

/** @param {IdentityRow} i */
async function showPhrase (i) {
  const words = await phraseOf(i)
  if (words === undefined) return
  idShow(...(words
    ? [line('The recovery phrase of "' + i.name + '": write these 24 words down. Anyone with them is this identity.'), line(words, 'code')]
    : [line('This computer no longer keeps the recovery phrase of "' + i.name + '".')]))
}

/** @param {IdentityRow} i */
async function askDelete (i) {
  const words = await phraseOf(i)
  if (words === undefined) return
  const cancel = push('Cancel', () => idShow())
  idShow(line('Delete "' + i.name + '" from this computer? Its contacts, conversations, circles, sites and site data here are removed. This cannot be undone without its recovery phrase (HyperBrowser ▾ → Manage identities… → Restore from a recovery phrase…), and even then not what was kept here.'),
    ...(words
      ? [line('Write its recovery phrase down first:'), line(words, 'code')]
      : [line('This computer no longer keeps its recovery phrase: without your written copy, this identity is gone for good.', 'note')]),
    push('Delete "' + i.name + '"', async () => {
      const r = await frame.send('identities.delete', { id: i.id })
      idShow(line(r?.error ? r.error.message : '"' + i.name + '" was deleted.'))
    }), cancel)
  cancel.focus()
}

/** @param {number} b */
const gbs = (b) => (Math.round(b / 1e8) / 10) + ' GB' // hypergraph's GB: 1e9 bytes
/** @type {import('./frame.js').Holding | null} */
let H = null
const holdOut = $('cf-hold-out')

// No pause: Off deletes what is held, so it asks first.
async function drawHolding () {
  const r = await frame.send('holding.get')
  if (r?.error) return
  H = /** @type {import('./frame.js').Holding} */ (r.result)
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-hold]'))) b.setAttribute('aria-pressed', String((b.dataset.hold === 'on') === H.on))
  if (document.activeElement !== $('cf-share')) $('cf-share').value = String(Math.round(H.bytes / 1e8) / 10)
  $('cf-held').textContent = 'You hold ' + gbs(H.used) + ' of ' + gbs(H.bytes) + (H.on ? '' : ' (off)')
}
for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-hold]'))) {
  b.onclick = () => {
    if (!H || (b.dataset.hold === 'on') === H.on) return
    if (b.dataset.hold === 'on') return frame.send('holding.set', { on: true }).then(drawHolding)
    holdOut.replaceChildren(line('This deletes the ' + gbs(H.used) + ' you keep for your circles. Their spaces will be kept by others.'),
      push('Turn off', async () => { holdOut.replaceChildren(); await frame.send('holding.set', { on: false }); drawHolding() }),
      push('Cancel', () => holdOut.replaceChildren()))
  }
}
$('cf-share-set').onclick = async () => {
  const r = await frame.send('share.check', { text: $('cf-share').value })
  if (r?.error) return holdOut.replaceChildren(line(r.error.message))
  const set = async () => {
    const s = await frame.send('holding.set', { on: /** @type {import('./frame.js').Holding} */ (H).on, bytes: r.result.bytes })
    holdOut.replaceChildren(...(s?.error ? [line(s.error.message)] : []))
    drawHolding()
  }
  if (!r.result.drop) return set()
  holdOut.replaceChildren(line(gbs(r.result.drop) + ' will be dropped now, oldest first.'), push('Set', set), push('Cancel', () => { holdOut.replaceChildren(); drawHolding() }))
}
$('cf-share').onkeydown = (e) => { if (e.key === 'Enter') $('cf-share-set').click() }

const clOut = $('cl-out')
/** @param {...(Node | string)} nodes */
const clShow = (...nodes) => clOut.replaceChildren(...nodes)
/** @param {string} k */
const short = (k) => k.slice(0, 6) + '…'
/** @type {Array<string | null>} */
const DECIDERS = ['owner', 'admin']

/** @param {string | null} [note] */
function openCircles (note = null) {
  $('circles').hidden = false
  frame.send('cover', { full: true })
  clShow(...(note ? [line(note)] : []))
  drawCircles()
}
function closeCircles () {
  $('circles').hidden = true
  if (!menuOpen) frame.send('cover', { full: false })
}
$('cl-close').onclick = closeCircles
frame.onCircles((d) => {
  if (d?.open) return openCircles(d.note || null)
  if (!$('circles').hidden) drawCircles()
  if (!$('config').hidden) drawHolding()
})

/** @param {string} label @param {Array<[string, () => void]>} items */
function more (label, items) {
  const d = el('details')
  const sum = el('summary', '', '…')
  sum.setAttribute('aria-label', label)
  const box = el('div')
  for (const [text, fn] of items) {
    const b = el('button', 'item', text)
    b.onclick = () => { d.open = false; fn() }
    box.append(b)
  }
  d.append(sum, box)
  return d
}

async function drawCircles () {
  const r = await frame.send('circles.list')
  if (r?.error) return
  $('cl-list').replaceChildren(...(r.result.length
    ? r.result.map((/** @type {Circle} */ c) => {
      const li = el('li')
      li.dataset.key = c.key
      const decides = DECIDERS.includes(c.role)
      li.append(el('span', 'grow', c.name || short(c.key)), el('span', 'dim', c.members + (c.members === 1 ? ' member, ' : ' members, ') + c.holders + ' holding'),
        more('More for ' + (c.name || 'this circle'), /** @type {Array<[string, () => void]>} */ ([
          ...(decides ? [['Copy invite link', () => invite(c)], ['Invite contacts…', () => inviteContacts(c)]] : []),
          ['Members', () => members(c)],
          ...(decides ? [['Rename', () => rename(c)]] : []),
          ['Leave', () => askLeave(c)]
        ])))
      return li
    })
    : [el('li', 'dim', 'No circle yet')]))
}

$('cl-create').onclick = async () => {
  const name = $('cl-name').value.trim()
  if (!name) return clShow(line('Give the circle a name first.'))
  const r = await frame.send('circles.create', { name })
  if (r?.error) return clShow(line(r.error.message))
  if (!r.result) return
  $('cl-name').value = ''
  clShow(line('"' + name + '" made.' + (r.result.holding.on ? '' : ' Your computer keeps no copies yet: turn it on in Configuration.')))
  drawCircles()
}

// the pasted link joins without a "Join?" (pasting is the yes); only the circles notice the first time
$('cl-join').onclick = () => {
  const box = el('input')
  box.setAttribute('aria-label', 'Invite link')
  box.placeholder = 'hg:…'
  const go = async () => {
    if (!box.value.trim()) return clShow(line('Paste the link first.'), box, join)
    const r = await frame.send('circles.join', { link: box.value })
    if (r?.error) return clShow(line(r.error.message), box, join)
    if (!r.result.joined) return clShow(...(r.result.error ? [line(r.result.error), box, join] : []))
    clShow(line('You joined "' + r.result.name + '"'))
    drawCircles()
  }
  const join = push('Join', go)
  box.onkeydown = (e) => { if (e.key === 'Enter') go() }
  clShow(line('Paste the invite link someone sent you:'), box, join)
  box.focus()
}

/** @param {Circle} c */
async function inviteContacts (c) {
  const r = await frame.send('circles.invitees', { key: c.key })
  if (r?.error) return clShow(line(r.error.message))
  /** @type {Array<{ identity: string, name: string, in: boolean }>} */
  const rows = r.result
  if (!rows.length) return clShow(line('No friends yet: add some in Contacts'))
  const ul = el('ul', 'members')
  const boxes = rows.map((x) => {
    const box = el('input')
    box.type = 'checkbox'
    box.disabled = x.in
    const label = el('label', 'grow' + (x.in ? ' dim' : ''))
    label.append(box, ' ' + x.name + (x.in ? ' (already in)' : ''))
    const li = el('li')
    li.append(label)
    ul.append(li)
    return box
  })
  clShow(line('Invite to "' + (c.name || 'this circle') + '": each gets their own link in Chat, for 7 days.'), ul, push('Send', async () => {
    const picked = rows.filter((x, i) => boxes[i].checked)
    if (!picked.length) return clOut.lastChild?.textContent === 'Tick a friend first.' || clOut.append(line('Tick a friend first.'))
    const sent = await frame.send('circles.inviteContacts', { key: c.key, friends: picked })
    clShow(line(sent?.error ? sent.error.message : sent.result))
  }), push('Cancel', () => clShow()))
}

/** @param {Circle} c */
async function invite (c) {
  const r = await frame.send('circles.invite', { key: c.key })
  if (r?.error) return clShow(line(r.error.message))
  const link = r.result.link
  clShow(line('An invite to "' + (c.name || 'this circle') + '": one person, for 7 days. Send it to them, or invite a friend from Contacts (… → Invite to circle).'),
    line(link, 'code'), push('Copy', () => navigator.clipboard.writeText(link).then(() => say('Invite link copied'), () => say('Select the link and copy it'))))
}

/** @param {Circle} c */
function rename (c) {
  const box = el('input')
  box.value = c.name
  box.maxLength = 64
  box.setAttribute('aria-label', 'New name')
  clShow(line('Rename "' + (c.name || 'this circle') + '" for everyone in it:'), box, push('Rename', async () => {
    const r = await frame.send('circles.rename', { key: c.key, name: box.value })
    clShow(...(r?.error ? [line(r.error.message)] : []))
    drawCircles()
  }))
  box.focus()
}

// The owner leaving gets the forum's warning: the circle lives on; without an admin nobody can invite.
/** @param {Circle} c */
async function askLeave (c) {
  const name = '"' + (c.name || 'this circle') + '"'
  let text = 'Leave ' + name + '? Your computer stops keeping its people\'s copies, and they stop keeping yours.'
  if (c.role === 'owner') {
    const m = await frame.send('circles.members', { key: c.key })
    const admins = (m?.result || []).filter((/** @type {CircleMember} */ x) => x.role === 'admin' && !x.you).length
    text = 'You own ' + name + '. It lives on while its members keep it, ' + (admins
      ? 'and its ' + (admins === 1 ? 'admin' : admins + ' admins') + ' can still invite people.'
      : 'but nobody can invite people any more: make someone admin first (Members).') + ' Leave it?'
  }
  clShow(line(text), push('Leave', async () => {
    const r = await frame.send('circles.leave', { key: c.key })
    clShow(line(r?.error ? r.error.message : 'Left.'))
    drawCircles()
  }), push('Cancel', () => clShow()))
}

/** @param {Circle} c */
async function members (c) {
  const [r, l] = await Promise.all([frame.send('circles.members', { key: c.key }), frame.send('circles.list')])
  if (r?.error) return clShow(line(r.error.message))
  const decides = DECIDERS.includes(c.role)
  const ul = el('ul', 'members')
  for (const m of /** @type {CircleMember[]} */ (r.result)) {
    const who = m.name || short(m.identity)
    const li = el('li')
    const held = m.held
    const nums = el('span', 'dim', m.role + (m.holds ? ' · holds' : '') + (held ? ' · ' + held : ''))
    if (held) nums.title = 'What they hold out of their share, across all their circles'
    li.append(el('span', 'grow', who + (m.you ? ' (you)' : '')), nums)
    if (decides && !m.you && m.role !== 'owner') {
      li.append(more('More for ' + who, /** @type {Array<[string, () => void]>} */ ([
        m.role === 'admin' ? ['Make member', () => setRole(c, m, 'member')] : ['Make admin', () => setRole(c, m, 'admin')],
        ['Remove', async () => {
          const x = await frame.send('circles.remove', { key: c.key, identity: m.identity })
          if (x?.error) return clShow(line(x.error.message))
          members(c)
        }]
      ])))
    }
    ul.append(li)
  }
  const total = l?.result?.find((/** @type {Circle} */ x) => x.key === c.key)?.totalLine
  const room = total && line(total, 'dim')
  if (room) room.title = "Everyone's shares ÷ 5 copies; approximate: shares also serve other circles"
  clShow(line('Members of "' + (c.name || 'this circle') + '" (' + r.result.length + ' of 50):'), ul, ...(room ? [room] : []))
}
/** @param {Circle} c @param {CircleMember} m @param {string} role */
async function setRole (c, m, role) {
  const x = await frame.send('circles.setRole', { key: c.key, identity: m.identity, role })
  if (x?.error) return clShow(line(x.error.message))
  members(c)
}

$('back').onclick = () => send('back')
$('forward').onclick = () => send('forward')
$('reload').onclick = () => send('reload')
$('star').onclick = () => send('bookmark')
$('plus').onclick = () => { send('select', { id: 0 }); toAddress() }
$('panel-close').onclick = () => send('close', { id: S.current })
$('panel-retry').onclick = async () => { const t = currentTab(); await send('close', { id: t.id }); send('open', { input: t.name || t.key }) }

const addr = $('address')
function toAddress () { addr.focus(); addr.select() }
addr.onfocus = () => {
  const t = currentTab()
  addr.value = t.id === 0 ? '' : /** @type {string} */ (t.name || t.key)
  addr.select()
}
addr.onblur = () => render()
addr.onkeydown = async (/** @type {KeyboardEvent} */ e) => {
  if (e.key === 'Escape') { addr.blur(); return }
  if (e.key !== 'Enter') return
  const r = await send('open', { input: addr.value })
  if (!r?.error) addr.blur()
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  if (e.key === 'Escape' && menuOpen) { closeMenus(); return }
  if (e.key === 'Escape' && !$('devices').hidden) { closeDevices(); return }
  if (e.key === 'Escape' && !$('identities').hidden) { closeIdentities(); return }
  if (e.key === 'Escape' && !$('circles').hidden) { closeCircles(); return }
  if (e.key === 'Escape' && !$('config').hidden) { closeConfig(); return }
  if (mod && k === 'l') { e.preventDefault(); toAddress() }
  else if (mod && k === 't') { e.preventDefault(); send('select', { id: 0 }); toAddress() }
  else if (mod && k === 'w') { e.preventDefault(); send('close', { id: S.current }) }
  else if (e.key === 'F5' || (mod && k === 'r')) { e.preventDefault(); send('reload') }
  else if (e.altKey && e.key === 'ArrowLeft') send('back')
  else if (e.altKey && e.key === 'ArrowRight') send('forward')
  else if (mod && e.key === 'Tab') {
    e.preventDefault()
    const i = S.tabs.findIndex((t) => t.id === S.current)
    send('select', { id: S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length].id })
  }
})

// Tabs share the room left in the bar, each a whole number of pixels wide (crisp glyphs), at most 240.
// shortcut: past ~35 tabs on a 1280 px window the last ones are cut off; a tab list menu if that matters.
function sizeTabs () {
  const tabs = /** @type {HTMLCollectionOf<HTMLElement>} */ ($('tabs').children)
  if (!tabs.length) return
  const room = $('top').clientWidth - $('hb').offsetWidth - $('plus').offsetWidth - $('win').offsetWidth - 48
  const w = Math.max(24, Math.min(240, Math.floor(room / tabs.length)))
  for (const t of tabs) {
    t.style.width = w + 'px'
    t.classList.toggle('narrow', w < 72)
  }
}
addEventListener('resize', sizeTabs)

$('w-min').onclick = () => send('window', { act: 'minimize' })
$('w-max').onclick = () => send('window', { act: 'maximize' })
$('w-close').onclick = () => send('window', { act: 'close' })

// --- the bars' height, so main puts site views right under them ---

const bars = $('bars')
function measure () {
  const h = bars.offsetHeight
  $('desktop').style.top = h + 'px'
  frame.send('bars', { height: h })
}
new ResizeObserver(measure).observe(bars)
document.fonts.ready.then(measure)

let joinedSeen = 0
let noted = false
function showNote () {
  if (noted || !S.note) return
  noted = true
  openIdentities()
  idShow(line(S.note))
}
frame.onState((s) => {
  S = s
  render()
  showNote()
  drawConfig()
  if (S.joined && S.joined.n !== joinedSeen) {
    joinedSeen = S.joined.n
    openDevices(S.joined.said === 'joined' ? 'This computer is now a device of your identity.' : 'Could not join: ' + S.joined.said + '. This computer is as it was.')
  }
})
frame.onFocusAddress(toAddress)
frame.send('glyphs').then((r) => {
  GLYPHS = r.result
  for (const g of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-g]'))) setGlyph(g, /** @type {string} */ (g.dataset.g))
  return frame.send('hello')
}).then((r) => { S = r.result; render(); measure(); showNote() })
