// Notifications: an app declares in site.json what to watch; once the person says yes the engine
// watches its instances with no app code, finds what's new with space.since() cursors (never by dates), and
// tells the shell (notify.* messages, the `notify` event). Engines on a local DHT, no site view open.
import test from 'brittle'
import { engine, siteFolder, siteApi, codeOf, eventually, sleep, bootstrap, tmpDir } from './helpers.js'
import { parseManifest } from '../engine/manifest.js'
import { notifications } from '../engine/notifications.js'

const CHAT = {
  manifest: {
    title: 'Chat',
    permissions: ['space', 'contacts', 'notifications'],
    types: { message: { fields: { text: 'text' } } },
    notifications: [{ type: 'message', text: 'text' }]
  }
}
const FORUM = {
  manifest: {
    title: 'Forum',
    permissions: ['space', 'notifications'],
    types: { post: { fields: { text: 'text' } }, mention: { fields: { who: 'string', on: 'string' } } },
    notifications: [{ type: 'mention', me: 'who', says: 'mentioned you', open: '#/r/{on}' }]
  }
}

// The owner publishes the app; each person opens it, says yes to identity (and to notifications unless notify: false).
async function setup (t, app, names, opts = {}) {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t, app) })
  const out = []
  for (const name of names) out.push(await person(t, key, name, opts))
  return { key, people: out }
}

// notifyTurn: a place's turn online, and the launch's catch-up window (20 s by default)
async function person (t, key, name, { notify = true, dir, init = { notifyTurn: 3000 } } = {}) {
  const e = await engine(t, { ...(dir ? { dir } : {}), ...init })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  if (notify) await e.rpc.request('site.permit', { key, permission: 'notifications', allow: true })
  const hyper = siteApi(e, key)
  return { e, hyper, key, name, id: (await hyper.info()).identity }
}

const state = (p) => p.e.rpc.request('notify.state')
const items = async (p) => (await state(p)).items
const waitItems = (p, fn, ms = 30000) => eventually(async () => fn(await items(p)), ms)

// A group of `owner`, the others joined, everyone's view of it complete (its history is in).
async function group (owner, others, name = 'G') {
  const g = await owner.hyper.instances.create(name)
  const link = await owner.hyper.instance(g.key).createInvite({ role: 'member', uses: others.length })
  for (const p of others) await p.hyper.instances.join(link)
  for (const p of others) await eventually(() => p.hyper.instance(g.key).isComplete(), 30000)
  await sleep(2000) // the engine's own first look at the place (a record written in the very instant of a join is history)
  return g.key
}

test('manifest: notifications checked as data', async (t) => {
  const m = (notifications, extra = {}) => JSON.stringify({ title: 'A', permissions: ['space', 'notifications'], types: FORUM.manifest.types, notifications, ...extra })
  t.alike(parseManifest(m(FORUM.manifest.notifications)).notifications, FORUM.manifest.notifications)
  t.is(parseManifest(JSON.stringify({ title: 'A' })).notifications, undefined, 'optional')
  const bad = [
    'nope',
    [{}],
    [{ type: 'nope', text: 'text' }],
    [{ type: 'post' }],
    [{ type: 'post', text: 'text', says: 'x' }],
    [{ type: 'post', text: 'nope' }],
    [{ type: 'mention', me: 'nope', says: 'x' }],
    [{ type: 'post', says: 'x'.repeat(61) }],
    [{ type: 'post', text: 'text', open: 'https://elsewhere' }],
    [{ type: 'post', text: 'text', open: '#/{nope}' }],
    [{ type: 'post', text: 'text', other: 1 }],
    Array.from({ length: 17 }, () => ({ type: 'post', text: 'text' }))
  ]
  for (const n of bad) t.exception(() => parseManifest(m(n)), /INVALID_MANIFEST|notifications/, JSON.stringify(n).slice(0, 60))
  t.exception(() => parseManifest(JSON.stringify({ title: 'A', notifications: [{ type: 'post', text: 'text' }] })), /types/, 'a watch names a declared type')
})

test('a message notifies with no view open; own records and history do not; read clears', async (t) => {
  t.timeout(240000)
  const { key, people: [ann, bob] } = await setup(t, CHAT, ['Ann', 'Bob'])
  const g = await ann.hyper.instances.create('Climbing')
  const ag = ann.hyper.instance(g.key)
  await ag.put('message', { text: 'before Bob joined' })
  await bob.hyper.instances.join(await ag.createInvite({ role: 'member' }))
  await eventually(() => bob.hyper.instance(g.key).isComplete(), 30000)
  await bob.e.rpc.request('site.close', { key }) // no view of Chat on Bob's side
  await sleep(2000)
  t.alike(await items(bob), [], 'joined history isn\'t news')

  await ag.put('message', { text: 'hi Bob\u0007' + 'x'.repeat(300) })
  t.ok(await waitItems(bob, (l) => l.length === 1), 'Bob is notified')
  const [it] = await items(bob)
  t.is(it.app, key)
  t.is(it.place, g.key, 'the conversation')
  t.is(it.author, ann.id)
  t.is(it.text.length, 200, 'cut to 200')
  t.ok(it.text.startsWith('hi Bob') && !it.text.includes('\u0007'), 'plain text')
  t.is(it.read, false)
  t.ok(await eventually(() => bob.e.events.some((x) => x.event === 'notify' && x.data.items.length), 10000), 'a notify event')
  const ev = bob.e.events.find((x) => x.event === 'notify' && x.data.items.length)
  t.is(ev.data.unread.total, 1)
  t.is(ev.data.unread.byPlace[g.key], 1)
  t.is(ev.data.unread.byApp[key], 1)
  t.is(ev.data.summary, null, 'not a catch-up')
  const s = await state(bob)
  t.is(s.apps.find((a) => a.key === key).title, 'Chat', 'the app\'s title, from its site.json')

  await bob.e.rpc.request('site.open', { key })
  await bob.hyper.instance(g.key).put('message', { text: 'my own' })
  await ag.put('message', { text: 'second' })
  t.ok(await waitItems(bob, (l) => l.length === 2), 'the next one')
  await sleep(1000)
  t.ok(!(await items(bob)).some((x) => x.text === 'my own'), 'own records never notify')

  await bob.e.rpc.request('notify.read', { place: g.key })
  t.is((await state(bob)).unread.total, 0, 'read: unread drops')
  t.ok((await items(bob)).every((x) => x.read), 'kept in the list, read')
  t.is(await codeOf(bob.e.rpc.request('notify.read', {})), 'INVALID_PARAMS')

  await bob.e.rpc.request('site.keep', { key, keep: true, timeout: 30000 })
  await bob.e.rpc.request('site.keep', { key, keep: false })
  t.alike(await items(bob), [], 'uninstalled: its notifications go')
  t.ok(!(await state(bob)).apps.some((a) => a.key === key), 'and its watches')
})

// Clocks: since() goes by seqs, never stamps (a clock far ahead or a late arrival: hypergraph's own tests;
// a patched Date.now doesn't reach hypergraph's stamper). Here: records received after a restart.
test('a restart catches up: what arrived while away notifies, as one summary', async (t) => {
  t.timeout(240000)
  const { people: [ann, bob] } = await setup(t, CHAT, ['Ann', 'Bob'])
  const place = await group(ann, [bob])
  const ag = ann.hyper.instance(place)
  await ag.put('message', { text: 'normal' })
  t.ok(await waitItems(bob, (l) => l.length === 1))
  await ag.put('message', { text: 'normal 2' })
  t.ok(await waitItems(bob, (l) => l.length === 2))

  // Bob away; Ann writes; Bob comes back: one summary, both found
  await bob.e.rpc.request('close')
  await ag.put('message', { text: 'yesterday 1' })
  await ag.put('message', { text: 'yesterday 2' })
  const back = await person(t, ann.key, 'Bob', { dir: bob.e.dir, init: { notifyTurn: 10000 } })
  t.ok(await waitItems(back, (l) => l.filter((x) => x.text.startsWith('yesterday')).length === 2, 60000), 'caught up at the restart')
  t.ok(await eventually(() => back.e.events.some((x) => x.event === 'notify' && x.data.summary), 15000), 'as one summary')
  const ev = back.e.events.find((x) => x.event === 'notify' && x.data.summary)
  t.is(ev.data.summary.count, 2)
  t.is(back.e.events.filter((x) => x.event === 'notify' && x.data.items.length).length, 1, 'one event, not one each')
  t.is((await items(back)).length, 4, 'the list survived the restart')
})

test('the person decides: no yes, nothing; block, mute, hide; a no is remembered', async (t) => {
  t.timeout(240000)
  const { key, people: [ann, bob] } = await setup(t, CHAT, ['Ann', 'Bob'], { notify: false })
  const place = await group(ann, [bob])
  const ag = ann.hyper.instance(place)
  await ag.put('message', { text: 'before the yes' })
  await sleep(2000)
  t.alike(await items(bob), [], 'not asked yet: nothing')
  t.is((await bob.e.rpc.request('site.open', { key })).notify, 'ask', 'site.open: ask the person (identity said yes, notifications not asked)')
  await bob.e.rpc.request('site.close', { key })
  t.is(await codeOf(bob.e.rpc.request('site.permit', { key, permission: 'notify', allow: true })), 'INVALID_PARAMS')

  await bob.e.rpc.request('site.permit', { key, permission: 'notifications', allow: true })
  await sleep(2000)
  t.alike(await items(bob), [], 'a first yes: what came before isn\'t news')
  await ag.put('message', { text: 'after the yes' })
  t.ok(await waitItems(bob, (l) => l.length === 1))

  t.is((await bob.e.rpc.request('site.open', { key })).notify, undefined, 'answered: not asked again')
  await bob.e.rpc.request('site.close', { key })
  t.is(await codeOf(bob.e.rpc.request('site.call', { key, method: 'notify.state', args: [] })), 'UNKNOWN_METHOD', 'a page cannot read notifications')
  t.is(await codeOf(bob.e.rpc.request('notify.read', { place, app: 'x'.repeat(52) })), 'NOT_ALLOWED', 'read for a page: only places of its own app')
  t.is(await bob.e.rpc.request('notify.read', { place, app: key }), true)
  await bob.e.rpc.request('notify.set', { app: key, hide: true })
  t.is((await items(bob))[0].text, null, 'hidden content: no text')
  t.ok((await state(bob)).apps.find((a) => a.key === key).hide)
  await bob.e.rpc.request('notify.set', { app: key, hide: false })
  t.is((await items(bob))[0].text, 'after the yes')

  await bob.e.rpc.request('notify.set', { place, mute: true })
  await ag.put('message', { text: 'muted' })
  await sleep(4000)
  t.is((await items(bob)).length, 1, 'muted: nothing added')
  await bob.e.rpc.request('notify.set', { place, mute: false })
  await ag.put('message', { text: 'unmuted' })
  t.ok(await waitItems(bob, (l) => l.some((x) => x.text === 'unmuted')), 'unmuted: it notifies again')
  t.ok(!(await items(bob)).some((x) => x.text === 'muted'), 'what came while muted stays silent')

  await bob.e.rpc.request('notify.set', { app: key, allow: false })
  t.alike(await items(bob), [], 'blocked: its notifications go')
  t.is((await state(bob)).unread.total, 0)
  await ag.put('message', { text: 'blocked' })
  await sleep(4000)
  t.alike(await items(bob), [], 'and nothing new')
  t.is(await codeOf(bob.e.rpc.request('notify.set', { app: key, allow: 'yes' })), 'INVALID_PARAMS')

  // an app that doesn't declare notifications can't be given them
  const plain = await engine(t)
  const { key: other } = await plain.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Plain', permissions: ['space'] } }) })
  await bob.e.rpc.request('site.open', { key: other })
  t.is(await codeOf(bob.e.rpc.request('site.permit', { key: other, permission: 'notifications', allow: true })), 'NOT_ALLOWED')
})

test('a mention: the "names me" field, a fixed phrase, a link into the app; leaving drops it all', async (t) => {
  t.timeout(240000)
  const { people: [ann, bob] } = await setup(t, FORUM, ['Ann', 'Bob'])
  const place = await group(ann, [bob], 'Climbing forum')
  const ag = ann.hyper.instance(place)
  const post = await ag.put('post', { text: 'hello @Bob' })
  await ag.put('mention', { who: 'someone-else', on: post.id })
  await ag.put('mention', { who: bob.id, on: post.id })
  t.ok(await waitItems(bob, (l) => l.length === 1), 'only the mention naming Bob')
  const [it] = await items(bob)
  t.is(it.text, 'mentioned you', 'the fixed phrase')
  t.is(it.open, '#/r/' + encodeURIComponent(post.id), 'where it opens')
  await bob.hyper.instances.leave(place)
  t.alike(await items(bob), [], 'left: its notifications go')
})

test('more places than stay online: checked in turns, all reached', async (t) => {
  t.timeout(300000)
  const { people: [ann, bob] } = await setup(t, FORUM, ['Ann', 'Bob'], { init: { notifyTurn: 3000 } })
  const places = []
  for (let i = 0; i < 5; i++) places.push(await group(ann, [bob], 'F' + i))
  await bob.e.rpc.request('site.close', { key: ann.key }) // no view: only the engine's own holding keeps them online
  await sleep(3000)
  const started = Date.now()
  for (const p of places) await ann.hyper.instance(p).put('mention', { who: bob.id, on: 'x' })
  // 5 places, 2 at a time, 3 s each: one full turn is 9 s; within two
  t.ok(await waitItems(bob, (l) => new Set(l.map((x) => x.place)).size === 5, 60000), 'every place notified')
  t.comment(`all 5 in ${Date.now() - started} ms`)
})

test('a friend request notifies, under Contacts; answered, it goes', async (t) => {
  t.timeout(240000)
  const { key, people: [ann, bob] } = await setup(t, CHAT, ['Ann', 'Bob'])
  for (const p of [ann, bob]) {
    await p.e.rpc.request('apps.set', { chat: key })
    await p.e.rpc.request('site.permit', { key, permission: 'contacts', allow: true })
    await p.e.rpc.request('site.call', { key, method: 'contacts.setMe', args: [{ name: p.name }] })
  }
  await ann.e.rpc.request('site.call', { key, method: 'contacts.request', args: [bob.id] })
  t.ok(await waitItems(bob, (l) => l.length === 1, 45000), 'Bob is told')
  const [it] = await items(bob)
  t.is(it.app, 'contacts')
  t.is(it.author, ann.id)
  t.is(it.name, 'Ann')
  t.ok((await state(bob)).apps.some((a) => a.key === 'contacts' && a.allow), 'Contacts: allowed without asking')
  await bob.e.rpc.request('site.call', { key, method: 'contacts.accept', args: [ann.id] })
  t.ok(await waitItems(bob, (l) => !l.some((x) => x.app === 'contacts')), 'accepted: gone')
})

test('two devices of one person: reading on one clears the other; a block follows', async (t) => {
  t.timeout(300000)
  const { key, people: [ann, pc] } = await setup(t, CHAT, ['Ann', 'Bob'])
  const { code } = await pc.e.rpc.request('devices.add')
  const e = await engine(t, { init: false })
  await e.rpc.request('init', { dir: e.dir, bootstrap: await bootstrap(t), joinCode: code, deviceName: 'laptop', joinTimeout: 60000, notifyTurn: 3000 })
  const laptop = { e }
  const place = await group(ann, [pc])
  // the laptop holds what the PC joined (the app's instance list follows the person's settings)
  t.ok(await eventually(async () => (await state(laptop)).apps.some((a) => a.key === key && a.places.some((p) => p.key === place)), 60000), 'the laptop watches it too')
  await sleep(3000)
  await ann.hyper.instance(place).put('message', { text: 'to both' })
  t.ok(await waitItems(pc, (l) => l.length === 1), 'the PC is told')
  t.ok(await waitItems(laptop, (l) => l.length === 1, 60000), 'the laptop is told')
  await pc.e.rpc.request('notify.read', { place })
  t.ok(await eventually(async () => (await state(laptop)).unread.total === 0, 30000), 'read on the PC: the laptop count drops')
  t.ok(await eventually(() => laptop.e.events.some((x) => x.event === 'notify' && x.data.unread.total === 0), 10000), 'with a notify event')
  await pc.e.rpc.request('notify.set', { app: key, allow: false })
  t.ok(await eventually(async () => (await items(laptop)).length === 0, 30000), 'blocked on the PC: blocked on the laptop')
})

// notifications() on a stub hypergraph: which places since() reads (it opens a closed space).
test('watching opens no closed place: only held or open ones are checked, a setting change or a read opens none', async (t) => {
  const APP = 'a'.repeat(52)
  const places = Array.from({ length: 10 }, (_, i) => 'p' + i)
  const set = {
    'hyperbrowser/permissions': { [APP]: { notifications: true } },
    ['hyperbrowser/notify/app/' + APP]: { title: 'Forum', watches: [{ type: 'mention', me: 'who', says: 'mentioned you' }], hide: false },
    ['hyperbrowser/app/' + APP + '/instances']: Object.fromEntries(places.map((p) => [p, true]))
  }
  const opened = new Set(['p9']) // a page shows it
  const read = []
  const listeners = []
  const hg = {
    identity: { publicKey: 'me' },
    settings: async () => ({ ...set }),
    setSetting: async (n, v) => { set[n] = v; for (const fn of listeners) fn() },
    on: (e, fn) => listeners.push(fn),
    off: () => {},
    spaces: () => places.map((key) => ({ key, opened: opened.has(key) })),
    space: (key) => ({
      name: key,
      since: async () => { read.push(key); opened.add(key); return { records: [], cursor: {} } },
      ready: async () => {},
      isComplete: () => true,
      hold: async () => { opened.add(key); return () => {} },
      on () {},
      off () {},
      get: async () => ({ record: null })
    })
  }
  const notes = notifications({ sfs: { hg }, dir: tmpDir(t), emit: () => {}, turn: 600000 }) // one long turn: p0, p1
  await notes.state()
  await sleep(500)
  t.alike([...new Set(read)].sort(), ['p0', 'p1', 'p9'], 'at the start: the turn places and the open one')
  read.length = 0
  await hg.setSetting('hyperbrowser/site/' + APP + '/seen', 1) // a page's own data: decides nothing
  await notes.read({ place: 'p3' })
  await sleep(1000)
  t.alike(read.filter((k) => !['p0', 'p1', 'p9'].includes(k)), [], 'a setting change and a read open none')
  await notes.close()
})

// --- dots, follows, a page's own counts ---

const BOARDS = {
  manifest: {
    title: 'Forum',
    permissions: ['space', 'notifications'],
    types: {
      thread: { fields: { title: 'string', board: 'string' } },
      comment: { fields: { text: 'text', thread: 'string' } },
      mention: { fields: { who: 'string', on: 'string' } }
    },
    notifications: [
      { type: 'mention', me: 'who', says: 'mentioned you', open: '#/r/{on}' },
      { type: 'thread', says: 'posted a thread', show: 'dot' },
      { type: 'comment', says: 'replied', show: 'dot' }
    ]
  }
}

// Another app on p's engine, allowed, with one instance of its own: what the forum's page must not reach.
async function otherApp (t, p) {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t, CHAT) })
  await p.e.rpc.request('site.open', { key })
  await p.e.rpc.request('site.consent', { key, allow: true })
  await p.e.rpc.request('site.permit', { key, permission: 'notifications', allow: true })
  return (await siteApi(p.e, key).instances.create('Elsewhere')).key
}

test('manifest: a watch may say show "dot", nothing else', async (t) => {
  const m = (notifications) => JSON.stringify({ title: 'A', permissions: ['space', 'notifications'], types: BOARDS.manifest.types, notifications })
  t.alike(parseManifest(m(BOARDS.manifest.notifications)).notifications, BOARDS.manifest.notifications)
  t.exception(() => parseManifest(m([{ type: 'thread', says: 'x', show: 'popup' }])), /show/)
  t.exception(() => parseManifest(m([{ type: 'thread', says: 'x', show: true }])), /show/)
  t.ok(parseManifest(m([{ type: 'thread', says: 'x', show: 'dot', open: '#/r/{id}' }])), "{id} in open: the record's own id")
  t.exception(() => parseManifest(m([{ type: 'thread', says: 'x', open: '#/r/{ids}' }])), /open/)
})

test('a dot watch: something new sets a dot, no notification; a page reads its own app\'s counts; viewing clears', async (t) => {
  t.timeout(240000)
  const { key, people: [ann, bob] } = await setup(t, BOARDS, ['Ann', 'Bob'])
  const place = await group(ann, [bob], 'Climbing')
  const own = (await bob.hyper.instances.create('Bob\'s')).key
  const elsewhere = await otherApp(t, bob)
  const heard = []
  bob.hyper.notifications.on((d) => heard.push(d))
  const unread = () => bob.hyper.notifications.unread()
  t.alike(await unread(), { [place]: { count: 0, dot: false }, [own]: { count: 0, dot: false } }, 'every place of its own app, nothing new; not the other app\'s')

  const ag = ann.hyper.instance(place)
  const th = await ag.put('thread', { title: 'Hi', board: 'gear' })
  t.ok(await eventually(async () => (await unread())[place].dot, 30000), 'a new thread: a dot')
  t.alike(await items(bob), [], 'no notification')
  t.is((await state(bob)).unread.total, 0, 'no number')
  t.ok(await eventually(() => heard.some((d) => d[place]?.dot), 5000), 'the page is told')
  await ag.put('mention', { who: bob.id, on: th.id })
  t.ok(await eventually(async () => (await unread())[place].count === 1, 30000), 'a mention: a number')
  t.is((await items(bob)).length, 1)

  await bob.e.rpc.request('notify.read', { place, app: key }) // what the page's viewing() does
  t.alike((await unread())[place], { count: 0, dot: false }, 'viewed: both cleared')
  t.ok(await eventually(() => heard.at(-1)?.[place]?.dot === false && heard.at(-1)[place].count === 0, 5000), 'the page is told')
  t.ok(heard.every((d) => !(elsewhere in d)), 'never another app\'s places')

  await bob.hyper.instance(place).put('comment', { text: 'mine', thread: th.id })
  await sleep(4000)
  t.is((await unread())[place].dot, false, 'own records set no dot')
  await ag.put('comment', { text: 'a reply', thread: th.id })
  t.ok(await eventually(async () => (await unread())[place].dot, 30000), 'a comment: a dot')
})

test('follows: a board, a person; quiet unless asked, a dot not a number; unfollow; own places only', async (t) => {
  t.timeout(300000)
  const { people: [ann, bob, cleo] } = await setup(t, BOARDS, ['Ann', 'Bob', 'Cleo'])
  const place = await group(ann, [bob, cleo], 'Climbing')
  const follow = (f) => bob.hyper.notifications.follow(f)
  const gear = await follow({ place, type: 'thread', where: { board: 'gear' }, says: 'new thread in Gear', open: '#/r/{id}' })
  const person = await follow({ place, type: ['thread', 'comment'], by: cleo.id, says: 'Cleo posted', popup: true })
  t.is(typeof gear.id, 'string')
  t.alike((await bob.hyper.notifications.follows()).map((f) => f.id).sort(), [gear.id, person.id].sort(), 'listed')
  t.alike((await bob.hyper.notifications.follows()).find((f) => f.id === gear.id), { id: gear.id, place, type: 'thread', where: { board: 'gear' }, says: 'new thread in Gear', open: '#/r/{id}', popup: false })
  await sleep(1000)

  const ag = ann.hyper.instance(place)
  const inGear = await ag.put('thread', { title: 'In Gear', board: 'gear' })
  await ag.put('thread', { title: 'Elsewhere', board: 'other' })
  await ag.put('comment', { text: 'Ann\'s', thread: 'x' })
  await cleo.hyper.instance(place).put('comment', { text: 'Cleo\'s', thread: 'x' })
  t.ok(await waitItems(bob, (l) => l.length === 2), 'the board\'s new thread and Cleo\'s comment')
  await sleep(3000)
  const l = await items(bob)
  t.is(l.length, 2, 'nothing else')
  t.alike(l.map((x) => [x.text, x.popup]).sort(), [['Cleo posted', true], ['new thread in Gear', false]], 'quiet unless asked')
  t.is(l.find((x) => x.follow === gear.id || x.text === 'new thread in Gear').open, '#/r/' + encodeURIComponent(inGear.id), '{id}: the thread itself')
  t.is((await state(bob)).unread.total, 0, 'a follow is not a number')
  t.alike((await bob.hyper.notifications.unread())[place], { count: 0, dot: true }, 'a dot')

  t.is(await bob.hyper.notifications.unfollow(gear.id), true)
  await sleep(1000)
  await ag.put('thread', { title: 'Gear again', board: 'gear' })
  await sleep(4000)
  t.is((await items(bob)).length, 2, 'unfollowed: nothing')

  // own places only; checked as data
  const elsewhere = await otherApp(t, bob)
  t.is(await codeOf(follow({ place: elsewhere, type: 'thread', says: 'x' })), 'NOT_ALLOWED', 'another app\'s place')
  t.is(await codeOf(follow({ place: 'y'.repeat(52), type: 'thread', says: 'x' })), 'NOT_ALLOWED', 'a guessed one')
  const bad = [
    null,
    { type: 'thread', says: 'x' },
    { place, type: 'nope', says: 'x' },
    { place, type: [], says: 'x' },
    { place, type: 'thread' },
    { place, type: 'thread', says: 'x', where: { nope: 1 } },
    { place, type: 'thread', says: 'x', where: { board: {} } },
    { place, type: 'thread', says: 'x', by: 'not a key' },
    { place, type: 'thread', says: 'x', popup: 'yes' },
    { place, type: 'thread', says: 'x', me: 'who' },
    { place, type: 'thread', says: 'x', other: 1 }
  ]
  for (const f of bad) t.is(await codeOf(follow(f)), 'INVALID_PARAMS', String(JSON.stringify(f)).slice(0, 60))
  t.is((await bob.hyper.notifications.follows()).length, 1, 'nothing added')

  for (let i = 1; i < 100; i++) await follow({ place, type: 'thread', where: { board: 'b' + i }, says: 'x' })
  t.is(await codeOf(follow({ place, type: 'thread', says: 'x' })), 'TOO_BIG', 'at most 100')
  await bob.hyper.instances.leave(place)
  t.alike(await bob.hyper.notifications.follows(), [], 'left: its follows go')
})

// HyperBrowser's own news (a circles' share full): listed, counted, popped up, read like any other; no app
// to allow first.
test("HyperBrowser's own notification: listed and unread at once, read like the others", async (t) => {
  const set = {}
  const told = []
  const hg = {
    identity: { publicKey: 'me' },
    settings: async () => ({ ...set }),
    setSetting: async (n, v) => { set[n] = v },
    on () {},
    off () {},
    spaces: () => [],
    space: () => { throw new Error('none') }
  }
  const notes = notifications({ sfs: { hg }, dir: tmpDir(t), emit: (event, data) => told.push([event, data]), turn: 100 })
  await notes.state()
  await sleep(500) // past the launch's catch-up (one summary for everything found in its first turn)
  await notes.hyperbrowser({ id: 'share-full-1', text: 'Your share for your circles is full' })
  const s = await notes.state()
  t.alike(s.items.map((x) => [x.app, x.place, x.name, x.text, x.popup]), [['hyperbrowser', 'hyperbrowser', 'HyperBrowser', 'Your share for your circles is full', true]])
  t.is(s.unread.total, 1, 'unread')
  t.ok(told.some(([e, d]) => e === 'notify' && d.items.some((x) => x.id === 'share-full-1')), 'told: a popup')
  await notes.read({ place: 'hyperbrowser' })
  t.is((await notes.state()).unread.total, 0, 'read')
  await notes.hyperbrowser({ id: 'share-full-2', text: 'full again' })
  t.is((await notes.state()).unread.total, 1, 'a second one is unread again')
  await notes.close()
})
