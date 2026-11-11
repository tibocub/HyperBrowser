// Chat's page (spec 013): conversations on the left, the open one on the right, redrawn from live views. No
// stylesheet: HyperBrowser's default theme, with a few inline layout rules. Data: lib/chat.js.
import { chat, ROLES, MODERATORS, INVITERS } from './lib/chat.js'
import { keepScroll } from './lib/scroll.js'

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

start().catch((err) => {
  root.replaceChildren(h('p', {}, err.code === 'NOT_ALLOWED' ? 'Chat needs your identity and your contacts. Reload the page to be asked again.' : 'Chat could not start: ' + err.message))
})

async function start () {
  if (!hyper) return root.replaceChildren(h('p', {}, 'Open Chat in HyperBrowser.'))
  me = await hyper.contacts.me()
  joined = await hyper.mine.all()
  hyper.contacts.on(() => refresh().catch(() => {}))
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
  view = { key, messages: [], invites: [], names: new Map(), members: null, role: null, editing: null }
  const v = view
  const names = () => c.names(key).then((n) => { if (view === v) { v.names = n; draw() } }, () => {})
  const members = () => {
    c.role(key).then((r) => { v.role = r; draw() }, () => {})
    c.members(key).then((m) => { v.members = m; draw() }, () => {})
  }
  stops.push(c.messages(key, ({ items }) => {
    v.messages = items.slice().reverse()
    if (items.some((m) => !v.names.has(m.author))) names()
    draw()
  }))
  stops.push(c.invites(key, ({ items }) => { v.invites = items; draw() }))
  stops.push(hyper.instance(key).on('members', members))
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
  root.replaceChildren(h('div', { style: 'display:flex; gap:16px; align-items:flex-start; padding:8px' },
    h('nav', { style: 'width:220px; flex:none' },
      h('h2', {}, 'Chat'),
      h('p', { class: 'small' }, 'You are ', h('b', {}, me.name || '(no name yet)'), ' · ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(me.identity)) } }, 'Contacts')),
      h('ul', { style: 'list-style:none; padding:0' }, convs.map((x) => h('li', {},
        h('a', { href: '#', 'aria-current': x.key === current ? 'page' : null, onclick: (e) => { e.preventDefault(); open(x.key) } },
          x.direct ? '@ ' : '# ', titleOf(x))))),
      convs.length ? null : h('p', { class: 'small' }, 'No conversations yet: become friends with someone in Contacts.'),
      h('form', { onsubmit: newGroup }, h('input', { name: 'name', placeholder: 'New group name', maxlength: 200 }), ' ', h('button', {}, 'Create'))),
    h('main', { style: 'flex:1; min-width:0' }, notice ? h('p', { role: 'alert' }, notice) : null,
      view && conv ? conversation(conv) : h('p', {}, 'Pick a conversation.'))))
  const list = root.querySelector('[data-key]')
  if (list) list.scrollTop = top ?? list.scrollHeight
  if (typing) {
    const box = root.querySelector('textarea[name=text]')
    box?.focus()
    box?.setSelectionRange(...typing)
  }
}

function conversation (conv) {
  const mod = MODERATORS.has(view.role)
  const out = [h('h2', {}, conv.direct ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(conv.direct.identity)) } }, titleOf(conv)) : '# ' + titleOf(conv))]
  for (const inv of view.invites) {
    if (inv.author === me.identity || joined['invite:' + inv.id]) continue
    out.push(h('p', {}, nameOf(inv.author), ' invites you to the group ', h('b', {}, inv.name), ' ', h('button', { onclick: () => join(inv) }, 'Join')))
  }
  out.push(h('div', { 'data-key': view.key, style: 'max-height:60vh; overflow:auto' }, view.messages.map((m) => h('p', {},
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); act(() => hyper.people.contact(m.author)) } }, h('b', {}, nameOf(m.author))),
    h('span', { class: 'small' }, ' ', new Date(m.stamp).toLocaleString(), m.edited ? ' (edited)' : ''), h('br'),
    h('span', { style: 'white-space:pre-wrap' }, m.text), ' ',
    m.author === me.identity ? h('button', { class: 'small', onclick: () => { view.editing = m; view.draft = m.text; draw() } }, 'Edit') : null,
    m.author === me.identity || mod ? h('button', { class: 'small', onclick: () => act(() => c.remove(view.key, m, m.author === me.identity)) }, 'Delete') : null))))
  out.push(h('form', { onsubmit: send },
    h('textarea', { name: 'text', rows: 3, style: 'width:100%', placeholder: view.editing ? 'Edit your message' : 'Write a message (Enter sends, Shift+Enter: new line)', onkeydown: enter, oninput: (e) => { view.draft = e.target.value }, value: view.draft ?? view.editing?.text ?? '' }),
    h('button', {}, view.editing ? 'Save' : 'Send'), view.editing ? h('button', { type: 'button', onclick: () => { view.editing = view.draft = null; draw() } }, 'Cancel') : null))
  if (!conv.direct) out.push(group(conv))
  return out
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
        ? [' ', h('button', { class: 'small', onclick: () => act(() => c.removeMember(view.key, m.identity)) }, 'Remove'), ' ',
            h('button', { class: 'small', onclick: () => act(() => c.ban(view.key, m.identity)) }, 'Ban')]
        : null))),
    INVITERS.has(view.role) && addable.length
      ? h('form', { onsubmit: (e) => { e.preventDefault(); const f = addable.find((x) => x.identity === e.target.who.value); act(() => c.add(view.key, conv.name, f)) } },
        h('select', { name: 'who' }, addable.map((x) => h('option', { value: x.identity }, x.name || short(x.identity)))), ' ', h('button', {}, 'Add to the group'))
      : null,
    h('p', {}, h('button', { onclick: () => act(async () => { await c.leave(view.key); view = null; current = null; await refresh() }) }, 'Leave the group')))
}

// --- actions ---

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
