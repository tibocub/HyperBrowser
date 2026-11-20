const hyper = /** @type {Hyper.Site} */ (window.hyper) // undefined outside HyperBrowser: start() checks
const root = /** @type {HTMLElement} */ (document.getElementById('app'))
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
// set by refresh() before any draw
let me = /** @type {Awaited<ReturnType<Hyper.Site['contacts']['me']>>} */ (/** @type {unknown} */ (null))
/** @type {Hyper.Contact[]} */
let list = []
/** @type {Array<{ key: string, name: string }>} */
let circles = []
let person = new URLSearchParams(location.search).get('person')
let notice = ''
/** @type {string | null} */
let link = null
/** @type {string | null} the friend whose "…" menu is open */
let menu = null

start().catch((err) => {
  root.replaceChildren(h('p', {}, err.code === 'NOT_ALLOWED' ? 'Contacts needs your identity and your contacts. Reload the page to be asked again.' : 'Contacts could not start: ' + err.message))
})

async function start () {
  if (!hyper) return root.replaceChildren(h('p', {}, 'Open Contacts in HyperBrowser.'))
  document.addEventListener('click', (e) => { if (menu && !/** @type {Element} */ (e.target).closest('[data-menu]')) { menu = null; draw() } })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menu) return
    const id = menu
    menu = null
    draw()
    const button = /** @type {HTMLElement | null} */ (root.querySelector('[data-menu="' + id + '"] > button'))
    button?.focus()
  })
  hyper.contacts.on(() => refresh().catch(() => {}))
  await refresh()
}

async function refresh () {
  me = await hyper.contacts.me()
  list = await hyper.contacts.list()
  circles = await hyper.contacts.circles().catch(() => [])
  draw()
}

/** @param {string} k */
const short = (k) => k.slice(0, 8) + '…'
/** @param {Hyper.Contact} c */
const label = (c) => c.name || short(c.identity)

/** @param {string | null} key */
function go (key) {
  person = key
  history.replaceState(null, '', key ? '?person=' + key : '?')
  draw()
}

/** @param {() => Promise<unknown>} fn */
async function act (fn) {
  notice = ''
  try { await fn() } catch (e) { const err = /** @type {Hyper.Failure} */ (e); notice = err.message + (err.code ? ' (' + err.code + ')' : '') }
  await refresh()
}

function draw () {
  const inMenu = /** @type {HTMLElement | null | undefined} */ (document.activeElement?.closest?.('[data-menu]'))?.dataset.menu // a redraw keeps the focus on the "…"
  root.replaceChildren(h('div', { style: 'max-width:720px; margin:0 auto; padding:8px' },
    h('h1', {}, 'Contacts'),
    notice ? h('p', { role: 'alert' }, notice) : null,
    person && person !== me.identity ? page(person) : home()))
  if (inMenu) /** @type {HTMLElement | null} */ (root.querySelector('[data-menu="' + inMenu + '"] > button'))?.focus()
}

function home () {
  /** @param {Hyper.Contact['state']} state */
  const of = (state) => list.filter((c) => c.state === state)
  return [
    h('section', {}, h('h2', {}, 'You'),
      h('form', { onsubmit: (e) => { e.preventDefault(); act(() => hyper.contacts.setMe({ name: e.target.name.value })) } },
        'Your name: ', h('input', { name: 'name', value: me.name || '', maxlength: 64, required: '' }), ' ', h('button', {}, 'Save')),
      h('p', {}, 'Your key (give it to friends): ', h('code', { style: 'word-break:break-all' }, me.identity), ' ',
        h('button', { onclick: () => navigator.clipboard.writeText(me.identity).then(() => { notice = 'Key copied.'; draw() }, () => {}) }, 'Copy')),
      h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: me.findable ? '' : null, onchange: (e) => act(() => hyper.contacts.setMe({ findable: e.target.checked })) }),
        ' People can find me by my key'), h('br'),
      h('span', { class: 'small' }, 'On: a friend request by your key reaches you while you are both online. Off: nothing about you is announced; use contact links.')),
      h('p', {}, h('button', { onclick: () => act(async () => { link = (await hyper.contacts.link()).link }) }, 'Make a contact link'),
        link ? [' ', h('code', { style: 'word-break:break-all' }, link), ' ', h('button', { onclick: () => navigator.clipboard.writeText(/** @type {string} */ (link)) }, 'Copy')] : null),
      link ? h('p', { class: 'small' }, 'Send it by any channel: whoever opens it first becomes your friend. One use.') : null),
    h('section', {}, h('h2', {}, 'Add a friend'),
      h('form', { onsubmit: add }, h('input', { name: 'what', placeholder: 'Their key, or a contact link (hg:…)', style: 'width:70%', required: '' }), ' ', h('button', {}, 'Add'))),
    of('incoming').length ? h('section', {}, h('h2', {}, 'Friend requests'), h('ul', {}, of('incoming').map((c) => h('li', {},
      h('b', {}, label(c)), ' ', h('code', { class: 'small' }, short(c.identity)), ' ',
      h('button', { onclick: () => act(() => hyper.contacts.accept(c.identity)) }, 'Accept'), ' ',
      h('button', { onclick: () => act(() => hyper.contacts.decline(c.identity)) }, 'Decline'))))) : null,
    h('section', {}, h('h2', {}, 'Friends'), of('friend').length
      ? h('ul', {}, of('friend').map((c) => h('li', {},
        h('a', { href: '?person=' + c.identity, onclick: (e) => { e.preventDefault(); go(c.identity) } }, label(c)), ' ',
        h('button', { onclick: () => act(() => hyper.people.chat(c.identity)) }, 'Message'), ' ', more(c))))
      : h('p', {}, 'No friends yet. Add someone by their key or send them a contact link.')),
    of('outgoing').length ? h('section', {}, h('h2', {}, 'Sent, waiting'), h('ul', {}, of('outgoing').map((c) => h('li', {},
      label(c), ' ', h('code', { class: 'small' }, short(c.identity)), ' ',
      h('button', { onclick: () => act(() => hyper.contacts.remove(c.identity)) }, 'Cancel'))))) : null
  ]
}

/** @param {Hyper.Contact} c */
function more (c) {
  const open = menu === c.identity
  /** @param {{ key: string, name: string }} x */
  const choose = (x) => { menu = null; act(async () => { await hyper.contacts.inviteToCircle(c.identity, x.key); notice = 'Invite to "' + x.name + '" sent in your Chat with ' + label(c) + '.' }) }
  return h('span', { 'data-menu': c.identity, style: 'position:relative; display:inline-block; margin-left:8px; text-indent:0' }, // text-indent: the theme's list rows indent
    h('button', { 'aria-label': 'More for ' + label(c), 'aria-haspopup': 'menu', 'aria-expanded': String(open), onclick: () => { menu = open ? null : c.identity; draw() } }, '…'),
    open
      ? h('div', { role: 'menu', style: 'position:absolute; top:100%; left:0; z-index:10; margin-top:2px; padding:4px; display:flex; flex-direction:column; gap:2px; white-space:nowrap; background:var(--paper, Canvas); color:var(--ink, CanvasText); border:1px solid; box-shadow:2px 2px 0 var(--ink, CanvasText)' },
        circles.length
          ? circles.map((x) => h('button', { role: 'menuitem', style: 'text-align:left', onclick: () => choose(x) }, 'Invite to "' + x.name + '"'))
          : h('span', { class: 'small', style: 'padding:2px 4px' }, 'No circle to invite to: make one in HyperBrowser ▾ → Configuration… → Your circles…'))
      : null)
}

/** @param {string} key */
function page (key) {
  const c = list.find((x) => x.identity === key)
  const back = h('p', {}, h('a', { href: '?', onclick: (e) => { e.preventDefault(); go(null) } }, '← All contacts'))
  if (!KEY.test(key)) return [back, h('p', {}, 'That is not a person\'s key.')]
  const head = [back, h('h2', {}, c ? label(c) : 'Someone'), h('p', {}, h('code', { style: 'word-break:break-all' }, key))]
  if (!c) return [...head, h('button', { onclick: () => act(() => hyper.contacts.request(key)) }, 'Send a friend request')]
  const state = /** @type {Record<string, string>} */ ({ friend: 'Your friend', incoming: 'Wants to be your friend', outgoing: 'Friend request sent, waiting' })[c.state]
  return [...head, h('p', {}, state),
    c.state === 'friend' ? h('p', {}, h('button', { onclick: () => act(() => hyper.people.chat(key)) }, 'Message')) : null,
    c.state === 'incoming' ? h('p', {}, h('button', { onclick: () => act(() => hyper.contacts.accept(key)) }, 'Accept'), ' ',
      h('button', { onclick: () => act(() => hyper.contacts.decline(key)) }, 'Decline')) : null,
    h('form', { onsubmit: (e) => { e.preventDefault(); act(() => hyper.contacts.rename(key, e.target.name.value)) } },
      'Name shown to you: ', h('input', { name: 'name', value: c.name, maxlength: 64, required: '' }), ' ', h('button', {}, 'Rename')),
    h('p', {}, h('button', { onclick: () => act(async () => { await hyper.contacts.remove(key); go(null) }) }, c.state === 'outgoing' ? 'Cancel the request' : 'Remove from contacts'))]
}

/** @param {SubmitEvent} e */
function add (e) {
  e.preventDefault()
  const what = /** @type {HTMLFormElement} */ (e.target).what.value.trim()
  act(async () => {
    const c = what.startsWith('hg:') ? await hyper.contacts.add(what) : await hyper.contacts.request(what)
    notice = c.state === 'friend' ? 'You are now friends.' : 'Request sent: it reaches them while you are both online.'
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
