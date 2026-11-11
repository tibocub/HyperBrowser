// The Chat app (sites/chat, spec 013): its lib on the site API as its page sees it, engines on a local DHT.
// Friends by contact link (no DHT wait); a group whose owner hands out rights.
import test from 'brittle'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, siteApi, codeOf, eventually, sleep } from './helpers.js'
import { chat } from '../sites/chat/lib/chat.js'
import { keepScroll } from '../sites/chat/lib/scroll.js'

const FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'chat')

async function person (t, key, name) {
  const e = await engine(t)
  await e.rpc.request('apps.set', { chat: key })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  await e.rpc.request('site.permit', { key, permission: 'contacts', allow: true })
  const hyper = siteApi(e, key)
  await hyper.contacts.setMe({ name })
  return { hyper, c: chat(hyper), id: (await hyper.contacts.me()).identity }
}

// a and b friends through a contact link: b's contact entry for a
async function befriend (a, b) {
  const { link } = await a.hyper.contacts.link()
  await b.hyper.contacts.add(link)
  await eventually(async () => (await a.hyper.contacts.list()).some((x) => x.identity === b.id && x.state === 'friend'), 30000)
  return (await b.hyper.contacts.list()).find((x) => x.identity === a.id)
}
const contactOf = async (p, other) => (await p.hyper.contacts.list()).find((x) => x.identity === other.id)
const texts = async (p, key) => (await p.hyper.instance(key).query('message').latest(50)).items.map((m) => m.text)

// b joins the group from the invite a sent in their direct conversation
async function joinFromInvite (b, a) {
  const direct = (await contactOf(b, a)).chat
  let invite = null
  await eventually(async () => (invite = (await b.hyper.instance(direct).query('invite').latest(1)).items[0]), 30000)
  return b.c.join(invite.link)
}

// The caret across a redraw needs a real page: the sandbox self-test checks it (and this, in a browser).
test('a redraw keeps the reader in the message list, or at the end', (t) => {
  const list = (key, scrollTop) => ({ dataset: { key }, scrollTop, scrollHeight: 1000, clientHeight: 400 })
  t.is(keepScroll(null, 'a'), null, 'a conversation just opened: the end')
  t.is(keepScroll(list('a', 600), 'a'), null, 'at the end: stays there')
  t.is(keepScroll(list('a', 595), 'a'), null, 'a few pixels short still counts')
  t.is(keepScroll(list('a', 300), 'a'), 300, 'scrolled up: keeps the place')
  t.is(keepScroll(list('a', 300), 'a', true), null, 'your own message: the end')
  t.is(keepScroll(list('b', 300), 'a'), null, "another conversation doesn't inherit it")
})

test('a direct conversation and a group where the owner hands out rights', async (t) => {
  t.timeout(300000)
  const tibo = await engine(t)
  const { key } = await tibo.rpc.request('site.publish', { folder: FOLDER })
  const [ann, bob, cleo, dan] = [await person(t, key, 'Ann'), await person(t, key, 'Bob'), await person(t, key, 'Cleo'), await person(t, key, 'Dan')]

  // direct: listed with the friend, private, messages both ways
  await befriend(ann, bob)
  const direct = (await ann.c.conversations()).find((x) => x.direct?.identity === bob.id)
  t.ok(direct, 'the direct conversation, named by the contact')
  await ann.c.send(direct.key, 'hi Bob')
  t.ok(await eventually(async () => (await texts(bob, direct.key)).includes('hi Bob'), 15000), 'Bob reads it')
  t.is(await codeOf(ann.c.send(direct.key, '  ')), 'INVALID_INPUT')

  // a group: Ann owns it; Bob comes in through the invite in their direct conversation
  await befriend(ann, cleo)
  const g = await ann.c.group('Climbing')
  t.is((await ann.c.conversations()).find((x) => x.key === g.key).role, 'owner')
  await ann.c.add(g.key, 'Climbing', await contactOf(ann, bob))
  await ann.c.add(g.key, 'Climbing', await contactOf(ann, cleo))
  t.is((await joinFromInvite(bob, ann)).key, g.key, 'Bob joined')
  await joinFromInvite(cleo, ann)
  t.ok(await eventually(async () => (await ann.c.names(g.key)).get(bob.id) === 'Bob', 15000), 'names in the group')

  // a member can't add people; once Ann grants it, Bob adds his friend Dan
  await befriend(bob, dan)
  t.is(await codeOf(bob.c.add(g.key, 'Climbing', await contactOf(bob, dan))), 'NOT_ALLOWED', 'members don\'t add people')
  await ann.c.grant(g.key, bob.id, 'inviter')
  t.ok(await eventually(async () => (await bob.c.role(g.key)) === 'inviter', 15000))
  await bob.c.add(g.key, 'Climbing', await contactOf(bob, dan))
  await joinFromInvite(dan, bob)
  t.is(await codeOf(bob.c.grant(g.key, dan.id, 'moderator')), 'NOT_ALLOWED', 'an inviter gives no rights')

  // Cleo, moderator: removes Bob's message, bans Dan; Dan reads nothing written after
  await ann.c.grant(g.key, cleo.id, 'moderator')
  const m = await bob.c.send(g.key, 'rude')
  t.ok(await eventually(async () => (await texts(cleo, g.key)).includes('rude'), 15000))
  t.ok(await eventually(async () => (await cleo.c.role(g.key)) === 'moderator', 15000))
  await cleo.c.remove(g.key, m, false)
  t.ok(await eventually(async () => !(await texts(ann, g.key)).includes('rude'), 15000), 'gone for everyone')
  await ann.c.send(g.key, 'welcome Dan')
  t.ok(await eventually(async () => (await texts(dan, g.key)).includes('welcome Dan'), 15000), 'Dan reads the group')
  await cleo.c.ban(g.key, dan.id)
  await sleep(2000) // the key changes before the next write
  await ann.c.send(g.key, 'after Dan')
  t.ok(await eventually(async () => (await texts(bob, g.key)).includes('after Dan'), 15000), 'members read it')
  await sleep(3000)
  t.absent((await texts(dan, g.key)).includes('after Dan'), 'Dan, banned, doesn\'t')
})
