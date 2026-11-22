import { chat, ROLES, MODERATORS, INVITERS, copiesLine, circleOf, acceptLabel, CHANGE_KEY, SECURE_TEXT, FORGET_TEXT, TRIM_TEXT, SUGGEST_SECURE, RENEW_WAITING, renewError, trimBefore, ENCRYPTED, ENCRYPTED_KEPT, KEEP_HISTORY_TEXT, HIDE_HISTORY_TEXT, DISAPPEAR, DISAPPEAR_NOTE, disappearLabel, deviceNotices } from './lib/chat.js'
import { keepScroll, newLine } from './lib/scroll.js'

/**
 * @typedef {import('./lib/chat.js').Conversation} Conversation
 * @typedef {object} View The conversation open.
 * @property {string} key
 * @property {Hyper.Record[]} messages oldest first
 * @property {Hyper.Record[]} invites
 * @property {Map<string, string>} names
 * @property {Hyper.Member[] | null} members
 * @property {string | null} role
 * @property {Hyper.Record | null} editing
 * @property {string | null} menu the "…" open: a message's id, or 'info'
 * @property {number} unread when it was opened
 * @property {number | null} line where the "New messages" line goes
 * @property {boolean} placed scrolled to the line once
 * @property {Hyper.Copies | null} copies
 * @property {boolean} gone secured without this person
 * @property {boolean} waiting
 * @property {'secure' | 'trim' | 'history' | null} confirm
 * @property {string | null} history 'hidden' or 'visible' (a private conversation's)
 * @property {number | null} disappearing ms, or null: off
 * @property {boolean} offerSecure after a removal: offers to secure the group
 * @property {boolean} forget
 * @property {number} trimN
 * @property {string} trimUnit
 * @property {string | null} [draft]
 * @property {boolean} [toEnd]
 */

const hyper = /** @type {Hyper.Site} */ (window.hyper) // undefined outside HyperBrowser: start() checks
const root = /** @type {HTMLElement} */ (document.getElementById('app'))
const c = /** @type {ReturnType<typeof chat>} */ (hyper && chat(hyper))
// set by start() before any draw
let me = /** @type {Awaited<ReturnType<Hyper.Site['contacts']['me']>>} */ (/** @type {unknown} */ (null))
/** @type {Hyper.Contact[]} */
let contacts = []
/** @type {Conversation[]} */
let convs = []
let current = new URLSearchParams(location.search).get('instance')
// null while no conversation is open: what runs then checks
let view = /** @type {View} */ (/** @type {unknown} */ (null))
/** @type {Hyper.Unsubscribe[]} */
let stops = []
/** @type {{ [name: string]: unknown }} */
let joined = {}
let notice = ''
/** @type {{ [instance: string]: { count: number, dot: boolean } }} */
let counts = {}

start().catch((err) => {
  root.replaceChildren(h('p', {}, err.code === 'NOT_ALLOWED' ? 'Chat needs your identity and your contacts. Reload the page to be asked again.' : 'Chat could not start: ' + err.message))
})

async function start () {
  if (!hyper) return root.replaceChildren(h('p', {}, 'Open Chat in HyperBrowser.'))
  me = await hyper.contacts.me()
  joined = await hyper.mine.all()
  counts = (await hyper.notifications?.unread?.().catch(() => null)) || {}
  hyper.notifications?.on?.((u) => { counts = u; draw() })
  hyper.contacts.on(() => refresh().catch(() => {}))
  const shut = () => { if (view?.menu) { view.menu = null; draw() } }
  document.addEventListener('click', (e) => { if (!/** @type {Element} */ (e.target).closest('details')) shut() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut() })
  await refresh()
  if (current) open(current)
}

async function refresh () {
  contacts = await hyper.contacts.list()
  convs = await c.conversations()
  draw()
}

/** @param {string} k */
const short = (k) => k.slice(0, 8) + '…'
/** @param {Conversation} x */
const titleOf = (x) => x.direct ? (x.direct.name || short(x.direct.identity)) : (x.name || 'Group')
/** @param {string} id */
function nameOf (id) {
  if (id === me.identity) return 'you'
  return view?.names.get(id) || contacts.find((x) => x.identity === id)?.name || short(id)
}

/** @param {string} key */
function open (key) {
  for (const s of stops) s()
  stops = []
  current = key
  history.replaceState(null, '', '?instance=' + key)
  hyper.notifications?.viewing(key).catch(() => {}) // shown here, so not notified
  view = { key, messages: [], invites: [], names: new Map(), members: null, role: null, editing: null, menu: null, unread: counts[key]?.count || 0, line: null, placed: false, copies: null, gone: false, waiting: false, confirm: null, forget: false, trimN: 6, trimUnit: 'months', history: null, disappearing: null, offerSecure: false }
  const v = view
  // secured without this person (no new address), or secured here (waiting for another admin's device)
  const info = () => c.info(key).then((i) => { if (view === v) { v.gone = !!i.moved && !i.movedTo; v.waiting = !!i.renewal?.waiting; v.history = i.private ? i.history : null; v.disappearing = i.disappearing ?? null; draw() } }, () => {})
  info()
  const copies = () => c.copies(key).then((x) => { if (view === v) { v.copies = x; draw() } }, () => {})
  const names = () => c.names(key).then((n) => { if (view === v) { v.names = n; draw() } }, () => {})
  const members = () => {
    c.role(key).then((r) => { v.role = r; draw() }, () => {})
    c.members(key).then((m) => { v.members = m; draw() }, () => {})
  }
  stops.push(c.messages(key, ({ items, complete }) => {
    v.messages = items.slice().reverse()
    if (v.line === null && (complete || items.length >= v.unread)) v.line = newLine(v.messages, v.unread, me.identity)
    if (items.some((m) => !v.names.has(m.author))) names()
    draw()
  }))
  stops.push(c.invites(key, ({ items }) => { v.invites = items; draw() }))
  stops.push(hyper.instance(key).on('members', members))
  stops.push(hyper.instance(key).on('devices', members)) // "X added a device"
  stops.push(c.keepProfile(key)) // the name, once this device holds the key
  stops.push(hyper.instance(key).on('decisions', info)) // the history and timer settings
  stops.push(c.onCopies(key, (x) => { v.copies = x; draw() }))
  copies()
  names()
  members()
  draw()
}

function draw () {
  const conv = convs.find((x) => x.key === current)
  // a redraw (a message arriving) keeps the writer's caret and the reader's place
  const typing = /** @type {HTMLTextAreaElement | null} */ (document.activeElement)?.name === 'text' ? /** @type {[number, number]} */ ([/** @type {HTMLTextAreaElement} */ (document.activeElement).selectionStart, /** @type {HTMLTextAreaElement} */ (document.activeElement).selectionEnd]) : null
  const top = keepScroll(root.querySelector('[data-key]'), view?.key, view?.toEnd)
  if (view) view.toEnd = false
  // overflow-wrap: a long word (an hg: link) wraps anywhere rather than widen the page
  root.replaceChildren(h('div', { style: 'display:flex; gap:16px; flex:1; min-height:0; padding:4px; overflow-wrap:anywhere' },
    h('nav', { style: 'width:220px; flex:none; display:flex; flex-direction:column; min-height:0' },
      h('h2', {}, 'Chat'),
      h('p', { class: 'small' }, 'You are ', h('b', {}, me.name || '(no name yet)'), ' · ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(me.identity)) } }, 'Contacts')),
      h('ul', { style: 'list-style:none; padding:0; margin:0 0 8px; flex:1; min-height:0; overflow:auto' }, convs.map((x) => h('li', {},
        h('a', { href: '#', 'aria-current': x.key === current ? 'page' : null, onclick: (e) => { e.preventDefault(); open(x.key) } },
          x.direct ? '@ ' : '# ', titleOf(x)),
        counts[x.key]?.count ? h('b', { 'aria-label': counts[x.key].count + ' unread' }, ' (' + counts[x.key].count + ')') : null))),
      convs.length ? null : h('p', { class: 'small' }, 'No conversations yet: become friends with someone in Contacts.'),
      h('form', { onsubmit: newGroup }, h('input', { name: 'name', placeholder: 'New group name', maxlength: 200 }), ' ', h('button', {}, 'Create'))),
    h('main', { style: 'flex:1; min-width:0; display:flex; flex-direction:column; min-height:0' }, notice ? h('p', { role: 'alert' }, notice) : null,
      view && conv ? (view.gone ? h('p', {}, 'You no longer have access to this group: it was secured, and you were not taken along.') : conversation(conv)) : h('p', {}, 'Pick a conversation.'))))
  const list = root.querySelector('[data-key]')
  if (list) list.scrollTop = top ?? list.scrollHeight
  const line = /** @type {HTMLElement | null | undefined} */ (list?.querySelector('.new-line'))
  if (list && line && !view.placed) {
    view.placed = true
    list.scrollTop = Math.max(0, line.offsetTop - 8)
  }
  if (typing) {
    const box = /** @type {HTMLTextAreaElement | null} */ (root.querySelector('textarea[name=text]'))
    box?.focus()
    box?.setSelectionRange(...typing)
  }
}

/** @param {Conversation} conv */
function conversation (conv) {
  const mod = MODERATORS.has(view.role)
  const out = [h('h2', {}, conv.direct ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(/** @type {Hyper.Contact} */ (conv.direct).identity)) } }, titleOf(conv)) : '# ' + titleOf(conv), ' ', info())]
  for (const inv of view.invites) {
    if (inv.author === me.identity || joined['invite:' + inv.id]) continue
    out.push(h('p', {}, nameOf(inv.author), ' invites you to the group ', h('b', {}, inv.name), ' ', h('button', { onclick: () => join(inv) }, 'Join')))
  }
  const notices = deviceNotices(view.members || [], nameOf)
  /** @param {number} stamp */
  const noticesUntil = (stamp) => {
    const lines = []
    while (notices.length && notices[0].at <= stamp) lines.push(h('p', { class: 'small device-notice', role: 'note', style: 'text-align:center; margin:4px 0' }, /** @type {{ text: string }} */ (notices.shift()).text))
    return lines
  }
  out.push(h('div', { 'data-key': view.key, style: 'flex:1; min-height:3em; overflow:auto; position:relative' }, view.messages.map((m, i) => [
    noticesUntil(m.stamp),
    i === view.line ? h('p', { class: 'new-line', role: 'separator', 'aria-label': 'New messages', style: 'text-align:center; color:var(--accent, #1f4fd1); border-top:1px solid; margin:8px 0 0' }, 'New messages') : null,
    h('p', {},
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(m.author)) } }, h('b', {}, nameOf(m.author))),
      h('span', { class: 'small' }, ' ', new Date(m.stamp).toLocaleString(), m.edited ? ' (edited)' : ''), ' ',
      menu(m, mod), h('br'),
      body(m))]), noticesUntil(Infinity)))
  if (view.offerSecure) out.push(h('p', { role: 'alert' }, SUGGEST_SECURE, ' ', h('button', { onclick: () => { view.offerSecure = false; view.confirm = 'secure'; view.forget = false; view.menu = 'info'; draw() } }, 'Secure this group…')))
  out.push(h('form', { onsubmit: send },
    h('textarea', { name: 'text', rows: 3, style: 'width:100%', placeholder: view.editing ? 'Edit your message' : 'Write a message (Enter sends, Shift+Enter: new line)', onkeydown: enter, oninput: (e) => { view.draft = e.target.value }, value: view.draft ?? view.editing?.text ?? '' }),
    h('button', {}, view.editing ? 'Save' : 'Send'), view.editing ? h('button', { type: 'button', onclick: () => { view.editing = view.draft = null; draw() } }, 'Cancel') : null))
  if (!conv.direct) out.push(h('div', { style: 'flex:none; max-height:35%; overflow:auto' }, group(conv)))
  return out
}

// An Accept button only asks HyperBrowser: the page never joins a circle itself.
/** @param {Hyper.Record} m */
function body (m) {
  const inv = circleOf(m)
  if (!inv) return h('span', { style: 'white-space:pre-wrap' }, m.text)
  if (m.author === me.identity) return h('span', {}, 'You invited them to the circle "' + inv.name + '"')
  return h('button', { onclick: () => act(async () => { if ((await c.joinCircle(inv)).joined) notice = 'You joined "' + inv.name + '".' }) }, acceptLabel(nameOf(m.author), inv.name))
}

// A "…" menu's content floats under it, moving nothing; text-indent: the theme's list rows indent
const MENU = 'display:inline-block; position:relative; text-indent:0'
const DROP = 'position:absolute; top:100%; left:0; z-index:10; display:flex; flex-direction:column; align-items:flex-start; gap:4px; padding:4px 8px; white-space:nowrap; background:var(--paper, Canvas); color:var(--ink, CanvasText); border:1px solid; box-shadow:2px 2px 0 var(--ink, CanvasText)'

function info () {
  const line = view.copies && copiesLine(view.copies)
  const owner = view.role === 'owner'
  const direct = !!convs.find((x) => x.key === view.key)?.direct
  const decides = owner || view.role === 'admin' // both people of a direct conversation are admins
  const admin = !direct && decides
  const encrypted = view.history ? (view.history === 'hidden' ? ENCRYPTED : ENCRYPTED_KEPT) : null
  if (!line && !owner && !admin && !view.waiting && !encrypted) return null
  return h('details', { style: MENU + '; font-size:initial; font-weight:normal', open: view.menu === 'info' ? '' : null, ontoggle: (e) => { if (e.target.open) view.menu = 'info'; else if (view.menu === 'info') view.menu = null } },
    h('summary', { 'aria-label': 'About this conversation', style: 'display:inline; cursor:pointer; list-style:none' }, '…'),
    h('div', { style: DROP + '; width:280px; white-space:normal' },
      encrypted ? h('p', { class: 'encrypted', style: 'margin:0' }, encrypted) : null,
      view.history ? h('p', { style: 'margin:0' }, 'Messages disappear: ',
        decides
          ? h('select', { 'aria-label': 'Messages disappear after', onchange: (e) => act(async () => { const ms = DISAPPEAR[e.target.selectedIndex][0]; await c.disappearAfter(view.key, ms); view.disappearing = ms }) },
            DISAPPEAR.map(([ms, label]) => h('option', { selected: ms === view.disappearing ? '' : null }, label)))
          : disappearLabel(view.disappearing)) : null,
      view.history && (decides || view.disappearing) ? h('p', { role: 'note', class: 'small', style: 'margin:0' }, DISAPPEAR_NOTE) : null,
      admin && view.history ? h('button', { onclick: () => { view.confirm = 'history'; draw() } }, view.history === 'hidden' ? 'Keep history for new members…' : 'Stop keeping history…') : null,
      view.confirm === 'history' ? h('div', { role: 'alert' }, h('p', { style: 'margin:0' }, view.history === 'hidden' ? KEEP_HISTORY_TEXT : HIDE_HISTORY_TEXT),
        h('button', { onclick: () => act(async () => { const keep = view.history === 'hidden'; view.confirm = null; await c.keepHistory(view.key, keep); view.history = keep ? 'visible' : 'hidden' }) }, view.history === 'hidden' ? 'Keep history' : 'Stop keeping it'), ' ',
        h('button', { onclick: () => { view.confirm = null; draw() } }, 'Cancel')) : null,
      line ? h('p', { class: 'copies', style: 'margin:0' }, line.text) : null,
      line?.warn ? h('p', { class: 'copies-warn', role: 'note', style: 'margin:0' }, line.warn) : null,
      owner ? h('p', { style: 'margin:0' }, h('button', { onclick: () => act(async () => { await c.changeKey(view.key); notice = 'Key changed.' }) }, 'Change key'), ' ', h('span', { class: 'small' }, CHANGE_KEY)) : null,
      admin ? h('button', { onclick: () => { view.confirm = 'secure'; view.forget = false; draw() } }, 'Secure this group…') : null,
      admin ? h('button', { onclick: () => { view.confirm = 'trim'; draw() } }, 'Trim history…') : null,
      view.waiting ? h('p', { role: 'note', style: 'margin:0' }, RENEW_WAITING) : null,
      view.confirm === 'secure' ? h('div', { role: 'alert' }, h('p', { style: 'margin:0' }, SECURE_TEXT),
        h('label', {}, h('input', { type: 'checkbox', checked: view.forget ? '' : null, onchange: (e) => { view.forget = e.target.checked; draw() } }), ' Also delete history before now'),
        view.forget ? h('p', { role: 'note', style: 'margin:0' }, FORGET_TEXT) : null,
        h('button', { onclick: secure }, 'Secure'), ' ', h('button', { onclick: () => { view.confirm = null; draw() } }, 'Cancel')) : null,
      view.confirm === 'trim' ? h('div', { role: 'alert' }, h('p', { style: 'margin:0' }, 'Keep the last ',
        h('input', { type: 'number', min: 1, max: 1000, value: view.trimN, 'aria-label': 'How many', style: 'width:4em', oninput: (e) => { view.trimN = Math.max(1, Number(e.target.value) || 1) } }), ' ',
        h('select', { 'aria-label': 'Unit', onchange: (e) => { view.trimUnit = e.target.value } }, ...['days', 'weeks', 'months', 'years'].map((u) => h('option', { value: u, selected: view.trimUnit === u ? '' : null }, u)))),
        h('p', { role: 'note', style: 'margin:0' }, TRIM_TEXT),
        h('button', { onclick: trim }, 'Trim'), ' ', h('button', { onclick: () => { view.confirm = null; draw() } }, 'Cancel')) : null))
}

async function secure () {
  const forget = view.forget
  view.confirm = null
  notice = 'Securing…'
  draw()
  try {
    const r = await c.secure(view.key, { forgetHistory: forget })
    const st = await c.status(r.key).catch(() => null)
    convs = await c.conversations()
    notice = 'Secured.' + (st?.warnings?.some((w) => w.code === 'RENEW_WAITING') ? ' ' + RENEW_WAITING : '')
    open(r.key)
  } catch (err) {
    notice = renewError(/** @type {Hyper.Failure} */ (err), (k) => view?.names.get(k) || null)
    draw()
  }
}

async function trim () {
  const before = trimBefore(view.trimN, view.trimUnit)
  view.confirm = null
  notice = 'Trimming…'
  draw()
  try {
    await c.trimHistory(view.key, before)
    notice = 'Trimmed: messages from before ' + new Date(before).toLocaleDateString() + ' are deleted.'
  } catch (err) {
    notice = renewError(/** @type {Hyper.Failure} */ (err))
  }
  draw()
}

/** @param {Hyper.Record} m @param {boolean} mod */
function menu (m, mod) {
  const mine = m.author === me.identity
  if (!mine && !mod) return null
  return h('details', { style: MENU, open: view.menu === m.id ? '' : null, ontoggle: (e) => { if (e.target.open) view.menu = m.id; else if (view.menu === m.id) view.menu = null } },
    h('summary', { 'aria-label': 'Message actions', title: 'Edit, delete', style: 'display:inline; cursor:pointer; list-style:none' }, '…'),
    h('div', { style: DROP },
      mine ? h('button', { class: 'small', onclick: () => { view.menu = null; view.editing = m; view.draft = m.text; draw() } }, 'Edit') : null,
      h('button', { class: 'small', onclick: () => { view.menu = null; act(() => c.remove(view.key, m, mine)) } }, 'Delete')))
}

/** @param {Conversation} conv */
function group (conv) {
  const admin = view.role === 'owner' || view.role === 'admin'
  const mod = MODERATORS.has(view.role)
  const inside = new Set((view.members || []).filter((m) => m.role).map((m) => m.identity))
  const addable = contacts.filter((x) => x.state === 'friend' && !inside.has(x.identity))
  return h('section', {}, h('h3', {}, 'Members'),
    h('ul', {}, (view.members || []).filter((m) => m.role).map((m) => h('li', {}, nameOf(m.identity), ' · ',
      admin && m.role !== 'owner' && m.identity !== me.identity
        ? h('select', { onchange: (e) => act(() => c.grant(view.key, m.identity, e.target.value)) },
          Object.entries(ROLES).map(([r, label]) => h('option', { value: r, selected: r === m.role ? '' : null }, label)))
        : (ROLES[/** @type {string} */ (m.role)] || m.role),
      mod && m.role !== 'owner' && m.identity !== me.identity
        ? [' ', h('button', { class: 'small', onclick: () => act(async () => { await c.removeMember(view.key, m.identity); suggest() }) }, 'Remove'), ' ',
            h('button', { class: 'small', onclick: () => act(async () => { await c.ban(view.key, m.identity); suggest() }) }, 'Ban')]
        : null))),
    INVITERS.has(view.role) && addable.length
      ? h('form', { onsubmit: (e) => { e.preventDefault(); const f = addable.find((x) => x.identity === e.target.who.value); act(() => c.add(view.key, conv.name, f)) } },
        h('select', { name: 'who' }, addable.map((x) => h('option', { value: x.identity }, x.name || short(x.identity)))), ' ', h('button', {}, 'Add to the group'))
      : null,
    h('p', {}, h('button', { onclick: () => act(async () => { await c.leave(view.key); view = /** @type {View} */ (/** @type {unknown} */ (null)); current = null; await refresh() }) }, 'Leave the group')))
}

/** @type {Set<string>} */
const suggested = new Set()
function suggest () {
  if (suggested.has(view.key) || !['owner', 'admin'].includes(/** @type {string} */ (view.role)) || convs.find((x) => x.key === view.key)?.direct) return
  suggested.add(view.key)
  view.offerSecure = true
}

/** @param {() => Promise<unknown>} fn */
async function act (fn) {
  notice = ''
  try { await fn() } catch (e) { const err = /** @type {Hyper.Failure} */ (e); notice = (err.code === 'NOT_ALLOWED' ? 'Not allowed: ' : '') + err.message }
  draw()
}

/** @param {KeyboardEvent} e */
function enter (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); /** @type {HTMLFormElement} */ (/** @type {HTMLTextAreaElement} */ (e.target).form).requestSubmit() }
}

/** @param {SubmitEvent} e */
function send (e) {
  e.preventDefault()
  const text = /** @type {HTMLFormElement} */ (e.target).text.value
  const editing = view.editing
  act(async () => {
    if (editing) await c.edit(view.key, editing.id, text)
    else { await c.send(view.key, text); view.toEnd = true }
    view.editing = view.draft = null
  })
}

/** @param {SubmitEvent} e */
function newGroup (e) {
  e.preventDefault()
  const name = /** @type {{ name: HTMLInputElement }} */ (/** @type {unknown} */ (e.target)).name.value // the form's input named name
  act(async () => { const g = await c.group(name); await refresh(); open(g.key) })
}

/** @param {Hyper.Record} inv an invite record */
function join (inv) {
  act(async () => {
    const g = await c.join(inv.link)
    joined['invite:' + inv.id] = true
    await hyper.mine.set('invite:' + inv.id, true)
    await refresh()
    open(g.key)
  })
}

/**
 * @param {string} tag
 * @param {{ [name: string]: string | number | boolean | null | undefined | ((e: any) => void) } | null} [attrs]
 *   attribute values, `value`, and on* listeners (each gets its event: input, change, submit...)
 * @param {...unknown} children nodes, text and lists of them; null, undefined and false are left out
 */
function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), /** @type {EventListener} */ (v))
    else if (k === 'value') /** @type {HTMLInputElement} */ (el).value = /** @type {string} */ (v)
    else el.setAttribute(k, /** @type {string} */ (v))
  }
  for (const x of children.flat(Infinity)) if (x !== null && x !== undefined && x !== false) el.append(x instanceof Node ? x : String(x))
  return el
}
