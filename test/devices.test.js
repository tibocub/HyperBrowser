// Device pairing (spec 012): two engines, one identity. The second starts with the first one's code in an
// empty folder; settings, site data and installs follow; a removed device's writes are refused.
import test from 'brittle'
import { engine, siteFolder, eventually, bootstrap } from './helpers.js'

const dynamic = { title: 'Mine', permissions: ['space'] }

test('pair two engines: one identity, settings and installs follow, remove one', async (t) => {
  t.timeout(180000)
  const pc = await engine(t, { deviceName: 'pc' })
  const { key: own } = await pc.rpc.request('site.publish', { folder: siteFolder(t, { manifest: dynamic }) })
  const other = await engine(t)
  const { key: shared } = await other.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Shared' } }) })
  await pc.rpc.request('site.open', { key: shared })
  await pc.rpc.request('site.keep', { key: shared, keep: true, timeout: 30000 })
  await pc.rpc.request('site.open', { key: own })
  await pc.rpc.request('site.consent', { key: own, allow: true })
  await pc.rpc.request('site.call', { key: own, method: 'mine.set', args: ['seen', 42] })

  const before = await pc.rpc.request('devices.list')
  t.is(before.devices.length, 1, 'one device before')
  t.is(before.phrase, 'plain')
  t.alike(before.owns, [{ key: own, name: 'Mine' }], 'owns: the site it published (the join warning)')
  t.is(before.removed, false)

  const { code } = await pc.rpc.request('devices.add')
  t.ok(typeof code === 'string' && code.length > 20, 'a code: ' + code.length + ' characters')
  const started = Date.now()
  const laptop = await engine(t, { init: false })
  const r = await laptop.rpc.request('init', { dir: laptop.dir, bootstrap: await bootstrap(t), joinCode: code, deviceName: 'laptop', joinTimeout: 60000 })
  t.comment(`joined in ${Date.now() - started} ms`)
  t.is(r.identity, (await pc.rpc.request('devices.list')).identity, 'the laptop is the PC\'s identity')

  const two = (list) => list.devices.length === 2 && list.devices.some((d) => d.name === 'pc') && list.devices.some((d) => d.name === 'laptop')
  t.ok(await eventually(async () => two(await pc.rpc.request('devices.list')), 30000), 'the PC lists both')
  t.ok(await eventually(async () => two(await laptop.rpc.request('devices.list')), 30000), 'the laptop lists both')
  const mine = (await laptop.rpc.request('devices.list')).devices.find((d) => d.current)
  t.is(mine.name, 'laptop', 'each knows which one it is')
  t.ok(pc.events.some((e) => e.event === 'devices'), 'a devices event on the PC')

  const followed = await eventually(async () => (await laptop.rpc.request('site.installed')).sites.some((s) => s.key === shared), 30000)
  t.ok(followed, 'a site installed on the PC is installed on the laptop')
  t.alike((await laptop.rpc.request('site.installed')).sites, [{ key: shared, title: 'Shared' }], 'with its title; owned sites are not "installed"')
  await pc.rpc.request('site.keep', { key: shared, keep: false })
  t.ok(await eventually(async () => (await laptop.rpc.request('site.installed')).uninstalled.includes(shared), 30000), 'uninstalled on the PC: the laptop is told')

  // its site record may not be here yet right after the join (SwarmFS: NOT_FOUND 'not a site' until it is)
  t.ok(await eventually(() => laptop.rpc.request('site.open', { key: own, timeout: 30000 }).then(() => true, () => false), 30000), 'the PC site opens on the laptop')
  const data = await eventually(async () => {
    const all = await laptop.rpc.request('site.call', { key: own, method: 'mine.all' }).catch(() => null)
    return all?.seen === 42 && all
  }, 30000)
  t.ok(data, 'the identity answer and the site\'s own data follow (no NEEDS_CONSENT on the laptop)')

  const lid = mine.publicKey
  await t.exception(pc.rpc.request('devices.remove', { publicKey: (await pc.rpc.request('devices.list')).devices.find((d) => d.current).publicKey }), /device you are on/, 'not the device you are on')
  await pc.rpc.request('devices.remove', { publicKey: lid })
  t.is((await pc.rpc.request('devices.list')).devices.length, 1, 'gone from the PC\'s list')
  t.ok(await eventually(async () => (await laptop.rpc.request('devices.list')).removed, 30000), 'the laptop knows it was removed')
  const refused = await laptop.rpc.request('site.call', { key: own, method: 'mine.set', args: ['seen', 1] }).catch((err) => err)
  t.is(refused.code, 'DEVICE_REMOVED', 'its writes are refused')
})

test('join: a code that is not one is refused; the engine can still start', async (t) => {
  const e = await engine(t, { init: false })
  const net = await bootstrap(t)
  const err = await e.rpc.request('init', { dir: e.dir, bootstrap: net, joinCode: 'nonsense' }).catch((err) => err)
  t.is(err.code, 'INVITE_INVALID')
})

test('the recovery phrase: shown, protected, then asked for', async (t) => {
  const e = await engine(t)
  const { words } = await e.rpc.request('devices.phrase')
  t.is(words.split(' ').length, 24)
  await e.rpc.request('devices.protect', { password: 'pw' })
  t.is((await e.rpc.request('devices.list')).phrase, 'protected')
  await t.exception(e.rpc.request('devices.phrase'), /NOT_ALLOWED|password/i, 'not without the password')
  t.is((await e.rpc.request('devices.phrase', { password: 'pw' })).words, words)
  const no = await e.rpc.request('devices.add').catch((err) => err)
  t.is(no.code, 'NOT_ALLOWED', 'adding a device asks for it too')
  t.ok((await e.rpc.request('devices.add', { password: 'pw' })).code)
  await t.exception(e.rpc.request('devices.protect', {}), /password/, 'protect needs a password')
})

test('a joined folder opens again (the next start)', async (t) => {
  t.timeout(120000)
  const pc = await engine(t, { deviceName: 'pc' })
  const { code } = await pc.rpc.request('devices.add')
  const first = await engine(t, { init: false })
  const { identity } = await first.rpc.request('init', { dir: first.dir, bootstrap: await bootstrap(t), joinCode: code, deviceName: 'laptop' })
  await first.rpc.request('close')
  const again = await engine(t, { dir: first.dir })
  t.is((await again.rpc.request('devices.list')).identity, identity)
})
