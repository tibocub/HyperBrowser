import test from 'brittle'
import { engine, siteFolder, siteApi, codeOf, eventually } from './helpers.js'
import { holdsFrom, shareFull, pickName, GB } from '../engine/circles.js'

const APP = { manifest: { title: 'Talk', permissions: ['space'], types: { message: { fields: { text: 'string' } } } } }

async function app (t, e) {
  const { key } = await e.rpc.request('site.publish', { folder: siteFolder(t, APP) })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  return { key, hyper: siteApi(e, key) }
}

const z = (c) => c.repeat(52)

test('who holds, per member: their newest record per device since their last leave', (t) => {
  const r = (author, device, on, left = false) => ({ author, device, on, left })
  // newest first, as query().latest() gives them
  t.alike([...holdsFrom([r(z('a'), z('1'), true), r(z('b'), z('2'), false), r(z('b'), z('2'), true)])], [z('a')], "b's newest says off")
  t.alike([...holdsFrom([r(z('b'), z('2'), false), r(z('b'), z('3'), true)])], [z('b')], 'one device of theirs holding is enough')
  t.alike([...holdsFrom([r(z('c'), z('4'), false, true), r(z('c'), z('4'), true)])], [], 'left: not holding')
  t.alike([...holdsFrom([r(z('c'), z('4'), true), r(z('c'), z('5'), false, true), r(z('c'), z('6'), true)])], [z('c')], 'joined again after leaving: only the records after it count')
  t.alike([...holdsFrom([r(z('c'), z('4'), false), r(z('c'), z('5'), false, true), r(z('c'), z('6'), true)])], [], 'a device holding before the leave no longer counts')
})

test("a circle's name: the newest rename by an owner or admin as of now; a member's is ignored", (t) => {
  const r = (author, name) => ({ author, name })
  const deciders = new Set([z('o'), z('a')])
  t.is(pickName([], deciders, 'Made'), 'Made', 'no rename: the name it was made with')
  t.is(pickName([r(z('m'), 'By a member'), r(z('o'), 'By the owner')], deciders, 'Made'), 'By the owner', "a member's rename is ignored")
  t.is(pickName([r(z('o'), 'Newest'), r(z('a'), 'Older')], deciders, 'Made'), 'Newest', "the owner's newest wins")
  t.is(pickName([r(z('x'), 'By a removed admin'), r(z('o'), 'Before')], deciders, 'Made'), 'Before', 'someone no longer admin: no longer counts')
  t.is(pickName([r(z('o'), '')], deciders, 'Made'), 'Made', 'an empty name never counts')
})

test('share full: told once when it fills, again only after it went under 90%', (t) => {
  let s = { full: false }
  const step = (used) => { const r = shareFull(s, { on: true, used, bytes: 100 }); s = r; return r.tell }
  t.is(step(50), false)
  t.is(step(100), true, 'full: told')
  t.is(step(100), false, 'still full: not again')
  t.is(step(95), false, 'under the share, above 90%: still counts as full')
  t.is(step(99.5 + 0.5), false)
  t.is(step(80), false, 'under 90%')
  t.is(step(100), true, 'full again: told again')
  t.is(shareFull({ full: false }, { on: false, used: 100, bytes: 100 }).tell, false, 'not holding: never')
  t.is(GB, 1e9)
})

test('circles: make, invite (one use), join, members and who holds, admin, rename, remove, leave; shell only', async (t) => {
  t.timeout(240000)
  const a = await engine(t)
  const b = await engine(t)
  const c = await engine(t)
  t.alike(await a.rpc.request('circles.list'), [])
  t.is((await a.rpc.request('holding.get')).on, false, 'off until a circle')

  t.is(await codeOf(a.rpc.request('circles.create', { name: '' })), 'INVALID_PARAMS', 'a circle has a name')
  const made = await a.rpc.request('circles.create', { name: 'Family' })
  t.is(made.name, 'Family')
  const h = await a.rpc.request('holding.get')
  t.alike([h.on, h.bytes], [true, GB], 'the first circle turns holding on, 1 GB')
  t.ok(h.free > 0 && Number.isFinite(h.used), 'free space and what is held')
  const list = await a.rpc.request('circles.list')
  t.alike(list.map((x) => [x.key, x.name, x.role, x.members]), [[made.key, 'Family', 'owner', 1]])

  const { link, expires } = await a.rpc.request('circles.invite', { key: made.key })
  t.ok(link.startsWith('hg:'), 'an invite link')
  t.ok(Math.abs(expires - (Date.now() + 7 * 24 * 3600e3)) < 60e3, 'valid 7 days')
  const joined = await b.rpc.request('circles.join', { link })
  t.alike([joined.key, joined.name], [made.key, 'Family'])
  t.ok((await b.rpc.request('holding.get')).on, "joining the first circle turns the joiner's holding on too")
  t.is(await codeOf(c.rpc.request('circles.join', { link })), 'INVITE_USED_UP', 'one use: the second person is refused')

  const bId = (await b.rpc.request('contacts.me')).identity
  const members = () => a.rpc.request('circles.members', { key: made.key })
  t.ok(await eventually(async () => (await members()).length === 2 && (await members()).every((m) => m.holds), 60000), 'both listed, both hold')
  const row = (await members()).find((m) => m.identity === bId)
  t.alike([row.role, row.you, typeof row.name], ['member', false, 'string'], 'a member, named (short key until a contact)')
  t.ok(await eventually(async () => (await a.rpc.request('circles.list'))[0].holders === 2, 30000), 'the list counts who holds')
  t.ok(await eventually(async () => (await members()).every((m) => m.share === GB && typeof m.used === 'number'), 30000), "each one's share and use")
  t.ok(await eventually(async () => (await a.rpc.request('circles.list'))[0].total === 2 * GB / 5, 30000), 'the total: shares / 5')

  t.is(await codeOf(b.rpc.request('circles.invite', { key: made.key })), 'NOT_ALLOWED', 'a member invites nobody')
  t.is(await codeOf(b.rpc.request('circles.rename', { key: made.key, name: 'Mine' })), 'NOT_ALLOWED', 'a member renames nothing')
  await a.rpc.request('circles.setRole', { key: made.key, identity: bId, role: 'admin' })
  t.ok(await eventually(async () => (await b.rpc.request('circles.list'))[0]?.role === 'admin', 30000), 'made admin')
  await b.rpc.request('circles.rename', { key: made.key, name: 'Family & co' })
  t.ok(await eventually(async () => (await a.rpc.request('circles.list'))[0].name === 'Family & co', 30000), 'an admin renames it, for everyone')
  t.is(await codeOf(a.rpc.request('circles.setRole', { key: made.key, identity: bId, role: 'owner' })), 'INVALID_PARAMS', 'admin or member only')

  await a.rpc.request('circles.remove', { key: made.key, identity: bId })
  t.ok(await eventually(async () => (await members()).length === 1, 30000), 'removed')

  const { key, hyper } = await app(t, a)
  const other = await c.rpc.request('circles.create', { name: 'Not via a page' })
  const before = (await a.rpc.request('hosting')).sites
  t.is(await codeOf(hyper.instances.join((await c.rpc.request('circles.invite', { key: other.key })).link)), 'NOT_ALLOWED', "a page's instances.join of a circle link is refused")
  t.is((await a.rpc.request('hosting')).sites, before, 'and the circle is left at once')
  t.alike((await a.rpc.request('circles.list')).map((x) => x.key), [made.key], 'not one of the circles')
  for (const method of ['circles.list', 'circles.join', 'holding.set']) {
    t.is(await codeOf(a.rpc.request('site.call', { key, method, args: [] })), 'UNKNOWN_METHOD', method + ': not a site call')
  }

  await a.rpc.request('circles.leave', { key: made.key })
  t.alike(await a.rpc.request('circles.list'), [], 'left')
  t.ok((await a.rpc.request('holding.get')).on, 'leaving keeps holding as it was')
})

test('holding: the share in bytes, at most the free space plus what is held minus 2 GB; off and on', async (t) => {
  t.timeout(60000)
  const a = await engine(t)
  const h = await a.rpc.request('holding.get')
  t.is(await codeOf(a.rpc.request('holding.set', { on: true, bytes: 0.05 * GB })), 'INVALID_PARAMS', 'at least 0.1 GB')
  const big = await a.rpc.request('holding.set', { on: true, bytes: h.free + h.used }).catch((err) => err)
  t.is(big.code, 'TOO_BIG', 'more than the free space minus 2 GB')
  t.ok(/Only [\d.]+ GB free on this disk/.test(big.message), big.message)
  const set = await a.rpc.request('holding.set', { on: true, bytes: 0.5 * GB })
  t.alike([set.on, set.bytes], [true, 0.5 * GB])
  t.alike([(await a.rpc.request('holding.get')).bytes], [0.5 * GB], 'kept')
  await a.rpc.request('holding.set', { on: false })
  t.alike([(await a.rpc.request('holding.get')).on, (await a.rpc.request('holding.get')).bytes], [false, 0.5 * GB], 'off keeps the share')
  await a.rpc.request('circles.create', { name: 'Later' })
  t.is((await a.rpc.request('holding.get')).on, false, 'set before: a first circle leaves it as the person chose')
})

test('copies and rotateKey: own space, sub-spaces and instances only; wanted 0 without a circle', async (t) => {
  t.timeout(120000)
  const a = await engine(t)
  const { hyper } = await app(t, a)
  const other = await app(t, a)
  const room = await hyper.instances.create('Room', { private: true })
  t.alike(await hyper.instance(room.key).copies(), { wanted: 0, kept: 0, online: 0 }, 'no circle: nothing handed')
  t.alike(await hyper.copies(room.key), { wanted: 0, kept: 0, online: 0 }, 'an instance of its own, by key')
  t.alike(await hyper.copies(), { wanted: 0, kept: 0, online: 0 }, 'its own space')
  const theirs = await other.hyper.instances.create('Theirs', { private: true })
  t.is(await codeOf(hyper.copies(other.key)), 'NOT_ALLOWED', "another site's space")
  t.is(await codeOf(hyper.copies(theirs.key)), 'NOT_ALLOWED', "another app's instance")
  t.is(await codeOf(hyper.instance(theirs.key).copies()), 'NOT_ALLOWED', "another app's instance as a handle")

  await hyper.instance(room.key).rotateKey()
  t.pass('rotateKey on its own private instance')
  t.is(await codeOf(hyper.instance(theirs.key).rotateKey()), 'NOT_ALLOWED', "not on another app's instance")
  t.is(await codeOf(hyper.rotateKey()), 'NOT_ALLOWED', 'a public site has no content key to change')
})

test('copies with a circle: kept by the holder, the copies event', async (t) => {
  t.timeout(240000)
  const a = await engine(t)
  const b = await engine(t)
  const made = await a.rpc.request('circles.create', { name: 'Two' })
  await b.rpc.request('circles.join', { link: (await a.rpc.request('circles.invite', { key: made.key })).link })
  const { hyper } = await app(t, a)
  const room = await hyper.instances.create('Room', { private: true })
  const told = []
  hyper.instance(room.key).on('copies', (c) => told.push(c))
  await hyper.instance(room.key).put('message', { text: 'hello' })
  const kept = await eventually(async () => {
    const c = await hyper.instance(room.key).copies()
    return c.kept >= 1 && c
  }, 120000, 500)
  t.ok(kept, 'kept by b: ' + JSON.stringify(kept))
  t.is(kept.wanted, 5, '5 copies wanted')
  t.ok(await eventually(() => told.some((c) => c.kept >= 1), 10000), "the page's copies event says so")
})
