// The forum's page: one page, hash routes, redrawn from live views. The data: lib/forum.js; what is
// derived: lib/view.js; post text: lib/text.js; icons: lib/icon.js. The shell draws the frame; this, the content.
// on the left, your forums (dots, numbers, join, leave), then this forum's boards (dots).
import { forum, watch, people, LIMITS, MODERATORS, ADMINS, copiesLine, CHANGE_KEY, SECURE_TEXT, FORGET_TEXT, TRIM_TEXT, SUGGEST_SECURE, RENEW_WAITING, renewError, trimBefore } from './lib/forum.js'
import { summarize, sortThreads, tally, score, voteOf, nextVote, tree, visible, ago, boardTree, SORTS, addNew, pruneUnread, without } from './lib/view.js'
import { render as renderText, toStored, toDraft, plain, shortKey } from './lib/text.js'
import * as icon from './lib/icon.js'

const app = document.getElementById('app')
// The forum app: each forum is an instance of it, owned by whoever made it; ?instance=<key> says which.
// With none, the start page: your forums, the official one, make one, join one.
const at = new URLSearchParams(location.search).get('instance')
const hyper = window.hyper && at ? window.hyper.instance(at) : null
const SORT_LABELS = { activity: 'Activity', newest: 'Newest', top: 'Top', lively: 'Lively' }

let f = null
let me = null
let mine = {}
let data = { complete: {}, boards: [], threads: [], comments: [], votes: [], profiles: [], avatars: [] }
let names = new Map()
let peers = 0
let notice = ''
let title = 'Forum' // the forum's name, once known
const drafts = {} // form key → { text, title, picks }
const ui = { folded: new Set(), replyTo: null, editing: null, confirm: null, invite: null, members: null, reports: null, hidden: null, iconDraft: null, joining: null, leaveWarning: null, forget: false, trimN: 6, trimUnit: 'months', suggest: null, suggested: new Set() }
const opened = {} // thread id → the ids of its replies new when it was opened ("new" marks)
let news = { cursor: null, unread: {} } // what is new, found with since() (lib/forum.js catchUp)
let forums = [] // the person's forums (this app's instances)
let counts = {} // { [forum]: { count, dot } }: the forums' numbers and dots
let follows = [] // this app's follows (boards, people)
let collapsed = false // the forums column
let threadView = { id: null, stop: null, items: [], complete: false }
let mentionView = { items: [], complete: false, seenAtOpen: null }
const about = {} // { [forum]: { copies, private } }, read when its "…" opens

// --- start ---

start().catch((err) => {
  app.replaceChildren(h('div', { class: 'desk' }, windowBox('HyperBrowser Forum', h('p', { class: 'pad' },
    err.code === 'NOT_ALLOWED' ? 'This forum needs your identity to show who wrote what. Reload the page to be asked again.' : 'The forum could not start: ' + (err.code || '') + ' ' + err.message))))
})

async function start () {
  if (!window.hyper) {
    app.replaceChildren(windowBox('HyperBrowser Forum', h('p', { class: 'pad' }, 'Open this forum in HyperBrowser: it lives on its members\' computers, not on a server.')))
    return
  }
  if (!hyper) return startPage()
  f = forum(hyper)
  me = await f.me() // the identity question, once per site
  if (me.moved && !me.movedTo) { // secured without this person (removed or banned): no new address
    app.replaceChildren(windowBox(me.name || 'Forum', h('p', { class: 'pad' }, 'You no longer have access to this forum: it was secured, and you were not taken along.')))
    return
  }
  if (me.key !== at) history.replaceState(null, '', '?instance=' + me.key + location.hash) // secured: its new address
  title = (await hyper.info()).name || title
  document.title = title
  mine = await f.mine()
  news = { cursor: mine.cursor ?? null, unread: mine.unread || {} }
  const stamps = Object.keys(mine).filter((n) => n.startsWith('read/')) // an older format's read stamps, replaced by since(): dropped
  if (stamps.length) f.forget(stamps).catch(() => {})
  let pruned = false
  watch(hyper, (state, name) => {
    data = state
    names = people(state.profiles, state.avatars)
    if (!pruned && state.complete.threads) { // once per visit: unread only for the threads shown
      pruned = true
      news = { ...news, unread: pruneUnread(news.unread, new Set(state.threads.map((x) => x.id))) }
    }
    if (name === 'threads' || name === 'comments') catchUpSoon()
    schedule()
  })
  catchUpSoon()
  panel().catch(() => {})
  hyper.query('mention').where({ who: me.identity }).live(({ items, complete }) => { mentionView.items = items; mentionView.complete = complete; schedule() }, { limit: 200 })
  hyper.on('members', () => { refreshRole(); if (route().page === 'members') loadMembers() })
  hyper.on('peers', (list) => { peers = Array.isArray(list) ? list.length : peers; schedule() })
  hyper.peers().then((list) => { peers = list.length; schedule() }, () => {})
  window.addEventListener('hashchange', () => { ui.replyTo = ui.editing = ui.confirm = ui.joining = null; enter(); schedule() })
  window.hyper.notifications?.viewing(at).catch(() => {}) // this forum is shown here, so not notified
  enter()
  schedule()
}

// --- what is new: since() from the cursor kept in mine, by message numbers, never by dates ---

let catching = null
function catchUpSoon () {
  clearTimeout(catching)
  catching = setTimeout(async () => {
    let r
    try { r = await f.catchUp({ cursor: news.cursor }, me.identity) } catch { return }
    const unread = { ...news.unread } // merged into what is now (a thread opened meanwhile stays read)
    for (const [k, l] of Object.entries(r.unread)) unread[k] = [...(unread[k] || []), ...l]
    const shown = route().page === 't' ? route().id : null
    news = { cursor: r.cursor, unread: shown ? without(addNew(unread, [], me.identity), shown) : addNew(unread, [], me.identity) } // capped; the open thread is read
    f.saveUnread(news).catch(() => {})
    schedule()
  }, 300)
}

// --- the left columns: your forums, with HyperBrowser's numbers and dots; join, make, leave ---

async function panel () {
  const root = window.hyper
  const saved = (await root.mine.all().catch(() => ({}))).panel
  collapsed = saved ? saved === 'collapsed' : innerWidth < 700 // narrow: collapsed unless chosen
  await loadForums()
  root.notifications?.on?.((u) => {
    if (Object.keys(u).sort().join() !== forums.map((x) => x.key).sort().join()) loadForums().catch(() => {}) // joined or left elsewhere
    counts = u
    schedule()
  })
  await loadFollows()
}

async function loadForums () {
  forums = await window.hyper.instances.list()
  counts = (await window.hyper.notifications?.unread?.().catch(() => null)) || counts
  schedule()
}

async function loadFollows () {
  follows = (await window.hyper.notifications?.follows?.().catch(() => null)) || []
  schedule()
}

function forumsColumn () {
  const toggle = h('button', {
    class: 'link fold-col',
    'aria-expanded': String(!collapsed),
    'aria-label': collapsed ? 'Show your forums' : 'Hide your forums',
    onclick: () => { collapsed = !collapsed; schedule(); window.hyper.mine.set('panel', collapsed ? 'collapsed' : 'open').catch(() => {}) }
  }, collapsed ? '»' : '«')
  const row = (i) => {
    const c = counts[i.key] || {}
    const label = i.name || shortKey(i.key)
    return h('li', {},
      h('div', { class: 'forum-row' },
        h('a', { class: 'forum', href: '?instance=' + i.key, 'aria-current': i.key === at ? 'page' : null, title: label },
          h('span', { class: 'grow name' }, collapsed ? label.slice(0, 2) : label),
          c.count ? h('span', { class: 'num', 'aria-label': c.count + ' unread' }, String(c.count)) : c.dot ? h('span', { class: 'dot', 'aria-label': 'new posts' }, '●') : null),
        collapsed ? null : h('details', { class: 'menu', open: ui.menu === i.key ? '' : null, ontoggle: (e) => { if (e.target.open) { if (ui.menu !== i.key) readAbout(i); ui.menu = i.key } else if (ui.menu === i.key) ui.menu = null } },
          h('summary', { 'aria-label': 'Menu of ' + label }, '…'),
          h('div', { class: 'drop' }, ...aboutLines(i), h('button', { class: 'link', onclick: () => askLeave(i) }, 'Leave')))),
      ui.confirm === 'secure' + i.key ? secureBox(i) : null,
      ui.confirm === 'trim' + i.key ? trimBox(i) : null,
      ui.confirm === 'leave' + i.key ? h('div', { class: 'confirm-box small', role: 'alert' },
        h('p', {}, ui.leaveWarning || 'Leave ' + label + '? Its posts stay with its members; your notifications, unread marks and follows here go.'),
        h('button', { class: 'link', onclick: () => leave(i) }, 'Leave'), h('button', { class: 'link', onclick: () => { ui.confirm = null; schedule() } }, 'Cancel')) : null)
  }
  return h('nav', { class: collapsed ? 'forums collapsed' : 'forums', 'aria-label': 'Your forums' },
    h('div', { class: 'col-head' }, collapsed ? null : h('span', { class: 'grow' }, 'Forums'), toggle),
    h('ul', {}, ...forums.map(row)),
    h('button', { class: 'link add', 'aria-label': 'Join or make a forum', onclick: () => { ui.joining = { name: '', public: false, link: '', error: '', busy: false }; schedule() } }, collapsed ? '+' : '+ Join or make'))
}

// a forum's copies ("Kept by N of 5 copies", a warning under 2 online), and Change key on a private one
// its owner has. Read when its "…" opens.
async function readAbout (i) {
  const x = window.hyper.instance(i.key)
  const [copies, info, st] = await Promise.all([x.copies().catch(() => null), x.info().catch(() => null), x.status().catch(() => null)])
  about[i.key] = { copies, private: !!info?.private, waiting: !!st?.warnings?.some((w) => w.code === 'RENEW_WAITING') }
  schedule()
}

function aboutLines (i) {
  const a = about[i.key]
  const line = a?.copies && copiesLine(a.copies)
  return [
    line ? h('p', { class: 'small copies' }, line.text) : null,
    line?.warn ? h('p', { class: 'small copies-warn', role: 'note' }, line.warn) : null,
    a?.private && i.role === 'owner'
      ? h('p', { class: 'small' }, h('button', { class: 'link', onclick: () => act(async () => { await window.hyper.instance(i.key).rotateKey(); notice = 'Key changed.' }) }, 'Change key'), ' ', CHANGE_KEY)
      : null,
    // owners and admins; Secure on a private forum, Trim on any
    a?.private && ADMINS.has(i.role) ? h('button', { class: 'link', onclick: () => { ui.confirm = 'secure' + i.key; ui.forget = false; schedule() } }, 'Secure this place…') : null,
    ADMINS.has(i.role) ? h('button', { class: 'link', onclick: () => { ui.confirm = 'trim' + i.key; schedule() } }, 'Trim history…') : null,
    a?.waiting ? h('p', { class: 'small', role: 'note' }, RENEW_WAITING) : null
  ]
}

// "Secure this place" (new keys now, a new address members follow; optionally the history before now
// deleted) and "Trim history" (keep the last N days/weeks/months/years), each confirmed with its warning.
function secureBox (i) {
  return h('div', { class: 'confirm-box small', role: 'alert' },
    h('p', {}, SECURE_TEXT),
    h('label', {}, h('input', { type: 'checkbox', checked: ui.forget ? '' : null, onchange: (e) => { ui.forget = e.target.checked; schedule() } }), ' Also delete history before now'),
    ui.forget ? h('p', { role: 'note' }, FORGET_TEXT) : null,
    h('button', { class: 'link', onclick: () => secure(i) }, 'Secure'), h('button', { class: 'link', onclick: () => { ui.confirm = null; schedule() } }, 'Cancel'))
}

function trimBox (i) {
  return h('div', { class: 'confirm-box small', role: 'alert' },
    h('p', {}, 'Keep the last ',
      h('input', { type: 'number', min: 1, max: 1000, value: ui.trimN, 'aria-label': 'How many', style: 'width:4em', oninput: (e) => { ui.trimN = Math.max(1, Number(e.target.value) || 1) } }), ' ',
      h('select', { 'aria-label': 'Unit', onchange: (e) => { ui.trimUnit = e.target.value } }, ...['days', 'weeks', 'months', 'years'].map((u) => h('option', { value: u, selected: ui.trimUnit === u ? '' : null }, u)))),
    h('p', { role: 'note' }, TRIM_TEXT),
    h('button', { class: 'link', onclick: () => trim(i) }, 'Trim'), h('button', { class: 'link', onclick: () => { ui.confirm = null; schedule() } }, 'Cancel'))
}

async function secure (i) {
  ui.confirm = null
  notice = 'Securing ' + (i.name || 'this forum') + '…'
  schedule()
  try {
    const r = await window.hyper.instance(i.key).secure({ forget: ui.forget })
    const st = await window.hyper.instance(r.key).status().catch(() => null)
    const waiting = !!st?.warnings?.some((w) => w.code === 'RENEW_WAITING')
    notice = 'Secured.' + (waiting ? ' ' + RENEW_WAITING : '')
    if (i.key === at) location.search = '?instance=' + r.key
    else await loadForums()
  } catch (err) {
    notice = renewError(err, (k) => names.get(k)?.name || null)
  }
  schedule()
}

async function trim (i) {
  ui.confirm = null
  const before = trimBefore(ui.trimN, ui.trimUnit)
  notice = 'Trimming…'
  schedule()
  try {
    await window.hyper.instance(i.key).trimHistory({ before })
    notice = 'Trimmed: posts from before ' + new Date(before).toLocaleDateString() + ' are deleted.'
  } catch (err) {
    notice = renewError(err)
  }
  schedule()
}

// after a ban, Secure this place is suggested once (a private forum, its owner or an admin).
async function suggestSecure () {
  if (!ADMINS.has(me.role) || ui.suggested.has(at)) return
  const info = await hyper.info().catch(() => null)
  if (!info?.private) return
  ui.suggested.add(at)
  ui.suggest = at
}

function suggestion () {
  if (ui.suggest !== at) return null
  const i = forums.find((x) => x.key === at) || { key: at, name: title, role: me.role }
  return h('p', { class: 'notice', role: 'note' }, SUGGEST_SECURE, ' ',
    h('button', { class: 'link', onclick: () => { ui.suggest = null; ui.confirm = 'secure' + at; ui.menu = at; readAbout(i); schedule() } }, 'Secure this place…'), ' ',
    h('button', { class: 'link', onclick: () => { ui.suggest = null; schedule() } }, 'Dismiss'))
}

// An owner may leave, warned: the forum lives on while members keep it; without an admin, nobody can make boards
// or moderators any more.
async function askLeave (i) {
  ui.leaveWarning = null
  if (i.role === 'owner') {
    const admins = (await window.hyper.instance(i.key).members().catch(() => [])).filter((m) => m.role === 'admin' && !m.you)
    ui.leaveWarning = 'You own ' + (i.name || 'this forum') + '. It lives on while its members keep it, ' + (admins.length
      ? `and its ${admins.length === 1 ? 'admin' : admins.length + ' admins'} can still make boards and moderators.`
      : 'but nobody can make boards or moderators any more: name an admin first (Members).') + ' Leave it?'
  }
  ui.confirm = 'leave' + i.key
  schedule()
}

async function leave (i) {
  ui.confirm = null
  await act(async () => {
    await window.hyper.instances.leave(i.key)
    if (i.key !== at) return loadForums()
    const next = forums.find((x) => x.key !== i.key)
    location.search = next ? '?instance=' + next.key : ''
  })
}

function joinBox () {
  const s = ui.joining
  const run = async (fn) => {
    s.busy = true
    s.error = ''
    schedule()
    try { await fn() } catch (err) { s.error = (err.code === 'NOT_ALLOWED' ? 'Not allowed: ' : '') + err.message }
    s.busy = false
    schedule()
  }
  return windowBox('Join or make a forum',
    h('div', { class: 'thread' }, ...joinForms(s, run, (key) => { location.search = '?instance=' + key }),
      h('div', { class: 'row-end' }, h('button', { class: 'link', onclick: () => { ui.joining = null; schedule() } }, 'Close'))))
}

// The make and join forms: the start page's and the "+" box's.
function joinForms (s, run, open) {
  const root = window.hyper
  return [s.error ? h('p', { class: 'notice', role: 'alert' }, s.error) : null,
    h('h3', {}, 'Make a forum'),
    h('p', { class: 'small' }, 'It is yours: you make its boards, its invites and its moderators. It lives on its members\' computers.'),
    h('form', { class: 'row-end start', onsubmit: (e) => { e.preventDefault(); run(async () => open((await root.instances.create(s.name, { public: s.public })).key)) } },
      h('input', { 'aria-label': 'Name of the forum', placeholder: 'Name', maxlength: 200, value: s.name, oninput: (e) => { s.name = e.target.value } }),
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: s.public ? '' : null, onchange: (e) => { s.public = e.target.checked } }), ' Public (anyone with its key; for good)'),
      h('button', { class: 'btn', disabled: s.busy ? '' : null }, 'Make forum')),
    h('h3', {}, 'Join a forum'),
    h('form', { class: 'row-end start', onsubmit: (e) => { e.preventDefault(); run(async () => open((await root.instances.join(s.link.trim())).key)) } },
      h('input', { class: 'wide', 'aria-label': 'Invite link', placeholder: 'hg:…', value: s.link, oninput: (e) => { s.link = e.target.value } }),
      h('button', { class: 'btn', disabled: s.busy ? '' : null }, 'Join'))]
}

// The open forum's boards, each with a dot when a thread in it has something new.
function boardsColumn (r) {
  const boards = boardTree(data.boards)
  const current = currentBoard(r)
  const sums = [...summarize(data.threads, data.comments, data.votes).values()]
  const fresh = (id) => sums.some((x) => x.thread.board === id && x.thread.id in news.unread)
  const boardRow = (b, sub) => h('li', {}, h('a', { class: 'board', href: '#/b/' + b.id, 'aria-current': current?.id === b.id ? 'true' : null },
    h('span', { class: 'mark', 'aria-label': fresh(b.id) ? 'new' : null }, fresh(b.id) ? '■' : ' '),
    h('span', { class: 'grow' }, (sub ? '▸ ' : '') + b.name),
    h('span', { class: 'small' }, String(sums.filter((x) => x.thread.board === b.id).length))))
  return h('nav', { class: 'boards', 'aria-label': 'Boards' },
    h('div', { class: 'col-head' }, h('span', { class: 'grow' }, 'Boards')),
    boards.length ? h('ul', {}, ...boards.flatMap((b) => [boardRow(b.board), ...b.subs.map((x) => boardRow(x, true))])) : h('p', { class: 'pad small' }, data.complete.boards ? 'No board yet.' : 'Loading…'),
    ADMINS.has(me.role) ? h('p', { class: 'pad' }, h('a', { href: '#/board/new' }, '+ New board')) : null)
}

// The board a route is in: the board page's, a thread's or a new thread's; else the first.
function currentBoard (r) {
  const flat = boardTree(data.boards).flatMap((b) => [b.board, ...b.subs])
  const id = r.page === 't' ? (data.threads.find((x) => x.id === r.id) || threadView.thread)?.board : ['b', 'new'].includes(r.page) ? r.id : null
  return flat.find((b) => b.id === id) || (r.page === 'b' ? flat[0] : null) || null
}

// --- follows: a board's new threads, a person's posts; a dot, a popup only if asked ---

const followOf = (match) => follows.find((x) => x.place === at && match(x))

function followButton (existing, make) {
  return h('button', {
    class: 'link',
    'aria-pressed': String(!!existing),
    onclick: () => act(async () => {
      if (existing) await window.hyper.notifications.unfollow(existing.id)
      else await window.hyper.notifications.follow(make())
      await loadFollows()
    })
  }, existing ? 'Following' : 'Follow')
}

const followBoard = (b) => followButton(followOf((x) => x.where?.board === b.id), () => ({ place: at, type: 'thread', where: { board: b.id }, says: ('new thread in ' + b.name).slice(0, 60), open: '#/r/{id}' }))
const followPerson = (key) => followButton(followOf((x) => x.by === key), () => ({ place: at, type: ['thread', 'comment'], by: key, says: (nameOf(key) + ' posted').slice(0, 60), open: '#/r/{id}' }))

async function refreshRole () {
  me.role = await hyper.getRole(me.identity).catch(() => me.role)
  schedule()
}

// --- routes: #/b/<board>, #/t/<thread>, #/new/<board>, #/mentions, #/you, #/members, #/mod, #/board/<id|new>,
// #/r/<record>: a thread or a comment (a notification's link), opened as its thread ---

function route () {
  const [page = '', id = null] = location.hash.replace(/^#\/?/, '').split('/')
  return { page: page || 'b', id }
}

function enter () {
  const r = route()
  if (r.page === 'r') return toThread(r.id)
  if (r.page === 't') opened[r.id] = new Set(news.unread[r.id] || []) // its replies new at this opening are marked
  if (r.page === 't' && threadView.id !== r.id) {
    threadView.stop?.()
    threadView = { id: r.id, stop: null, items: [], complete: false }
    threadView.stop = hyper.query('comment').on(r.id).live(({ items, complete }) => { threadView.items = items; threadView.complete = complete; schedule() }, { limit: LIMITS.thread })
  }
  if (r.page === 'members') loadMembers()
  if (r.page === 'mod') loadModeration()
  if (r.page === 'mentions') mentionView.seenAtOpen = mine.mentions ?? 0
  window.scrollTo(0, 0)
}

// shortcut: opens the comment's thread at its top, not scrolled to the comment; scroll there if people ask.
async function toThread (id) {
  const record = (await hyper.get(decodeURIComponent(id || '')).catch(() => null))?.record
  const thread = record?.type === 'thread' ? record.id : record?.type === 'comment' ? record.thread : null
  location.replace(thread ? '#/t/' + thread : '#/b')
}

async function loadMembers () {
  ui.members = await hyper.members().catch((err) => { say(err); return [] })
  schedule()
}

async function loadModeration () {
  const [reports, ht, hc] = await Promise.all([
    hyper.reports().catch(() => ({ items: [] })),
    hyper.query('thread').moderated('hidden').latest(50).catch(() => ({ items: [] })),
    hyper.query('comment').moderated('hidden').latest(50).catch(() => ({ items: [] }))
  ])
  const items = reports.items || []
  for (const it of items) it.record = (await hyper.get(it.on).catch(() => null))?.record || null
  ui.reports = items
  ui.hidden = [...ht.items, ...hc.items].sort((a, b) => b.stamp - a.stamp)
  schedule()
}

// --- drawing ---

let pending = false
function schedule () {
  if (pending) return
  pending = true
  setTimeout(() => { pending = false; draw() }, 16) // a timer, not a frame: a tab in the background keeps up too
}

function draw () {
  // the element being typed in keeps its focus and caret across the redraw
  const active = document.activeElement?.dataset?.k
  const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null
  const r = route()
  const page = { b: frontPage, t: threadPage, new: newThreadPage, mentions: mentionsPage, you: youPage, members: membersPage, mod: moderationPage, board: boardPage }[r.page] || frontPage
  app.replaceChildren(h('div', { class: 'layout' }, forumsColumn(), boardsColumn(r),
    h('div', { class: 'desk' }, bar(), notice ? h('p', { class: 'notice', role: 'alert' }, notice, ' ', h('button', { class: 'link', onclick: () => { notice = ''; schedule() } }, 'Dismiss')) : null, suggestion(), nameBanner(),
      ui.joining ? joinBox() : null, page(r.id))))
  if (active) {
    const el = app.querySelector(`[data-k="${active}"]`)
    if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel) } catch {} }
  }
  if (r.page === 't') markThreadRead(r.id)
  if (r.page === 'mentions') markMentionsSeen()
}

function bar () {
  const p = names.get(me.identity) || {}
  return h('nav', { class: 'bar', 'aria-label': 'Forum' },
    h('a', { href: '#/', class: 'brand' }, h('img', { src: 'icon.svg', alt: '', width: 16, height: 16 }), title),
    h('a', { href: './', title: 'Your forums, make one, join one' }, 'All forums'),
    h('span', { class: 'grow' }),
    h('a', { href: '#/mentions', 'aria-current': route().page === 'mentions' ? 'page' : null }, 'Mentions'),
    h('a', { href: '#/members', 'aria-current': route().page === 'members' ? 'page' : null }, 'Members'),
    MODERATORS.has(me.role) ? h('a', { href: '#/mod', 'aria-current': route().page === 'mod' ? 'page' : null }, 'Moderation') : null,
    h('a', { href: '#/you', class: 'who', 'aria-current': route().page === 'you' ? 'page' : null, title: 'You · ' + shortKey(me.identity) }, avatar(me.identity), p.name || 'You'))
}

function nameBanner () {
  if (names.get(me.identity)?.name || !data.complete.profiles) return null
  const d = draft('name')
  return h('form', { class: 'banner', onsubmit: (e) => { e.preventDefault(); act(() => f.setName(d.text)) } },
    h('label', { for: 'name-first' }, 'Pick the name people see next to your posts:'),
    h('input', { id: 'name-first', 'data-k': 'name', value: d.text, maxlength: 40, oninput: (e) => { d.text = e.target.value } }),
    h('button', { class: 'btn' }, 'Save'))
}

function windowBox (title, ...children) {
  return h('section', { class: 'window', 'aria-label': title },
    h('div', { class: 'title' }, h('h1', {}, title)),
    ...children)
}

function status (left, right) {
  return h('div', { class: 'status' }, h('span', {}, left), h('span', { class: 'grow' }), h('span', {}, right))
}

const online = () => (peers === 1 ? '1 peer online' : peers + ' peers online') + (Object.values(data.complete).every(Boolean) ? ' · complete' : ' · loading…')

// --- the front page: boards, then the chosen board's threads ---

function frontPage (boardId) {
  const current = currentBoard({ page: 'b', id: boardId })
  const sums = summarize(data.threads, data.comments, data.votes)
  const tallied = tally(data.votes)
  const isUnread = (s) => s.thread.id in news.unread
  const sort = SORTS.includes(mine.sort) ? mine.sort : 'activity'
  const list = current ? sortThreads([...sums.values()].filter((s) => s.thread.board === current.id), sort) : []
  const unreadCount = list.filter(isUnread).length

  return windowBox(title,
    h('main', { class: 'threads' },
      current
        ? [h('div', { class: 'head' },
            h('h2', {}, current.name),
            followBoard(current),
            ADMINS.has(me.role) ? h('a', { href: '#/board/' + current.id, class: 'small' }, 'Edit board') : null,
            h('a', { class: 'btn', href: '#/new/' + current.id }, 'New thread')),
          current.about ? h('p', { class: 'about' }, current.about) : null,
          h('div', { class: 'sorts', role: 'group', 'aria-label': 'Sort threads' }, h('span', {}, 'Sort:'),
            ...SORTS.map((s) => h('button', { class: 'seg', 'aria-pressed': String(s === sort), onclick: () => { mine.sort = s; schedule(); act(() => f.setSort(s)) } }, SORT_LABELS[s]))),
          h('div', { class: 'rule', 'aria-hidden': 'true' }, '┌' + '─'.repeat(200)),
          list.length
            ? h('ol', { class: 'list' }, ...list.map((s) => threadRow(s, isUnread(s), tallied)))
            : h('p', { class: 'pad' }, data.complete.threads ? 'No thread here yet: start one.' : 'Loading…')]
        : h('p', { class: 'pad' }, data.complete.boards ? (ADMINS.has(me.role) ? 'Make the first board to start.' : 'No board yet: an admin makes them.') : 'Loading…')),
    status(`${list.length} threads · ${unreadCount} unread`, online()))
}

function threadRow (s, isUnread, tallied) {
  const t = s.thread
  return h('li', { class: 'row' },
    h('span', { class: 'pipe', 'aria-hidden': 'true' }, '│'),
    h('span', { class: 'mark', 'aria-label': isUnread ? 'unread' : 'read' }, isUnread ? '■' : ' '),
    h('div', { class: 'grow' },
      h('a', { href: '#/t/' + t.id, class: isUnread ? 'ttl unread' : 'ttl' }, t.title),
      h('div', { class: 'meta' }, byline(t.author), h('span', {}, `${s.replies} ${s.replies === 1 ? 'reply' : 'replies'}`), h('span', {}, ago(s.activity)))),
    votes(t.id, tallied))
}

function byline (author) {
  return h('span', { class: author === me.identity ? 'by me' : 'by', title: shortKey(author) }, avatar(author), nameOf(author))
}

const nameOf = (key) => names.get(key)?.name || shortKey(key)

function avatar (key) {
  const bytes = names.get(key)?.icon
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' })
  span.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges"><path fill="currentColor" d="${icon.path(icon.valid(bytes) ? bytes : icon.fromKey(key))}"/></svg>`
  return span
}

function votes (id, tallied) {
  const v = voteOf(tallied, id, me.identity)
  const cast = (n) => act(() => f.vote(id, nextVote(v, n)))
  return h('div', { class: 'votes' },
    h('button', { class: 'vote', 'aria-label': 'Vote up', 'aria-pressed': String(v === 1), onclick: () => cast(1) }, '▲'),
    h('span', { class: 'score' }, String(score(tallied, id))),
    h('button', { class: 'vote', 'aria-label': 'Vote down', 'aria-pressed': String(v === -1), onclick: () => cast(-1) }, '▼'))
}

// --- a thread ---

function threadPage (id) {
  const t = data.threads.find((x) => x.id === id) || threadView.thread
  if (!t) {
    if (threadView.id === id && !threadView.asked) {
      threadView.asked = true
      hyper.get(id).then(({ record }) => { if (record) threadView.thread = record; threadView.gone = !record; schedule() }, () => {})
    }
    return windowBox('Thread', h('p', { class: 'pad' }, threadView.gone ? 'This thread was deleted or hidden.' : 'Loading…'), h('p', { class: 'pad' }, h('a', { href: '#/' }, '◂ Boards')))
  }
  const board = data.boards.find((b) => b.id === t.board)
  const tallied = tally(data.votes)
  const rows = tree(threadView.items, id)
  const fresh = (c) => !!opened[id]?.has(c.id)
  const shown = visible(rows, ui.folded)
  const newCount = threadView.items.filter(fresh).length

  return windowBox(board?.name || 'Thread',
    h('div', { class: 'thread' },
      h('a', { href: board ? '#/b/' + board.id : '#/' }, '◂ ' + (board?.name || 'Boards')),
      h('article', { class: 'op' },
        ui.editing === t.id ? editForm(t, true) : [
          h('h2', { class: 'big' }, t.title),
          h('div', { class: 'meta' }, byline(t.author), h('span', {}, ago(t.stamp)), t.edited ? h('span', {}, '(edited)') : null, h('span', {}, `${threadView.items.length} replies`)),
          postText(t.text)],
        actions(t, tallied))),
    h('div', { class: 'rule pad-x', 'aria-hidden': 'true' }, `── Replies · ${rows.filter((r) => r.comment).length} ` + '─'.repeat(200)),
    h('ol', { class: 'tree', 'aria-label': 'Replies' }, ...shown.map((r) => replyRow(r, tallied, fresh))),
    ui.replyTo === null || ui.replyTo === id ? composer(id, id, 'Reply to the thread') : h('p', { class: 'pad-x' }, h('button', { class: 'link', onclick: () => { ui.replyTo = null; schedule() } }, 'Reply to the thread')),
    status(`${shown.filter((r) => r.comment).length} of ${rows.filter((r) => r.comment).length} replies shown · ${newCount} new`, threadView.complete ? 'complete: every reply is here' : 'loading replies…'))
}

function replyRow (r, tallied, fresh) {
  const c = r.comment
  const folded = ui.folded.has(r.id)
  const segs = r.segs.map((s) => h('span', { class: 'seg-' + s, 'aria-hidden': 'true' }, { pipe: '│ ', blank: '  ', tee: '├─', elbow: '└─' }[s]))
  const toggle = h('button', { class: 'fold', 'aria-expanded': String(!folded), 'aria-label': folded ? 'Unfold' : 'Fold', onclick: () => { folded ? ui.folded.delete(r.id) : ui.folded.add(r.id); schedule() } }, folded ? '[+]' : '[−]')
  if (!c) {
    return h('li', { class: 'reply' }, ...segs, h('div', { class: 'body' }, h('div', { class: 'meta' }, r.under ? toggle : null, h('span', { class: 'small' }, '(deleted)')),
      folded ? h('div', { class: 'small' }, `(${r.under} replies folded)`) : null))
  }
  return h('li', { class: 'reply', id: 'c-' + c.id },
    ...segs,
    h('div', { class: 'body' },
      h('div', { class: 'meta' }, toggle, byline(c.author), h('span', {}, ago(c.stamp)), c.edited ? h('span', {}, '(edited)') : null,
        fresh(c) ? h('span', { class: 'new', 'aria-label': 'new since your last visit' }, '■ new') : null),
      folded
        ? h('div', { class: 'small' }, r.under ? `(${r.under + 1} replies folded)` : '(folded)')
        : [ui.editing === c.id ? editForm(c, false) : postText(c.text), actions(c, tallied),
            ui.replyTo === c.id ? composer(c.thread, c.id, 'Reply to ' + nameOf(c.author)) : null]))
}

function postText (text) {
  const div = h('div', { class: 'text' })
  div.innerHTML = renderText(text, (k) => names.get(k)?.name || null) // escaped by render: only the subset's tags
  return div
}

function actions (rec, tallied) {
  const mineRec = rec.author === me.identity
  const key = 'c' + rec.id
  return h('div', { class: 'actions' },
    votes(rec.id, tallied),
    h('button', { class: 'link', onclick: () => { ui.replyTo = rec.type === 'thread' ? null : rec.id; schedule() } }, 'Reply'),
    h('button', { class: 'link', onclick: () => quote(rec) }, 'Quote'),
    mineRec ? h('button', { class: 'link', onclick: () => { ui.editing = rec.id; const d = draft('e' + rec.id); Object.assign(d, toDraft(rec.text, (k) => names.get(k)?.name || null)); d.text = d.draft; d.title = rec.title || ''; schedule() } }, 'Edit') : null,
    mineRec ? confirmButton(key + 'del', 'Delete', () => act(() => f.remove(rec.id))) : null,
    !mineRec ? confirmButton(key + 'rep', 'Report', () => act(async () => { await f.report(rec.id, 'reported from the forum'); say('Reported: the moderators will see it.') })) : null,
    MODERATORS.has(me.role) ? confirmButton(key + 'hide', 'Hide', () => act(() => f.hide(rec.id))) : null)
}

// A button asking "sure?" in place before it acts (no dialog).
function confirmButton (key, label, run) {
  if (ui.confirm !== key) return h('button', { class: 'link', onclick: () => { ui.confirm = key; schedule() } }, label)
  return h('span', { class: 'confirm' }, label + '? ',
    h('button', { class: 'link', onclick: () => { ui.confirm = null; run() } }, 'Yes'), ' ',
    h('button', { class: 'link', onclick: () => { ui.confirm = null; schedule() } }, 'No'))
}

function quote (rec) {
  const d = draft('r' + rec.id)
  const lines = plain(rec.text, (k) => names.get(k)?.name || null).slice(0, 300)
  d.text = `> ${lines}\n\n` + d.text
  ui.replyTo = rec.type === 'thread' ? null : rec.id
  schedule()
}

function draft (k) {
  if (!drafts[k]) drafts[k] = { text: '', title: '', picks: {} }
  return drafts[k]
}

// The text box for replies and threads: @name suggestions from the members' names.
function textBox (k, d, label, rows = 5) {
  const at = /@([^\s@]*)$/.exec(d.text.slice(0, d.caret ?? d.text.length))
  const matches = at ? [...names.entries()].filter(([key, p]) => p.name && key !== me.identity && p.name.toLowerCase().startsWith(at[1].toLowerCase())).slice(0, 6) : []
  const ta = h('textarea', {
    id: k, 'data-k': k, rows, class: 'text', placeholder: 'Write here. @name to mention someone.',
    oninput: (e) => { d.text = e.target.value; d.caret = e.target.selectionStart; schedule() }
  })
  ta.value = d.text
  return [h('label', { for: k, class: 'label' }, label), ta,
    matches.length ? h('ul', { class: 'suggest', 'aria-label': 'Mention' }, ...matches.map(([key, p]) => h('li', {}, h('button', {
      type: 'button',
      class: 'link',
      onclick: () => {
        const end = d.caret ?? d.text.length
        const startAt = end - at[0].length
        d.text = d.text.slice(0, startAt) + '@' + p.name + ' ' + d.text.slice(end)
        d.caret = startAt + p.name.length + 2
        d.picks[p.name] = key
        schedule()
      }
    }, avatar(key), p.name, h('span', { class: 'small' }, ' ' + shortKey(key)))))) : null,
    h('p', { class: 'hint small' }, '**bold** · _italic_ · `code` · > quote · [link](hyper://key/page) · @name')]
}

function composer (thread, on, label) {
  const k = 'r' + on
  const d = draft(k)
  return h('form', { class: 'composer', 'aria-label': label, onsubmit: (e) => {
    e.preventDefault()
    act(async () => {
      await f.reply(thread, on, toStored(d.text, d.picks))
      delete drafts[k]
      ui.replyTo = null
    })
  } }, ...textBox(k, d, label), h('div', { class: 'row-end' }, on !== thread ? h('button', { type: 'button', class: 'link', onclick: () => { ui.replyTo = null; schedule() } }, 'Cancel') : null, h('button', { class: 'btn' }, 'Post reply')))
}

function editForm (rec, isThread) {
  const k = 'e' + rec.id
  const d = draft(k)
  return h('form', { class: 'composer', onsubmit: (e) => {
    e.preventDefault()
    act(async () => {
      await f.edit(rec, isThread ? { title: d.title, text: toStored(d.text, d.picks) } : { text: toStored(d.text, d.picks) })
      delete drafts[k]
      ui.editing = null
    })
  } },
  isThread ? [h('label', { for: k + 't', class: 'label' }, 'Title'), h('input', { id: k + 't', 'data-k': k + 't', class: 'wide', value: d.title, maxlength: 300, oninput: (e) => { d.title = e.target.value } })] : null,
  ...textBox(k, d, 'Edit'),
  h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'link', onclick: () => { ui.editing = null; schedule() } }, 'Cancel'), h('button', { class: 'btn' }, 'Save')))
}

// Opened: read (its new replies stay marked while it is shown, from `opened`).
function markThreadRead (id) {
  if (!(id in news.unread)) return
  news = { ...news, unread: without(news.unread, id) }
  f.saveUnread(news).catch(say)
}

// --- new thread, boards ---

function newThreadPage (boardId) {
  const board = data.boards.find((b) => b.id === boardId)
  const k = 'n' + boardId
  const d = draft(k)
  return windowBox('New thread',
    h('form', { class: 'thread', onsubmit: (e) => {
      e.preventDefault()
      act(async () => {
        const t = await f.post(boardId, { title: d.title, text: toStored(d.text, d.picks) })
        delete drafts[k]
        location.hash = '#/t/' + t.id
      })
    } },
    h('a', { href: '#/b/' + boardId }, '◂ ' + (board?.name || 'Boards')),
    h('h2', { class: 'big' }, 'New thread in ' + (board?.name || '…')),
    h('label', { for: k + 't', class: 'label' }, 'Title'),
    h('input', { id: k + 't', 'data-k': k + 't', class: 'wide', value: d.title, maxlength: 300, required: true, oninput: (e) => { d.title = e.target.value } }),
    ...textBox(k, d, 'Text', 10),
    h('div', { class: 'row-end' }, h('button', { class: 'btn' }, 'Post thread'))))
}

function boardPage (id) {
  if (!ADMINS.has(me.role)) return windowBox('Boards', h('p', { class: 'pad' }, 'Only admins make and edit boards.'))
  const board = id === 'new' ? null : data.boards.find((b) => b.id === id)
  const k = 'b' + id
  const d = drafts[k] || Object.assign(draft(k), board ? { title: board.name, text: board.about || '', parent: board.parent || '', order: String(board.order || 0) } : { parent: '', order: '0' })
  const tops = data.boards.filter((b) => !b.parent && b.id !== id)
  return windowBox(board ? 'Edit board' : 'New board',
    h('form', { class: 'thread', onsubmit: (e) => {
      e.preventDefault()
      act(async () => {
        const fields = { name: d.title, about: d.text, order: Number(d.order) || 0, parent: d.parent || null }
        const b = board ? await f.editBoard(board.id, { name: fields.name, about: fields.about, order: fields.order }) : await f.makeBoard(fields)
        delete drafts[k]
        location.hash = '#/b/' + (board ? board.id : b.id)
      })
    } },
    h('a', { href: '#/' }, '◂ Boards'),
    h('label', { for: k + 'n', class: 'label' }, 'Name'),
    h('input', { id: k + 'n', 'data-k': k + 'n', class: 'wide', value: d.title, maxlength: 80, required: true, oninput: (e) => { d.title = e.target.value } }),
    h('label', { for: k + 'a', class: 'label' }, 'What it is for'),
    h('input', { id: k + 'a', 'data-k': k + 'a', class: 'wide', value: d.text, maxlength: 300, oninput: (e) => { d.text = e.target.value } }),
    board ? null : [h('label', { for: k + 'p', class: 'label' }, 'Inside'),
      h('select', { id: k + 'p', onchange: (e) => { d.parent = e.target.value } }, h('option', { value: '' }, '(a board of its own)'), ...tops.map((b) => h('option', { value: b.id, selected: d.parent === b.id ? '' : null }, b.name)))],
    h('label', { for: k + 'o', class: 'label' }, 'Order (lower first)'),
    h('input', { id: k + 'o', 'data-k': k + 'o', type: 'number', value: d.order, oninput: (e) => { d.order = e.target.value } }),
    h('div', { class: 'row-end' }, board ? confirmButton('rmb' + board.id, 'Remove board', () => act(async () => { await f.removeBoard(board.id); location.hash = '#/' })) : null, h('button', { class: 'btn' }, board ? 'Save' : 'Make board'))))
}

// --- mentions: a list you open yourself (no badge, no counter) ---

function mentionsPage () {
  const seen = mentionView.seenAtOpen ?? 0
  const items = mentionView.items
  return windowBox('Mentions',
    h('div', { class: 'thread' },
      h('p', { class: 'small' }, 'Posts where someone wrote ＠' + nameOf(me.identity) + '. New ones are marked.'),
      items.length
        ? h('ol', { class: 'list' }, ...items.map((m) => {
          const rec = data.comments.find((c) => c.id === m.on) || data.threads.find((t) => t.id === m.on)
          const threadId = rec?.type === 'comment' ? rec.thread : rec?.id
          const t = data.threads.find((x) => x.id === threadId)
          const isNew = m.stamp > seen
          return h('li', { class: 'row' },
            h('span', { class: 'mark', 'aria-label': isNew ? 'new' : null }, isNew ? '■' : ' '),
            h('div', { class: 'grow' },
              h('div', { class: 'meta' }, byline(m.author), h('span', {}, ago(m.stamp)), t ? h('span', {}, 'in ', h('a', { href: '#/t/' + t.id }, t.title)) : null),
              h('p', { class: 'snippet' }, rec ? plain(rec.text, (k) => names.get(k)?.name || null).slice(0, 200) : '(not here yet, or deleted)')))
        }))
        : h('p', {}, mentionView.complete ? 'Nobody mentioned you yet.' : 'Loading…')),
    status(`${items.length} mentions`, online()))
}

function markMentionsSeen () {
  const latest = mentionView.items[0]?.stamp
  if (latest && (mine.mentions ?? 0) < latest) {
    mine.mentions = latest
    f.markMentionsSeen(latest).catch(say)
  }
}

// --- you: name and icon ---

function youPage () {
  const p = names.get(me.identity) || {}
  const d = draft('you')
  if (d.text === '' && p.name && !d.touched) d.text = p.name
  if (!ui.iconDraft) ui.iconDraft = new Uint8Array(icon.valid(p.icon) ? p.icon : icon.fromKey(me.identity))
  const bits = ui.iconDraft
  const grid = h('div', { class: 'grid', role: 'group', 'aria-label': 'Your icon, 16 by 16' })
  for (let y = 0; y < icon.SIZE; y++) {
    for (let x = 0; x < icon.SIZE; x++) {
      grid.append(h('button', { type: 'button', class: 'px', 'aria-label': `pixel ${x + 1}, ${y + 1}`, 'aria-pressed': String(!!icon.get(bits, x, y)), onclick: () => { icon.set(bits, x, y, !icon.get(bits, x, y)); schedule() } }))
    }
  }
  const preview = h('span', { class: 'icon big-icon', 'aria-hidden': 'true' })
  preview.innerHTML = `<svg viewBox="0 0 16 16" width="32" height="32" shape-rendering="crispEdges"><path fill="currentColor" d="${icon.path(bits)}"/></svg>`
  return windowBox('You',
    h('div', { class: 'thread' },
      h('form', { onsubmit: (e) => { e.preventDefault(); act(async () => { await f.setName(d.text); say('Name saved.') }) } },
        h('label', { for: 'you-name', class: 'label' }, 'Your name in this forum'),
        h('input', { id: 'you-name', 'data-k': 'you-name', value: d.text, maxlength: 40, oninput: (e) => { d.text = e.target.value; d.touched = true } }),
        ' ', h('button', { class: 'btn' }, 'Save name')),
      h('p', { class: 'small' }, 'Your key: ' + me.identity),
      h('h3', {}, 'Your icon'),
      h('div', { class: 'icon-edit' }, grid, h('div', {}, preview,
        h('p', {}, h('button', { type: 'button', class: 'link', onclick: () => { ui.iconDraft = icon.fromKey(me.identity); schedule() } }, 'Made from my key')),
        h('p', {}, h('button', { type: 'button', class: 'link', onclick: () => { ui.iconDraft = new Uint8Array(icon.BYTES); schedule() } }, 'Clear')),
        h('p', {}, h('button', { type: 'button', class: 'btn', onclick: () => act(async () => { await f.setIcon(new Uint8Array(bits)); say('Icon saved.') }) }, 'Save icon')))),
      followsList()),
    status('Read state, sort, follows and mentions seen stay on your devices', online()))
}

// What you follow here: a dot when something comes, a popup only if switched on.
function followsList () {
  const mineHere = follows.filter((x) => x.place === at)
  const label = (x) => x.where?.board ? 'Board ' + (data.boards.find((b) => b.id === x.where.board)?.name || '(removed)') : 'Posts of ' + nameOf(x.by)
  const setPopup = (x, popup) => act(async () => {
    const { id, ...rest } = x
    await window.hyper.notifications.follow({ ...rest, popup })
    await window.hyper.notifications.unfollow(id)
    await loadFollows()
  })
  return [h('h3', {}, 'You follow'),
    mineHere.length
      ? h('ul', { class: 'members' }, ...mineHere.map((x) => h('li', { class: 'row' },
        h('span', { class: 'grow' }, label(x)),
        h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: x.popup ? '' : null, onchange: (e) => setPopup(x, e.target.checked) }), ' Popup'),
        h('button', { class: 'link', onclick: () => act(async () => { await window.hyper.notifications.unfollow(x.id); await loadFollows() }) }, 'Unfollow'))))
      : h('p', { class: 'small' }, 'Nothing yet: Follow is on a board\'s page and next to each member.')]
}

// --- members, roles, invites ---

function membersPage () {
  const list = (ui.members || []).filter((m) => m.role || m.banned)
  const admin = ADMINS.has(me.role)
  const mod = MODERATORS.has(me.role)
  const inv = ui.invite
  return windowBox('Members',
    h('div', { class: 'thread' },
      admin ? h('div', { class: 'invite' },
        h('h3', {}, 'Invite someone'),
        h('p', { class: 'small' }, 'They paste the link into HyperBrowser\'s address field. Someone with the right to let people in must be online then.'),
        h('div', { class: 'row-end start' },
          h('button', { class: 'btn', onclick: () => act(async () => { ui.invite = { link: await f.invite({ uses: 1 }), uses: 1 } }) }, 'Invite one person'),
          h('button', { class: 'link', onclick: () => act(async () => { ui.invite = { link: await f.invite({ uses: 10 }), uses: 10 } }) }, 'A link for 10 people')),
        inv ? [h('label', { for: 'invite-link', class: 'label' }, `Invite link (${inv.uses === 1 ? 'one person' : inv.uses + ' people'}): select it and copy`),
          h('input', { id: 'invite-link', class: 'wide', readonly: '', value: inv.link, onfocus: (e) => e.target.select() })] : null) : null,
      h('h3', {}, `${list.length} members`),
      ui.members === null ? h('p', {}, 'Loading…') : h('ul', { class: 'members' }, ...list.map((m) => h('li', { class: 'row' },
        byline(m.identity),
        h('span', { class: 'small' }, shortKey(m.identity)),
        h('span', { class: 'grow' }),
        m.you ? null : followPerson(m.identity),
        m.banned ? h('span', { class: 'small' }, 'banned') : admin && !m.you && m.role !== 'owner'
          ? h('select', { 'aria-label': 'Role of ' + nameOf(m.identity), onchange: (e) => act(async () => { await f.setRole(m.identity, e.target.value); await loadMembers() }) },
            ...['member', 'moderator', 'admin'].map((r) => h('option', { value: r, selected: m.role === r ? '' : null }, r)))
          : h('span', { class: 'small' }, m.role),
        mod && !m.you && m.role !== 'owner'
          ? (m.banned
              ? h('button', { class: 'link', onclick: () => act(async () => { await f.unban(m.identity); await loadMembers() }) }, 'Unban')
              : confirmButton('ban' + m.identity, 'Ban', () => act(async () => { await f.ban(m.identity, 'banned from the forum'); await loadMembers(); await suggestSecure() })))
          : null)))),
    status(`${list.length} members`, online()))
}

// --- the start page: your forums, the official one, make one, join one ---

async function startPage () {
  const root = window.hyper
  const s = { forums: null, official: null, name: '', public: false, link: '', error: '', busy: false }
  const open = (key) => { location.search = '?instance=' + key }
  const run = async (fn) => {
    s.busy = true
    s.error = ''
    paint()
    try { await fn() } catch (err) { s.error = (err.code === 'NOT_ALLOWED' ? 'Not allowed: ' : '') + err.message }
    s.busy = false
    paint()
  }
  const forumRow = (i) => h('li', { class: 'row' },
    h('a', { href: '?instance=' + i.key, class: 'grow' }, i.name || shortKey(i.key)),
    h('span', { class: 'small' }, (i.role || 'not a member yet') + (i.public ? ' · public' : '')))
  function paint () {
    const official = s.official && !(s.forums || []).some((i) => i.key === s.official) ? s.official : null
    app.replaceChildren(h('div', { class: 'desk' }, windowBox('Forums',
      h('div', { class: 'thread' },
        h('h3', {}, 'Your forums'),
        s.forums === null ? h('p', {}, 'Loading…') : s.forums.length ? h('ul', { class: 'members' }, ...s.forums.map(forumRow)) : h('p', { class: 'small' }, 'None yet.'),
        official ? h('p', {}, h('a', { href: '?instance=' + official }, 'The official HyperBrowser forum')) : null,
        ...joinForms(s, run, open)),
      status('Forums made with this app', ''))))
  }
  paint()
  s.forums = await root.instances.list() // the identity question, once for the app and all its forums
  s.official = (await root.query('official').latest(1).catch(() => ({ items: [] }))).items[0]?.instance || null
  paint()
}

// --- moderation: reports, hidden posts ---

function moderationPage () {
  if (!MODERATORS.has(me.role)) return windowBox('Moderation', h('p', { class: 'pad' }, 'For moderators.'))
  const reports = ui.reports
  const hidden = ui.hidden
  const titleOf = (rec) => rec.type === 'thread' ? rec.title : plain(rec.text, (k) => names.get(k)?.name || null).slice(0, 120)
  const threadOf = (rec) => rec.type === 'thread' ? rec.id : rec.thread
  return windowBox('Moderation',
    h('div', { class: 'thread' },
      h('p', {}, h('button', { class: 'link', onclick: loadModeration }, 'Read again')),
      h('h3', {}, 'Reports'),
      reports === null ? h('p', {}, 'Loading…') : reports.length ? h('ul', { class: 'list' }, ...reports.map((it) => h('li', { class: 'row' },
        h('div', { class: 'grow' },
          it.record ? h('a', { href: '#/t/' + threadOf(it.record) }, titleOf(it.record)) : h('span', {}, '(gone)'),
          h('div', { class: 'meta' }, h('span', {}, `${it.count} ${it.count === 1 ? 'report' : 'reports'}`), ...it.reports.map((r) => h('span', {}, nameOf(r.by) + ': ' + (r.reason || '…'))))),
        it.record ? h('button', { class: 'link', onclick: () => act(async () => { await f.hide(it.on, 'after a report'); await loadModeration() }) }, 'Hide') : null,
        h('button', { class: 'link', onclick: () => act(async () => { for (const r of it.reports) await f.dismiss(r); await loadModeration() }) }, 'Dismiss')))) : h('p', {}, 'No report.'),
      h('h3', {}, 'Hidden'),
      hidden === null ? h('p', {}, 'Loading…') : hidden.length ? h('ul', { class: 'list' }, ...hidden.map((rec) => h('li', { class: 'row' },
        h('div', { class: 'grow' }, h('span', {}, titleOf(rec)), h('div', { class: 'meta' }, byline(rec.author), h('span', {}, ago(rec.stamp)))),
        h('button', { class: 'link', onclick: () => act(async () => { await f.reveal(rec.id); await loadModeration() }) }, 'Show again')))) : h('p', {}, 'Nothing hidden.')),
    status('Moderators see reports; members only see that someone reported', online()))
}

// --- helpers ---

async function act (fn) {
  try {
    await fn()
  } catch (err) {
    say(err)
  }
  schedule()
}

function say (what) {
  notice = typeof what === 'string' ? what : (what.code === 'NOT_ALLOWED' ? 'Not allowed: ' : '') + what.message
  schedule()
}

// h('a', { href, onclick }, ...children): null, false and arrays among children are fine.
function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v)
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}

