// Chat's page: conversations on the left, the open one on the right, redrawn from live views. No
// stylesheet: HyperBrowser's default theme, with a few inline layout rules. Data: lib/chat.js.
// unread numbers in the list (HyperBrowser's counts), a "New messages" line, a "…" menu per message.
import { chat, ROLES, MODERATORS, INVITERS, copiesLine, circleOf, acceptLabel, CHANGE_KEY, SECURE_TEXT, FORGET_TEXT, TRIM_TEXT, SUGGEST_SECURE, RENEW_WAITING, renewError, trimBefore } from './lib/chat.js'
import { keepScroll, newLine } from './lib/scroll.js'

const hyper = window.hyper
const root = document.getElementById('app')
const c = hyper && chat(hyper)
let me = null
let contacts = []
let convs = []
let current = new URLSearchParams(location.search).get('instance')
let view = null // the open conversation: { key, messages, invites, names, members, role, editing }
let stops = []
let joined = {} // invite ids answered here (hyper.mine)
let notice = ''
let counts = {} // { [conversation]: { count, dot } }: unread, from HyperBrowser

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
  // an open "…" floats over the page; a click outside it or Escape closes it
  const shut = () => { if (view?.menu) { view.menu = null; draw() } }
  document.addEventListener('click', (e) => { if (!e.target.closest('details')) shut() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut() })
  await refresh()
  if (current) open(current)
}

async function refresh () {
  contacts = await hyper.contacts.list()
  convs = await c.conversations()
  draw()
}

const short = (k) => k.slice(0, 8) + '…'
const titleOf = (x) => x.direct ? (x.direct.name || short(x.direct.identity)) : (x.name || 'Group')
function nameOf (id) {
  if (id === me.identity) return 'you'
  return view?.names.get(id) || contacts.find((x) => x.identity === id)?.name || short(id)
}

function open (key) {
  for (const s of stops) s()
  stops = []
  current = key
  history.replaceState(null, '', '?instance=' + key)
  hyper.notifications?.viewing(key).catch(() => {}) // shown here, so not notified
  // unread: the count when it opened (read once shown); line: where "New messages" goes, once the messages are in
  view = { key, messages: [], invites: [], names: new Map(), members: null, role: null, editing: null, menu: null, unread: counts[key]?.count || 0, line: null, placed: false, copies: null, gone: false, waiting: false, confirm: null, forget: false, trimN: 6, trimUnit: 'months' }
  const v = view
  // secured without this person (no new address), or secured here (waiting for another admin's device)
  c.info(key).then((i) => { if (view === v) { v.gone = !!i.moved && !i.movedTo; v.waiting = !!i.renewal?.waiting; draw() } }, () => {})
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
  stops.push(c.onCopies(key, (x) => { v.copies = x; draw() }))
  copies()
  names()
  members()
  draw()
}

// --- drawing ---

function draw () {
  const conv = convs.find((x) => x.key === current)
  // a redraw (a message arriving) keeps the writer's caret and the reader's place
  const typing = document.activeElement?.name === 'text' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null
  const top = keepScroll(root.querySelector('[data-key]'), view?.key, view?.toEnd)
  if (view) view.toEnd = false
  // Chat fits the window (body.hb-app); the conversations and the messages scroll, never the page
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
  const line = list?.querySelector('.new-line')
  if (line && !view.placed) { // opened with unread messages: the line near the top, the first of them below it
    view.placed = true
    list.scrollTop = Math.max(0, line.offsetTop - 8)
  }
  if (typing) {
    const box = root.querySelector('textarea[name=text]')
    box?.focus()
    box?.setSelectionRange(...typing)
  }
}

function conversation (conv) {
  const mod = MODERATORS.has(view.role)
  const out = [h('h2', {}, conv.direct ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(conv.direct.identity)) } }, titleOf(conv)) : '# ' + titleOf(conv), ' ', info())]
  for (const inv of view.invites) {
    if (inv.author === me.identity || joined['invite:' + inv.id]) continue
    out.push(h('p', {}, nameOf(inv.author), ' invites you to the group ', h('b', {}, inv.name), ' ', h('button', { onclick: () => join(inv) }, 'Join')))
  }
  out.push(h('div', { 'data-key': view.key, style: 'flex:1; min-height:3em; overflow:auto; position:relative' }, view.messages.map((m, i) => [
    i === view.line ? h('p', { class: 'new-line', role: 'separator', 'aria-label': 'New messages', style: 'text-align:center; color:var(--accent, #1f4fd1); border-top:1px solid; margin:8px 0 0' }, 'New messages') : null,
    h('p', {},
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(m.author)) } }, h('b', {}, nameOf(m.author))),
      h('span', { class: 'small' }, ' ', new Date(m.stamp).toLocaleString(), m.edited ? ' (edited)' : ''), ' ',
      menu(m, mod), h('br'),
      body(m))])))
  out.push(h('form', { onsubmit: send },
    h('textarea', { name: 'text', rows: 3, style: 'width:100%', placeholder: view.editing ? 'Edit your message' : 'Write a message (Enter sends, Shift+Enter: new line)', onkeydown: enter, oninput: (e) => { view.draft = e.target.value }, value: view.draft ?? view.editing?.text ?? '' }),
    h('button', {}, view.editing ? 'Save' : 'Send'), view.editing ? h('button', { type: 'button', onclick: () => { view.editing = view.draft = null; draw() } }, 'Cancel') : null))
  if (!conv.direct) out.push(h('div', { style: 'flex:none; max-height:35%; overflow:auto' }, group(conv))) // a group's members: scroll on their own
  return out
}

// A message's text, or a circle's invite: an Accept button for its receiver, which only asks HyperBrowser.
function body (m) {
  const inv = circleOf(m)
  if (!inv) return h('span', { style: 'white-space:pre-wrap' }, m.text)
  if (m.author === me.identity) return h('span', {}, 'You invited them to the circle "' + inv.name + '"')
  return h('button', { onclick: () => act(async () => { if ((await c.joinCircle(inv)).joined) notice = 'You joined "' + inv.name + '".' }) }, acceptLabel(nameOf(m.author), inv.name))
}

// A "…" menu's content floats under it, moving nothing; text-indent: the theme's list rows indent
const MENU = 'display:inline-block; position:relative; text-indent:0'
const DROP = 'position:absolute; top:100%; left:0; z-index:10; display:flex; flex-direction:column; align-items:flex-start; gap:4px; padding:4px 8px; white-space:nowrap; background:var(--paper, Canvas); color:var(--ink, CanvasText); border:1px solid; box-shadow:2px 2px 0 var(--ink, CanvasText)'

// The conversation's "…": its copies ("Kept by N of 5 copies"), and Change key for its owner.
function info () {
  const line = view.copies && copiesLine(view.copies)
  const owner = view.role === 'owner'
  const admin = !convs.find((x) => x.key === view.key)?.direct && (owner || view.role === 'admin') // groups only
  if (!line && !owner && !admin && !view.waiting) return null
  return h('details', { style: MENU + '; font-size:initial; font-weight:normal', open: view.menu === 'info' ? '' : null, ontoggle: (e) => { if (e.target.open) view.menu = 'info'; else if (view.menu === 'info') view.menu = null } },
    h('summary', { 'aria-label': 'About this conversation', style: 'display:inline; cursor:pointer; list-style:none' }, '…'),
    h('div', { style: DROP + '; width:280px; white-space:normal' },
      line ? h('p', { class: 'copies', style: 'margin:0' }, line.text) : null,
      line?.warn ? h('p', { class: 'copies-warn', role: 'note', style: 'margin:0' }, line.warn) : null,
      owner ? h('p', { style: 'margin:0' }, h('button', { onclick: () => act(async () => { await c.changeKey(view.key); notice = 'Key changed.' }) }, 'Change key'), ' ', h('span', { class: 'small' }, CHANGE_KEY)) : null,
      admin ? h('button', { onclick: () => { view.confirm = 'secure'; view.forget = false; draw() } }, 'Secure this place…') : null,
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

// a short progress line, then the group at its new address (or the error in plain words)
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
    notice = renewError(err, (k) => view?.names.get(k) || null)
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
    notice = renewError(err)
  }
  draw()
}

// One discreet "…" per message: its Edit and Delete (a <details>: Enter or Space opens it). Kept open across redraws.
function menu (m, mod) {
  const mine = m.author === me.identity
  if (!mine && !mod) return null
  return h('details', { style: MENU, open: view.menu === m.id ? '' : null, ontoggle: (e) => { if (e.target.open) view.menu = m.id; else if (view.menu === m.id) view.menu = null } },
    h('summary', { 'aria-label': 'Message actions', title: 'Edit, delete', style: 'display:inline; cursor:pointer; list-style:none' }, '…'),
    h('div', { style: DROP },
      mine ? h('button', { class: 'small', onclick: () => { view.menu = null; view.editing = m; view.draft = m.text; draw() } }, 'Edit') : null,
      h('button', { class: 'small', onclick: () => { view.menu = null; act(() => c.remove(view.key, m, mine)) } }, 'Delete')))
}

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
        : (ROLES[m.role] || m.role),
      mod && m.role !== 'owner' && m.identity !== me.identity
        ? [' ', h('button', { class: 'small', onclick: () => act(async () => { await c.removeMember(view.key, m.identity); suggest() }) }, 'Remove'), ' ',
            h('button', { class: 'small', onclick: () => act(async () => { await c.ban(view.key, m.identity); suggest() }) }, 'Ban')]
        : null))),
    INVITERS.has(view.role) && addable.length
      ? h('form', { onsubmit: (e) => { e.preventDefault(); const f = addable.find((x) => x.identity === e.target.who.value); act(() => c.add(view.key, conv.name, f)) } },
        h('select', { name: 'who' }, addable.map((x) => h('option', { value: x.identity }, x.name || short(x.identity)))), ' ', h('button', {}, 'Add to the group'))
      : null,
    h('p', {}, h('button', { onclick: () => act(async () => { await c.leave(view.key); view = null; current = null; await refresh() }) }, 'Leave the group')))
}

// --- actions ---

// after a removal or a ban in a group, Secure this place is suggested once (its owner, admins)
const suggested = new Set()
function suggest () {
  if (suggested.has(view.key) || !['owner', 'admin'].includes(view.role) || convs.find((x) => x.key === view.key)?.direct) return
  suggested.add(view.key)
  notice = SUGGEST_SECURE
}

async function act (fn) {
  notice = ''
  try { await fn() } catch (err) { notice = (err.code === 'NOT_ALLOWED' ? 'Not allowed: ' : '') + err.message }
  draw()
}

function enter (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit() }
}

function send (e) {
  e.preventDefault()
  const text = e.target.text.value
  const editing = view.editing
  act(async () => {
    if (editing) await c.edit(view.key, editing.id, text)
    else { await c.send(view.key, text); view.toEnd = true }
    view.editing = view.draft = null
  })
}

function newGroup (e) {
  e.preventDefault()
  const name = e.target.name.value
  act(async () => { const g = await c.group(name); await refresh(); open(g.key) })
}

function join (inv) {
  act(async () => {
    const g = await c.join(inv.link)
    joined['invite:' + inv.id] = true
    await hyper.mine.set('invite:' + inv.id, true)
    await refresh()
    open(g.key)
  })
}

function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v)
  }
  for (const x of children.flat(Infinity)) if (x !== null && x !== undefined && x !== false) el.append(x instanceof Node ? x : String(x))
  return el
}
