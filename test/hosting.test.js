// "Not served" is checked the only way that matters: a fresh peer can't open it.
import test from 'brittle'
import { engine, siteFolder, codeOf, eventually, sleep, text } from './helpers.js'

const GRACE = 500 // ms, instead of minutes

async function published (t) {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t, { files: { 'index.html': '<h1>hosted</h1>' } }) })
  return { owner, key }
}

async function reads (e, key, timeout = 30000) {
  await e.rpc.request('site.open', { key, timeout })
  return text((await e.rpc.request('site.read', { key, path: '', timeout })).bytes)
}

const unreachable = async (t, key, ms = 5000) => {
  const v = await engine(t)
  const code = await codeOf(reads(v, key, ms))
  await v.rpc.request('close')
  return code
}

test('an installed site is served with no tab open, and after a restart', async (t) => {
  t.timeout(120000)
  const { owner, key } = await published(t)
  const host = await engine(t, { grace: GRACE })
  t.is(await reads(host, key), '<h1>hosted</h1>')
  await host.rpc.request('site.keep', { key, keep: true })
  t.ok(await eventually(async () => (await host.rpc.request('site.held', { key })).bytes > 0, 20000, 250), 'kept here')
  await host.rpc.request('site.close', { key })
  await owner.rpc.request('close') // the publisher offline: only the host serves it
  await sleep(GRACE * 3)

  const v1 = await engine(t)
  t.is(await reads(v1, key), '<h1>hosted</h1>', 'served by the host, no tab open, past the grace period')
  await v1.rpc.request('close')

  await host.rpc.request('close')
  const again = await engine(t, { dir: host.dir, grace: GRACE })
  await sleep(GRACE * 3)
  const v2 = await engine(t)
  t.is(await reads(v2, key), '<h1>hosted</h1>', 'and after a restart, nothing opened')
  await v2.rpc.request('close')
  await again.rpc.request('close')
})

test('a site only visited is left after its grace period, and at the next start', async (t) => {
  t.timeout(120000)
  const { owner, key } = await published(t)
  const visitor = await engine(t, { grace: GRACE })
  t.is(await reads(visitor, key), '<h1>hosted</h1>')
  t.is((await visitor.rpc.request('hosting')).sites, 1, 'hosting (the tray count, spec 010): the one open site')
  await owner.rpc.request('close')

  const v1 = await engine(t)
  t.is(await reads(v1, key), '<h1>hosted</h1>', 'served while its tab is open')
  await v1.rpc.request('close')

  await visitor.rpc.request('site.open', { key })
  await visitor.rpc.request('site.close', { key })
  await sleep(GRACE * 3)
  t.is((await visitor.rpc.request('site.state', { key })).complete, true, 'one tab closed of two: still open')
  await visitor.rpc.request('site.close', { key })
  await sleep(GRACE * 4)
  t.ok(await unreachable(t, key), 'not served once the grace period is over')
  t.is((await visitor.rpc.request('hosting')).sites, 0, 'hosting: none once it is left')
  t.ok(await codeOf(visitor.rpc.request('site.state', { key })), 'closed here')
  await visitor.rpc.request('close')
})

test('at start, a site neither installed nor own is left; opened again, it comes back and can be installed', async (t) => {
  t.timeout(120000)
  const { owner, key } = await published(t)
  const visitor = await engine(t)
  t.is(await reads(visitor, key), '<h1>hosted</h1>')
  t.is((await owner.rpc.request('site.open', { key })).key, key)
  await visitor.rpc.request('close') // a tab still open: no grace period at shutdown, the start decides

  const restarted = await engine(t, { dir: visitor.dir, grace: GRACE })
  await owner.rpc.request('close')
  t.ok(await unreachable(t, key), 'not served after the restart')
  await restarted.rpc.request('close')

  const back = await engine(t, { dir: owner.dir })
  const v = await engine(t, { dir: visitor.dir, grace: GRACE })
  t.is(await reads(v, key), '<h1>hosted</h1>', 'opened again after it was left')
  await v.rpc.request('site.keep', { key, keep: true })
  t.ok(await eventually(async () => (await v.rpc.request('site.held', { key })).bytes > 0, 20000, 250), 'installed after being left')
  await v.rpc.request('site.close', { key })
  await back.rpc.request('close')
  await sleep(GRACE * 3)
  const v2 = await engine(t)
  t.is(await reads(v2, key), '<h1>hosted</h1>', 'served by the visitor that installed it')
  await v2.rpc.request('close')
  await v.rpc.request('close')
})

test("an admin's site (a project's co-author, spec 024) stays joined at start, like the owner's", async (t) => {
  t.timeout(120000)
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Team', permissions: ['space'] } }) })
  const admin = await engine(t)
  await admin.rpc.request('site.open', { key, timeout: 30000 })
  await admin.rpc.request('site.consent', { key, allow: true })
  const { identity } = await admin.rpc.request('devices.list')
  await owner.rpc.request('site.open', { key })
  await owner.rpc.request('site.consent', { key, allow: true })
  await owner.rpc.request('site.call', { key, method: 'setRole', args: [identity, 'admin'] })
  t.ok(await eventually(async () => (await admin.rpc.request('site.call', { key, method: 'getRole', args: [identity] })) === 'admin', 20000), 'an admin')
  await admin.rpc.request('close')
  const restarted = await engine(t, { dir: admin.dir, grace: GRACE })
  t.is((await restarted.rpc.request('hosting')).sites, 1, 'still joined after the restart')
  await restarted.rpc.request('close')
})
