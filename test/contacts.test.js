// Contacts (spec 013): friend requests over the DHT and by contact link, each making a private Chat conversation;
// the `contacts` permission. Through the site API as the Chat app sees it, engines on a local DHT.
import test from 'brittle'
import { engine, siteFolder, siteApi, codeOf, eventually, sleep } from './helpers.js'

const CHAT = { manifest: { title: 'Chat', permissions: ['space', 'contacts'], types: { message: { fields: { text: 'text' } } } } }

// Tibo publishes Chat; each person's engine knows it as its chat app, opened and allowed (identity, contacts).
async function setup (t, names) {
  const tibo = await engine(t)
  const { key } = await tibo.rpc.request('site.publish', { folder: siteFolder(t, CHAT) })
  const out = []
  for (const name of names) out.push(await person(t, key, name))
  return { key, people: out }
}

async function person (t, key, name, { findable = true, dir } = {}) {
  const e = await engine(t, dir ? { dir } : {})
  await e.rpc.request('apps.set', { chat: key })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  await e.rpc.request('site.permit', { key, permission: 'contacts', allow: true })
  const hyper = siteApi(e, key)
  const c = (method, ...args) => e.rpc.request('site.call', { key, method: 'contacts.' + method, args })
  await c('setMe', { name, findable })
  return { e, hyper, c, id: (await c('me')).identity }
}

const find = async (p, id) => (await p.c('list')).find((x) => x.identity === id)

test('a friend request by key, over the DHT: accepted, both friends, one private conversation', async (t) => {
  t.timeout(180000)
  const { people: [ann, bob] } = await setup(t, ['Ann', 'Bob'])
  t.alike(await ann.c('me'), { identity: ann.id, name: 'Ann', findable: true })

  const sent = await ann.c('request', bob.id, 'Bobby')
  t.is(sent.state, 'outgoing')
  t.is(sent.name, 'Bobby', 'the name the sender gave, until the other\'s own arrives')
  t.ok(await eventually(async () => (await find(bob, ann.id))?.state === 'incoming', 30000), 'Bob gets it')
  const got = await find(bob, ann.id)
  t.is(got.name, 'Ann', 'with Ann\'s name')
  t.is(got.chat, sent.chat, 'for the conversation Ann made')

  await bob.c('accept', ann.id)
  t.is((await find(bob, ann.id)).state, 'friend')
  t.ok(await eventually(async () => (await find(ann, bob.id))?.state === 'friend', 30000), 'Ann sees Bob joined')
  t.ok(await eventually(async () => (await find(ann, bob.id))?.name === 'Bob', 15000), 'with Bob\'s own name')

  // the conversation: a private instance of Chat, in both lists
  t.ok((await ann.hyper.instances.list()).some((i) => i.key === sent.chat))
  t.ok((await bob.hyper.instances.list()).some((i) => i.key === sent.chat))
  const ac = ann.hyper.instance(sent.chat)
  const bc = bob.hyper.instance(sent.chat)
  t.ok((await ac.info()).private, 'private')
  await ac.put('message', { text: 'hi Bob' })
  t.ok(await eventually(async () => (await bc.query('message').latest(5)).items.some((m) => m.text === 'hi Bob'), 15000), 'Bob reads it')

  t.is(await codeOf(ann.c('request', bob.id)), 'ALREADY', 'already friends')
  t.is(await codeOf(ann.c('request', ann.id)), 'ALREADY', 'not to yourself')
  t.is(await codeOf(ann.c('request', 'nope')), 'INVALID_PARAMS', 'a key')

  await ann.c('rename', bob.id, 'B.')
  t.is((await find(ann, bob.id)).name, 'B.', 'renamed for Ann only')
  await bob.c('remove', ann.id)
  t.is(await find(bob, ann.id), undefined, 'removed')
  t.ok(!(await bob.hyper.instances.list()).some((i) => i.key === sent.chat), 'and the conversation left')
})

test('a request to someone offline arrives once they are online; declining drops it', async (t) => {
  t.timeout(180000)
  const { key, people: [ann] } = await setup(t, ['Ann'])
  const first = await engine(t) // Dan's engine, only to learn his key, then closed
  const { identity: dan } = await first.rpc.request('contacts.me')
  await first.rpc.request('close')

  const sent = await ann.c('request', dan, 'Dan')
  await sleep(3000)
  t.is((await find(ann, dan)).state, 'outgoing', 'waiting')
  const back = await person(t, key, 'Dan', { dir: first.dir }) // Dan starts again
  t.is(back.id, dan)
  t.ok(await eventually(async () => (await find(back, ann.id))?.state === 'incoming', 45000), 'it arrives')
  t.is((await find(back, ann.id)).chat, sent.chat)
  await back.c('decline', ann.id)
  t.is(await find(back, ann.id), undefined, 'declined: gone')
  t.is((await find(ann, dan)).state, 'outgoing', 'Ann isn\'t told')
  t.is(await codeOf(back.c('accept', ann.id)), 'NOT_FOUND', 'nothing left to accept')
})

test('a contact link: one use, no DHT; findable off is never found', async (t) => {
  t.timeout(180000)
  const { key } = await setup(t, [])
  const cleo = await person(t, key, 'Cleo', { findable: false })
  const dan = await person(t, key, 'Dan')
  const eve = await person(t, key, 'Eve')

  const { link } = await cleo.c('link')
  t.ok(link.startsWith('hg:'))
  const added = await dan.c('add', link)
  t.is(added.state, 'friend')
  t.is(added.identity, cleo.id, 'the link\'s maker')
  t.is(added.name, 'Cleo')
  t.ok(await eventually(async () => (await find(cleo, dan.id))?.state === 'friend', 30000), 'Cleo has Dan as a friend')
  t.ok(await eventually(async () => (await find(cleo, dan.id))?.name === 'Dan', 15000), 'named')
  t.ok(await codeOf(eve.c('add', link)), 'a used link is refused')
  t.is(await find(cleo, eve.id), undefined)

  // a link to something else than a Chat conversation
  const other = await engine(t)
  const { key: site } = await other.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Not chat', permissions: ['space'] } }) })
  t.is(await codeOf(dan.c('add', 'hg:' + site)), 'NOT_ALLOWED', 'not a conversation')

  // Cleo isn't findable: Eve's request stays undelivered
  await eve.c('request', cleo.id, 'Cleo')
  await sleep(5000)
  t.is(await find(cleo, eve.id), undefined, 'never reached Cleo')
  t.is((await find(eve, cleo.id)).state, 'outgoing')
})

test('the contacts permission: declared, asked once, refused after a no; none for other sites', async (t) => {
  t.timeout(120000)
  const { key } = await setup(t, [])
  const e = await engine(t)
  await e.rpc.request('apps.set', { chat: key })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  const list = () => e.rpc.request('site.call', { key, method: 'contacts.list', args: [] })
  t.is(await codeOf(list()), 'NEEDS_PERMISSION', 'asked first')
  t.is(await codeOf(e.rpc.request('site.on', { key, event: 'contacts' })), 'NEEDS_PERMISSION', 'the event too')
  await e.rpc.request('site.permit', { key, permission: 'contacts', allow: false })
  t.is(await codeOf(list()), 'NOT_ALLOWED', 'after a no')
  await e.rpc.request('site.permit', { key, permission: 'contacts', allow: true })
  t.alike(await list(), [], 'after a yes')

  const { key: forum } = await e.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Forum', permissions: ['space'] } }) })
  await e.rpc.request('site.open', { key: forum })
  await e.rpc.request('site.consent', { key: forum, allow: true })
  t.is(await codeOf(e.rpc.request('site.call', { key: forum, method: 'contacts.list', args: [] })), 'NOT_ALLOWED', 'a site that doesn\'t declare it')
  t.is(await codeOf(e.rpc.request('site.permit', { key: forum, permission: 'contacts', allow: true })), 'NOT_ALLOWED', 'and can\'t be given it')
  t.is(await codeOf(e.rpc.request('site.permit', { key, permission: 'files', allow: true })), 'INVALID_PARAMS')

  // the shell's own calls (after its dialog): no permission needed, any site's button
  const { identity: other } = await (await engine(t)).rpc.request('contacts.me')
  const sent = await e.rpc.request('contacts.request', { identity: other, name: 'Someone' })
  t.is(sent.state, 'outgoing')
  t.is((await e.rpc.request('contacts.get', { identity: other })).chat, sent.chat)
  t.is(await e.rpc.request('contacts.get', { identity: key }), null)
})

test('instances.create { private }: a private instance; not public and private at once', async (t) => {
  t.timeout(120000)
  const { people: [ann] } = await setup(t, ['Ann'])
  const g = await ann.hyper.instances.create('Climbing', { private: true })
  t.ok((await ann.hyper.instance(g.key).info()).private)
  t.is(await codeOf(ann.hyper.instances.create('x', { private: true, public: true })), 'INVALID_PARAMS')
  t.is(await codeOf(ann.hyper.instances.create('x', { private: 'yes' })), 'INVALID_PARAMS')
})
