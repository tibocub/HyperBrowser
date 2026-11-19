import test from 'brittle'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, siteApi, siteFolder, codeOf, eventually } from './helpers.js'
import { forum, renewError, trimBefore, RENEW_WAITING, SECURE_TEXT, TRIM_TEXT, SUGGEST_SECURE } from '../sites/forum/lib/forum.js'
import { chat } from '../sites/chat/lib/chat.js'

const FORUM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'forum')
const CHAT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'chat')
const WAIT = 40000
const APP = { manifest: { title: 'App', permissions: ['space'], types: { message: { fields: { text: 'string' } } } } }

async function app (t, e, folder = siteFolder(t, APP)) {
  const { key } = await e.rpc.request('site.publish', { folder })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  return { key, hyper: siteApi(e, key) }
}

test('secure and trimHistory: own app\'s instances only; the list and old keys follow the move', async (t) => {
  t.timeout(120000)
  const a = await engine(t)
  const { hyper } = await app(t, a)
  const other = await app(t, a)
  const room = await hyper.instances.create('Room', { private: true })
  await hyper.instance(room.key).put('message', { text: 'before' })
  const theirs = await other.hyper.instances.create('Theirs', { private: true })
  t.is(await codeOf(hyper.instance(theirs.key).secure()), 'NOT_ALLOWED', "not on another app's instance")
  t.is(await codeOf(hyper.secure()), 'NOT_ALLOWED', 'a public site has no disk key to renew')
  t.is(await codeOf(hyper.instance(room.key).secure({ forget: 'yes' })), 'INVALID_PARAMS', 'forget is true or false')

  const fresh = await hyper.instance(room.key).secure()
  t.not(fresh.key, room.key, 'a new key')
  t.alike((await hyper.instances.list()).map((x) => x.key), [fresh.key], 'the app\'s list has the new key only')
  const info = await hyper.instance(room.key).info()
  t.is(info.key, fresh.key, 'a page still on the old key reaches the new place')
  t.is(info.renewal.from, room.key, 'which says where it came from')
  t.ok((await hyper.instance(room.key).query('message').latest(5)).items.some((m) => m.text === 'before'), 'with its history')

  t.is(await codeOf(hyper.instance(fresh.key).trimHistory({ before: 'now' })), 'INVALID_PARAMS', 'before is a time')
  await hyper.instance(fresh.key).trimHistory({ before: Date.now() + 1000 })
  t.alike((await hyper.instance(fresh.key).query('message').latest(5)).items, [], 'trimmed')
})

async function privateForum (t) {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: FORUM })
  await owner.rpc.request('site.open', { key })
  await owner.rpc.request('site.consent', { key, allow: true })
  const { key: inst } = await siteApi(owner, key).instances.create('Club', { private: true })
  const a = forum(siteApi(owner, key).instance(inst))
  return { owner, key, inst, a }
}

async function invited (t, by, key, inst) {
  const e = await engine(t)
  const link = await by.invite()
  await e.rpc.request('site.open', { key: link })
  await e.rpc.request('site.consent', { key, allow: true })
  return { e, f: forum(siteApi(e, key).instance(inst)), hyper: siteApi(e, key) }
}

test('the forum: ban, secure; members follow on their own, the banned one is told they have no access', async (t) => {
  t.timeout(240000)
  const { key, inst, a } = await privateForum(t)
  const b = await invited(t, a, key, inst)
  const c = await invited(t, a, key, inst)
  const board = await a.makeBoard({ name: 'General' })
  const th = await a.post(board.id, { title: 'Hello', text: '' })
  const cId = (await c.f.me()).identity
  t.ok(await eventually(async () => (await c.f.hyper.query('thread').latest(5)).items.length === 1, WAIT), 'c reads it')
  await a.ban(cId, 'spam')

  t.is(await codeOf(b.f.secure()), 'NOT_ALLOWED', 'a member may not secure it')
  const fresh = await a.secure()
  t.ok(fresh.key && fresh.key !== inst, 'secured: a new key')
  t.ok(await eventually(async () => (await b.f.me()).key === fresh.key, WAIT), "b's page, still on the old key, follows")
  t.ok(await eventually(async () => (await b.hyper.instances.list()).some((x) => x.key === fresh.key), WAIT), "and b's forum list")
  t.ok(await eventually(async () => (await b.f.hyper.get(th.id)).record?.title === 'Hello', WAIT), 'b reads the history, same ids')
  const told = await eventually(async () => { const i = await c.f.me(); return i.moved && i }, WAIT)
  t.ok(told, 'c is told it moved')
  t.is(told.movedTo, null, 'with no new address')

  await a.trimHistory(-1)
  t.ok(await eventually(async () => (await b.f.hyper.query('thread').latest(5)).items.length === 0, WAIT), 'trimmed on b too')
})

test('the hand-over and errors in plain words', (t) => {
  t.ok(RENEW_WAITING.includes('Keep HyperBrowser open'), RENEW_WAITING)
  t.ok(SECURE_TEXT.length > 0 && TRIM_TEXT.includes("can't be recalled"), 'the warnings')
  t.ok(SUGGEST_SECURE.length > 0)
  const nameOf = (k) => (k === 'k'.repeat(52) ? 'Ann' : null)
  t.is(renewError({ code: 'ALREADY_RENEWED', message: `This space was already renewed by ${'k'.repeat(52)}: it moved` }, nameOf), 'Already renewed by Ann.')
  t.is(renewError({ code: 'ALREADY_RENEWED', message: 'This space was already renewed: it moved' }, nameOf), 'Already renewed by someone else.')
  t.is(renewError({ code: 'NOT_ALLOWED', message: 'x' }, nameOf), 'Only owners and admins can do this.')
  const now = Date.UTC(2026, 10, 17)
  t.is(trimBefore(2, 'weeks', now), now - 14 * 24 * 3600e3)
  t.is(trimBefore(1, 'years', now), now - 365 * 24 * 3600e3)
})

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

async function friendsIn (owner, other, g) {
  const { link } = await owner.hyper.contacts.link()
  await other.hyper.contacts.add(link)
  await eventually(async () => (await owner.hyper.contacts.list()).some((x) => x.identity === other.id && x.state === 'friend'), WAIT)
  await owner.c.add(g.key, 'Climbing', (await owner.hyper.contacts.list()).find((x) => x.identity === other.id))
  const direct = (await other.hyper.contacts.list()).find((x) => x.identity === owner.id).chat
  let invite = null
  await eventually(async () => (invite = (await other.hyper.instance(direct).query('invite').latest(1)).items[0]), WAIT)
  return other.c.join(invite.link)
}

test('chat: a group secured; a member follows, the banned one is left out; a direct conversation stays as it is', async (t) => {
  t.timeout(240000)
  const pub = await engine(t)
  const { key } = await pub.rpc.request('site.publish', { folder: CHAT })
  const ann = await person(t, key, 'Ann')
  const bob = await person(t, key, 'Bob')
  const dan = await person(t, key, 'Dan')
  const g = await ann.c.group('Climbing')
  await friendsIn(ann, bob, g)
  await friendsIn(ann, dan, g)
  await ann.c.send(g.key, 'before')
  await ann.c.ban(g.key, dan.id)
  const fresh = await ann.c.secure(g.key)
  t.ok(await eventually(async () => (await bob.c.conversations()).some((x) => x.key === fresh.key), WAIT), "Bob's list has the group's new key")
  t.ok(await eventually(async () => (await bob.hyper.instance(fresh.key).query('message').latest(5)).items.some((m) => m.text === 'before'), WAIT), 'with its history')
  t.ok(await eventually(async () => { const i = await dan.c.info(g.key); return i.moved && i.movedTo === null }, WAIT), 'Dan is left out, told so')
  const direct = (await ann.c.conversations()).find((x) => x.direct)
  t.ok(direct, 'the direct conversations are still there')
})
