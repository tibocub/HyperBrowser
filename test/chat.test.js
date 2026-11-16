// The Chat app (sites/chat, spec 013): its lib on the site API as its page sees it, engines on a local DHT.
// Friends by contact link (no DHT wait); a group whose owner hands out rights.
import test from 'brittle'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, siteApi, codeOf, eventually, sleep } from './helpers.js'
import { chat, copiesLine, circleOf } from '../sites/chat/lib/chat.js'
import { keepScroll, newLine } from '../sites/chat/lib/scroll.js'

const FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'chat')

async function person (t, key, name) {
  const e = await engine(t)
  await e.rpc.request('apps.set', { chat: key })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  await e.rpc.request('site.permit', { key, permission: 'contacts', allow: true })
  const hyper = siteApi(e, key)
  await hyper.contacts.setMe({ name })
  return { e, hyper, c: chat(hyper), id: (await hyper.contacts.me()).identity }
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

test('the "New messages" line: above the first of the unread messages from others (spec 017 R8)', (t) => {
  const m = (author) => ({ author })
  const list = [m('ann'), m('me'), m('ann'), m('bob'), m('me'), m('ann')]
  t.is(newLine(list, 0, 'me'), -1, 'nothing unread: none, open at the end')
  t.is(newLine(list, 1, 'me'), 5, 'one: above the last')
  t.is(newLine(list, 2, 'me'), 3, "two: own messages in between don't count")
  t.is(newLine(list, 3, 'me'), 2)
  t.is(newLine(list, 50, 'me'), 0, 'more than shown: above the first from others')
  t.is(newLine([m('me')], 2, 'me'), -1, 'none from others: none')
  t.is(newLine([], 3, 'me'), -1)
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

// spec 018: a conversation's copies line, and a circle's invite as a message
test('copies: "Kept by N of 5 copies, M online", a warning under 2 online, nothing without a circle', (t) => {
  t.is(copiesLine({ wanted: 0, kept: 0, online: 0 }), null, 'nothing handed: no line')
  t.alike(copiesLine({ wanted: 5, kept: 4, online: 3 }), { text: 'Kept by 4 of 5 copies, 3 online', warn: null })
  t.is(copiesLine({ wanted: 5, kept: 2, online: 1 }).warn, "Few copies online: people may not get this while you're offline")
  t.alike(circleOf({ text: 'hi' }), null, 'a plain message')
  t.alike(circleOf({ text: 'x', circle: 'hg:abc', circleName: 'Family' }), { link: 'hg:abc', name: 'Family' })
  t.alike(circleOf({ text: 'x', circle: 'https://evil' }), null, 'only an hg: link')
})

test("a circle's invite from Contacts: a message in the friends' conversation, with its link in the text too; joined by HyperBrowser", async (t) => {
  t.timeout(240000)
  const tibo = await engine(t)
  const { key } = await tibo.rpc.request('site.publish', { folder: FOLDER })
  const a = await person(t, key, 'Ann')
  const b = await person(t, key, 'Bob')
  const friend = await befriend(a, b)
  const ofA = await contactOf(a, b)
  t.alike(await a.hyper.contacts.circles(), [], 'no circle yet')
  const ring = await a.e.rpc.request('circles.create', { name: 'Family' })
  t.alike(await a.hyper.contacts.circles(), [{ key: ring.key, name: 'Family' }], 'the circles Ann may invite to')
  t.is(await codeOf(a.hyper.contacts.inviteToCircle('y'.repeat(52), ring.key)), 'NOT_FOUND', 'only a friend')
  await a.hyper.contacts.inviteToCircle(b.id, ring.key)
  let m = null
  await eventually(async () => (m = (await b.hyper.instance(friend.chat).query('message').latest(5)).items.find((x) => x.circle)), 30000)
  t.ok(m, 'Bob gets it in their conversation (' + ofA.chat.slice(0, 6) + ')')
  t.is(m.circleName, 'Family')
  t.ok(m.text.startsWith('Join my circle "Family": hg:') && m.text.endsWith(m.circle), 'an older Chat shows the plain link')
  t.alike(circleOf(m), { link: m.circle, name: 'Family' })
  t.alike(await b.hyper.contacts.circles(), [], "Bob's circles: none he may invite to")
  await b.e.rpc.request('circles.join', { link: m.circle }) // what HyperBrowser's flow does after Bob's yes
  t.ok(await eventually(async () => (await a.e.rpc.request('circles.members', { key: ring.key })).length === 2, 30000), 'Bob is in')
})
