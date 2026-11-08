// Federated apps (spec 009): an app's instances, owned by whoever made them, reached by that app only.
// Through the site API as a page sees it (siteApi() is window.hyper), engines on a local DHT.
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { engine, siteFolder, siteApi, codeOf, eventually, sleep, text } from './helpers.js'

const NOTE = { note: { fields: { text: 'string' } } }
const APP = { manifest: { title: 'Forums', permissions: ['space'], types: NOTE }, files: { 'index.html': '<h1>v1</h1>' } }

// Tibo publishes the app; `people` engines open it and allow it. → { tibo, key, folder, apis: [hyper of each] }
async function app (t, people, opts = APP) {
  const tibo = await engine(t)
  const folder = siteFolder(t, opts)
  const { key } = await tibo.rpc.request('site.publish', { folder })
  const out = []
  for (let i = 0; i < people; i++) out.push(await opened(t, key))
  return { tibo, key, folder, people: out }
}

async function opened (t, key, e = null) {
  e = e || await engine(t)
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  return { e, hyper: siteApi(e, key), me: (await e.rpc.request('site.call', { key, method: 'info' })).identity }
}

const notes = async (h) => (await h.query('note').latest(20)).items.map((n) => n.text)

test('two people each create an instance: each owns theirs, neither has authority over the other\'s', async (t) => {
  t.timeout(180000)
  const { tibo, key, people: [a, b] } = await app(t, 2)
  const fa = await a.hyper.instances.create('A forum')
  const fb = await b.hyper.instances.create('B forum', { public: true })
  t.is(fa.name, 'A forum')
  t.alike((await a.hyper.instances.list()).map((i) => [i.key, i.name, i.role, i.public]), [[fa.key, 'A forum', 'owner', false]], 'listed, owner, invite-only by default')
  t.alike((await b.hyper.instances.list()).map((i) => [i.role, i.public]), [['owner', true]], 'public when asked')
  const ia = a.hyper.instance(fa.key)
  t.is((await ia.info()).app, key, 'an instance names its app')
  t.is((await ia.put('note', { text: 'hi from A' })).text, 'hi from A', 'the app\'s types work in it')

  // B joins A's forum as a member: no authority there
  const link = await ia.createInvite({ role: 'member' })
  const joined = await b.hyper.instances.join(link)
  t.is(joined.key, fa.key)
  const ba = b.hyper.instance(fa.key)
  t.ok(await eventually(async () => (await notes(ba)).includes('hi from A'), 15000), 'B reads A\'s forum')
  t.is(await codeOf(ba.setRole(b.me, 'admin')), 'NOT_ALLOWED', 'B can\'t give himself a role')
  t.is(await codeOf(ba.createSubspace({ name: 'B\'s board' })), 'NOT_ALLOWED', 'nor make a board')
  t.ok(await codeOf(ba.createInvite({ role: 'admin' })), 'nor invite an admin')
  t.is(await codeOf(ba.moderateAction('hide', (await ia.query('note').latest(1)).items[0].id, { reason: 'x' })), 'NOT_ALLOWED', 'nor hide A\'s post')
  t.is(await ia.getRole(b.me), 'member')

  // Tibo, the app's author: no role in either
  const tiboHyper = (await opened(t, key, tibo)).hyper
  t.is(await codeOf(tiboHyper.instance(fa.key).info()), 'NOT_ALLOWED', 'the app\'s author doesn\'t reach A\'s forum')
  t.is(await ia.getRole((await tiboHyper.info()).identity), null, 'and has no role in it')
  t.is(await codeOf(a.hyper.instances.create('')), 'INVALID_PARAMS', 'a name of 1 to 200 characters')
  t.is(await codeOf(a.hyper.instances.create('x'.repeat(201))), 'INVALID_PARAMS')
  t.is(await codeOf(a.hyper.instances.create('ok', { public: 'yes' })), 'INVALID_PARAMS', 'public is true or false')
})

test('a third person joins both (invite, public link); leaving drops one', async (t) => {
  t.timeout(180000)
  const { key, people: [a, b, c] } = await app(t, 3)
  const fa = await a.hyper.instances.create('A forum')
  const fb = await b.hyper.instances.create('B forum', { public: true })
  await c.hyper.instances.join(await a.hyper.instance(fa.key).createInvite({ role: 'member' }))
  const pub = (await b.hyper.instance(fb.key).info()).key // a public instance's link is its key
  await c.hyper.instances.join('hg:' + pub)
  t.alike((await c.hyper.instances.list()).map((i) => [i.name, i.role]).sort(), [['A forum', 'member'], ['B forum', 'member']])
  await c.hyper.instance(fa.key).put('note', { text: 'C in A' })
  await c.hyper.instance(fb.key).put('note', { text: 'C in B' })
  t.ok(await eventually(async () => (await notes(a.hyper.instance(fa.key))).includes('C in A'), 15000), 'A sees C\'s post')
  t.ok(await eventually(async () => (await notes(b.hyper.instance(fb.key))).includes('C in B'), 15000), 'B sees C\'s post')

  await c.hyper.instances.leave(fa.key)
  t.alike((await c.hyper.instances.list()).map((i) => i.name), ['B forum'], 'left: not listed')
  t.is(await codeOf(c.hyper.instance(fa.key).info()), 'NOT_ALLOWED', 'and not reachable')
  t.is(await codeOf(c.hyper.instances.leave(fa.key)), 'NOT_ALLOWED', 'leaving twice')
  t.is(await a.hyper.instance(fa.key).getRole(c.me), 'member', 'still a member: a link brings them back')
  t.ok(key)
})

test('opening an instance\'s link opens its app on it', async (t) => {
  t.timeout(120000)
  const { key, people: [a] } = await app(t, 1)
  const fa = await a.hyper.instances.create('A forum')
  const link = await a.hyper.instance(fa.key).createInvite({ role: 'member' })
  const d = await engine(t)
  const o = await d.rpc.request('site.open', { key: link })
  t.alike([o.key, o.instance, o.manifest.title, o.dynamic], [key, fa.key, 'Forums', true], 'the app, on that instance')
  t.is(text((await d.rpc.request('site.read', { key, path: '' })).bytes), '<h1>v1</h1>', 'the app\'s page')
  await d.rpc.request('site.consent', { key, allow: true })
  t.alike((await siteApi(d, key).instances.list()).map((i) => i.key), [fa.key], 'listed for that app')
  const again = await d.rpc.request('site.open', { key: fa.key })
  t.is(again.instance, fa.key, 'its key opens it too, once joined')
})

test('one fix reaches every instance: the app\'s new page and new type', async (t) => {
  t.timeout(180000)
  const { tibo, key, folder, people: [a, b] } = await app(t, 2)
  const fa = await a.hyper.instances.create('A forum')
  const fb = await b.hyper.instances.create('B forum')
  const m = await b.hyper.instances.join(await a.hyper.instance(fa.key).createInvite({ role: 'member' }))
  t.is(m.key, fa.key)

  fs.writeFileSync(path.join(folder, 'index.html'), '<h1>v2</h1>')
  fs.writeFileSync(path.join(folder, 'site.json'), JSON.stringify({ ...APP.manifest, types: { ...NOTE, tag: { fields: { name: 'string' } } } }))
  await tibo.rpc.request('site.publish', { folder })
  for (const p of [a, b]) {
    t.ok(await eventually(async () => {
      await p.e.rpc.request('site.open', { key }) // a new tab: the manifest read again
      await p.e.rpc.request('site.close', { key })
      return text((await p.e.rpc.request('site.read', { key, path: 'index.html', timeout: 5000 }).catch(() => ({ bytes: new Uint8Array() }))).bytes) === '<h1>v2</h1>'
    }, 30000, 500), 'the new page, for every instance')
  }
  await a.e.rpc.request('site.open', { key })
  await b.e.rpc.request('site.open', { key })
  const fresh = { a: siteApi(a.e, key), b: siteApi(b.e, key) }
  t.ok(await eventually(async () => (await codeOf(fresh.a.instance(fa.key).put('tag', { name: 'x' }))) === null, 20000, 500), 'A\'s instance gains the new type once its owner opens it')
  t.ok(await eventually(async () => (await codeOf(fresh.b.instance(fb.key).put('tag', { name: 'y' }))) === null, 20000, 500), 'and B\'s')
})

test('an app reaches only its own instances (guards)', async (t) => {
  t.timeout(180000)
  const { key, people: [a] } = await app(t, 1)
  const other = await app(t, 1)
  const fa = await a.hyper.instances.create('A forum')
  // the other app, on A's engine
  const ao = (await opened(t, other.key, a.e)).hyper
  const fo = await ao.instances.create('Other app\'s forum')

  t.is(await codeOf(a.hyper.instance(other.key).info()), 'NOT_ALLOWED', 'another site\'s space')
  t.is(await codeOf(a.hyper.instance(fo.key).info()), 'NOT_ALLOWED', 'another app\'s instance, though the person is in it')
  t.is(await codeOf(ao.instance(fa.key).put('note', { text: 'x' })), 'NOT_ALLOWED', 'the other way round')
  t.is(await codeOf(a.hyper.instance('y'.repeat(52)).info()), 'NOT_ALLOWED', 'a guessed key')
  t.is(await codeOf(a.hyper.instance('nope').info()), 'INVALID_KEY')
  t.is(await codeOf(a.hyper.instance(key).info()), 'NOT_ALLOWED', 'the app\'s own key is not an instance')

  // joining what isn't one of its instances
  const pubSite = await engine(t)
  const s = await pubSite.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Public site', permissions: ['space'] } }) })
  t.is(await codeOf(a.hyper.instances.join('hg:' + s.key)), 'NOT_ALLOWED', 'a site\'s public link')
  t.is(await codeOf(a.e.rpc.request('site.call', { key, instance: s.key, method: 'info' })), 'NOT_ALLOWED', 'and it isn\'t reachable after')
  const b = await opened(t, other.key)
  const fb = await b.hyper.instances.create('B forum')
  t.is(await codeOf(a.hyper.instances.join(await b.hyper.instance(fb.key).createInvite({ role: 'member' }))), 'NOT_ALLOWED', 'another app\'s instance\'s invite')
  t.is(await codeOf(a.hyper.instances.join('not a link')), 'INVALID_PARAMS')
  t.alike((await a.hyper.instances.list()).map((i) => i.key), [fa.key], 'nothing added')

  // consent taken back: none of its instances
  await a.e.rpc.request('site.consent', { key, allow: false })
  t.is(await codeOf(a.hyper.instance(fa.key).info()), 'NOT_ALLOWED', 'no consent, no instance')
  t.is(await codeOf(a.hyper.instances.list()), 'NOT_ALLOWED')

  // a static site has no instances
  const st = await a.e.rpc.request('site.publish', { folder: siteFolder(t) })
  await a.e.rpc.request('site.open', { key: st.key })
  t.is(await codeOf(a.e.rpc.request('site.call', { key: st.key, method: 'instances.create', args: ['x'] })), 'NOT_ALLOWED')
})

test('joined instances stay joined: no tab, past the grace period, after a restart', async (t) => {
  t.timeout(180000)
  const GRACE = 300
  const { key, people: [a] } = await app(t, 1)
  const fa = await a.hyper.instances.create('A forum')
  await a.hyper.instance(fa.key).put('note', { text: 'kept' })
  const link = await a.hyper.instance(fa.key).createInvite({ role: 'member' })
  const c = await opened(t, key, await engine(t, { grace: GRACE }))
  await c.hyper.instances.join(link)
  t.ok(await eventually(async () => (await notes(c.hyper.instance(fa.key))).includes('kept'), 15000))
  await c.e.rpc.request('site.close', { key })
  await sleep(GRACE * 4)
  await a.e.rpc.request('close') // its owner offline: only what C holds
  await c.e.rpc.request('close')

  const again = await engine(t, { dir: c.e.dir, grace: GRACE })
  await sleep(GRACE * 4) // the start-up sweep
  const h = (await opened(t, key, again)).hyper
  t.alike((await h.instances.list()).map((i) => i.key), [fa.key], 'still listed')
  t.alike(await notes(h.instance(fa.key)), ['kept'], 'and held here: read with its owner offline')
})
