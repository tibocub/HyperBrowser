// The frame page (spec 002): draws the state main sends (contracts/frame.md) and sends the person's actions.
// Plain DOM, no framework; built with DOM calls, never from HTML strings (titles come from sites).
/* global frame */

// pixel icons: shell/icons/<name>.png (8×8, the window buttons 5×5), sent by main as paths; crisp at 2px a pixel
let GLYPHS = {}
const DARK_ACCENT = { '#1f4fd1': '#8fb0ff', '#c2410c': '#ff9a5c', '#0b7a52': '#4fd1a0' }
const SVG = 'http://www.w3.org/2000/svg'
const $ = (id) => document.getElementById(id)

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
function setGlyph (el, name) { el.replaceChildren(glyph(name)) }
function el (tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
function picture (src, name) {
  if (!src) { const g = el('span', 'g'); g.append(glyph(name)); return g }
  const img = el('img')
  img.alt = ''
  img.src = src
  img.onerror = () => img.replaceWith(picture(null, name))
  return img
}

let S = null // the last state from main
let selected = null // the selected desktop icon
let note = null // a message shown in place of the state for a moment
const send = async (op, args) => {
  const r = await frame.send(op, args)
  if (r?.error) say(r.error.message)
  return r
}
const currentTab = () => S.tabs.find((t) => t.id === S.current)

function size (n) {
  if (n < 1024) return n + ' B'
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return n.toFixed(n < 100 ? 1 : 0) + ' ' + u[i]
}

function say (text) {
  note = text
  clearTimeout(say.t)
  say.t = setTimeout(() => { note = null; render() }, 4000)
  render()
}

// --- the look ---

function look () {
  const dark = S.settings.theme === 'dark' || (S.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  const a = S.settings.accent
  // the frame is inverted in dark mode: give it the inverse of the light variant, so it shows that
  const inv = (hex) => '#' + [1, 3, 5].map((i) => (255 - parseInt(hex.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('')
  document.documentElement.style.setProperty('--accent', dark ? inv(DARK_ACCENT[a] || a) : a)
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => S && look())

// --- render ---

function render () {
  if (!S) return
  look()
  const tab = currentTab()
  const site = tab.id !== 0

  // taskbar
  $('tabs').replaceChildren(...S.tabs.map((t) => {
    const b = el('button', 'tab' + (t.status === 'opening' || t.loading ? ' busy' : ''))
    if (t.id === S.current) b.setAttribute('aria-current', 'page')
    b.title = t.id === 0 ? 'Desktop' : t.title + ' · ' + t.key
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

  // toolbar
  $('back').disabled = !tab.canBack
  $('forward').disabled = !tab.canForward
  $('reload').disabled = !site || tab.status !== 'ready'
  const addr = $('address')
  if (document.activeElement !== addr) addr.value = site ? tab.title + ' · ' + tab.short : ''
  const star = $('star')
  star.disabled = !site || tab.status !== 'ready' || tab.kind === 'installed'
  star.setAttribute('aria-pressed', String(!!tab.kind))
  star.title = tab.kind === 'installed' ? 'Installed: kept and seeded' : tab.kind ? 'Bookmarked: click to remove' : 'Bookmark this site'
  setGlyph(star.firstElementChild, tab.kind ? 'marked' : 'mark')
  const st = $('state')
  st.classList.toggle('bad', !!note || tab.status === 'error')
  if (note) st.textContent = note
  else if (!site) st.textContent = 'online · ' + S.open + (S.open === 1 ? ' site open' : ' sites open')
  else if (tab.status === 'opening') st.textContent = 'opening…'
  else if (tab.status === 'error') st.textContent = 'unreachable'
  else if (!tab.state) st.textContent = 'loading'
  else {
    st.replaceChildren(el('span', tab.state.complete ? 'on' : '', tab.state.complete ? '■ ' : '□ '),
      tab.state.complete ? 'complete' : 'loading', ' · ' + tab.state.peers + (tab.state.peers === 1 ? ' peer' : ' peers'),
      tab.held ? ' · ' + size(tab.held.bytes) + (tab.held.kept ? ' kept' : '') : '')
  }

  // the area under the bars: the desktop, or the panel of a tab without a page yet
  $('desktop').hidden = site
  $('panel').hidden = !site || tab.status === 'ready'
  if (site && tab.status !== 'ready') {
    $('panel-title').textContent = tab.status === 'error' ? 'Could not open the site' : 'Opening ' + tab.title
    $('panel-text').textContent = tab.status === 'error' ? tab.error : 'Looking for peers who have ' + tab.key + ' …'
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
    const n = unreadOf(i) // spec 016: its app's unread notifications, or its conversation's
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
    b.ondragstart = (e) => { e.dataTransfer.setData('text/x-icon', i.id); e.dataTransfer.effectAllowed = 'move'; b.classList.add('dragging') }
    b.ondragend = () => b.classList.remove('dragging')
    li.append(b)
    return li
  }))
}

const grid = $('grid')
$('desktop').ondragover = (e) => { if (e.dataTransfer.types.includes('text/x-icon')) e.preventDefault() }
$('desktop').ondrop = (e) => {
  const id = e.dataTransfer.getData('text/x-icon')
  if (!id) return
  e.preventDefault()
  const r = grid.getBoundingClientRect()
  send('icon.move', { id, col: Math.floor((e.clientX - r.left) / 112), row: Math.max(0, Math.floor((e.clientY - r.top) / 112)) })
}
$('desktop').onclick = (e) => { if (e.target === $('desktop') || e.target === grid) { selected = null; drawDesktop() } }

// --- menus: while one is open, the frame covers the window (over the site too) ---

let menuOpen = null
function showMenu (which, x, y) {
  closeMenus()
  menuOpen = which
  $('backdrop').hidden = false
  which.hidden = false
  if (x !== undefined) {
    which.style.left = Math.min(x, innerWidth - which.offsetWidth - 4) + 'px'
    which.style.top = Math.min(y, innerHeight - which.offsetHeight - 4) + 'px'
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
  $('m-update').hidden = !S.update // an update is installed: it starts at the next launch, or now (spec 011)
  $('m-update').textContent = S.update ? 'Update ready (' + S.update + '): restart' : ''
  for (const b of document.querySelectorAll('[data-theme]')) b.setAttribute('aria-pressed', String(b.dataset.theme === S.settings.theme))
  for (const b of document.querySelectorAll('[data-tray]')) b.setAttribute('aria-pressed', String((b.dataset.tray === 'on') === S.settings.tray))
  for (const b of document.querySelectorAll('[data-accent]')) {
    b.setAttribute('aria-pressed', String(b.dataset.accent === S.settings.accent))
    b.firstElementChild.style.background = b.dataset.accent
  }
}
for (const b of document.querySelectorAll('[data-theme]')) b.onclick = () => send('settings', { theme: b.dataset.theme })
for (const b of document.querySelectorAll('[data-accent]')) b.onclick = () => send('settings', { accent: b.dataset.accent })
for (const b of document.querySelectorAll('[data-tray]')) b.onclick = () => send('settings', { tray: b.dataset.tray === 'on' })
$('m-open').onclick = () => { closeMenus(); toAddress() }
$('m-config').onclick = () => { closeMenus(); openConfig() }
$('m-update').onclick = () => { closeMenus(); send('restart') }
$('m-about').onclick = () => { closeMenus(); say('HyperBrowser ' + S.version + ': sites live with their owner and their visitors.') }

let ctxIcon = null
function openCtx (icon, x, y) {
  ctxIcon = icon
  $('ctx').querySelector('[data-act="kind"]').textContent = icon.kind === 'installed' ? 'Keep as a bookmark only' : 'Install (keep and seed)'
  showMenu($('ctx'), x, y)
}
$('ctx').onclick = (e) => {
  const act = e.target.dataset.act
  if (!act || !ctxIcon) return
  const id = ctxIcon.id
  closeMenus()
  if (act === 'open') send('icon.open', { id })
  if (act === 'kind') send('icon.kind', { id, kind: ctxIcon.kind === 'installed' ? 'bookmark' : 'installed' })
  if (act === 'remove') send('icon.remove', { id })
}

// --- notifications (spec 016): the counter, its list, icon counts; the Configuration window ---

const cap = (n) => n > 99 ? '99+' : String(n)
const unreadOf = (icon) => !icon.key ? 0 : S.notes.unread.byPlace[icon.key] || S.notes.unread.byApp[icon.site || icon.key] || 0
const titleOf = (app) => S.notes.apps.find((a) => a.key === app)?.title || 'HyperBrowser'
const placeName = (x) => S.notes.apps.find((a) => a.key === x.app)?.places.find((p) => p.key === x.place)?.name

$('bell').onclick = () => menuOpen === $('notes') ? closeMenus() : (showMenu($('notes')), $('bell').setAttribute('aria-expanded', 'true'))

// One row a conversation, newest first: the latest of its notifications, and how many are unread.
function drawNotes () {
  const n = S.notes.unread.total
  $('bell-n').textContent = cap(n)
  $('bell').classList.toggle('new', n > 0)
  $('bell').setAttribute('aria-label', n ? n + ' new notifications' : 'Notifications')
  if ($('notes').hidden) { $('bell').setAttribute('aria-expanded', 'false'); return }
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
}
function closeConfig () {
  $('config').hidden = true
  if (!menuOpen && $('devices').hidden) frame.send('cover', { full: false })
}
$('cf-close').onclick = closeConfig
$('cf-devices').onclick = () => { closeConfig(); openDevices() }

function toggle (label, on, fn) {
  const b = el('button', 'choice', label)
  b.setAttribute('aria-pressed', String(on))
  b.onclick = fn
  return b
}
// Per app: allowed or blocked, its text shown or hidden; per conversation: muted. The person's settings, on all
// their devices (the engine's notify.set).
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

// --- the Devices window (spec 012): one identity on several computers ---

let D = null // the last devices.list: { identity, devices, removed, phrase, owns }
const out = $('dv-out')
const show = (...nodes) => out.replaceChildren(...nodes)
const line = (text, cls) => el('p', cls, text)
function push (text, fn) {
  const b = el('button', 'push', text)
  b.onclick = fn
  return b
}
const password = () => $('dv-pass').value || undefined

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
  D = r.result
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

// --- toolbar ---

$('back').onclick = () => send('back')
$('forward').onclick = () => send('forward')
$('reload').onclick = () => send('reload')
$('star').onclick = () => send('bookmark')
$('plus').onclick = () => { send('select', { id: 0 }); toAddress() }
$('panel-close').onclick = () => send('close', { id: S.current })
$('panel-retry').onclick = async () => { const t = currentTab(); await send('close', { id: t.id }); send('open', { input: t.key }) }

const addr = $('address')
function toAddress () { addr.focus(); addr.select() }
addr.onfocus = () => {
  const t = currentTab()
  addr.value = t.id === 0 ? '' : t.key // the full key while editing
  addr.select()
}
addr.onblur = () => render()
addr.onkeydown = async (e) => {
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
// Narrow ones show their icon only (close: Ctrl+W or the middle button).
// shortcut: past ~35 tabs on a 1280 px window the last ones are cut off; a tab list menu if that matters.
function sizeTabs () {
  const tabs = $('tabs').children
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
frame.onState((s) => {
  S = s
  render()
  drawConfig()
  // a join ended (spec 012): main now runs the engine of whichever identity is in place
  if (S.joined && S.joined.n !== joinedSeen) {
    joinedSeen = S.joined.n
    openDevices(S.joined.said === 'joined' ? 'This computer is now a device of your identity.' : 'Could not join: ' + S.joined.said + '. This computer is as it was.')
  }
})
frame.onFocusAddress(toAddress)
frame.send('glyphs').then((r) => {
  GLYPHS = r.result
  for (const g of document.querySelectorAll('[data-g]')) setGlyph(g, g.dataset.g)
  return frame.send('hello')
}).then((r) => { S = r.result; render(); measure() })
