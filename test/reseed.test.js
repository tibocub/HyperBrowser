// Reseeding I2P through peers: engines hand each other router records and I2P DHT nodes on a topic of the regular
// network (engine/reseed.js, on the test's DHT); a fresh router takes records from 3 peers at least, never from one
// alone, and keeps the official reseed on (shell/i2p.js, with a stand-in router process).
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { reseed, checkShare } from '../engine/reseed.js'
import { tmpDir, bootstrap, eventually } from './helpers.js'

const NAME = (c) => 'routerInfo-' + c.repeat(44) + '.dat'
const NODE = 'a'.repeat(52) + ':1'

test('reseed: two engines hand each other their records and nodes', { timeout: 60000 }, async (t) => {
  const boot = await bootstrap(t)
  const got = { a: [], b: [] }
  const a = reseed({ bootstrap: boot, emit: (e, d) => got.a.push(d) })
  const b = reseed({ bootstrap: boot, emit: (e, d) => got.b.push(d) })
  t.teardown(async () => { await a.close(); await b.close() })
  await a.set({ records: [{ name: NAME('A'), data: 'AAAA' }], nodes: [NODE] })
  await b.set({ records: [{ name: NAME('B'), data: 'BBBB' }], nodes: [] })
  t.ok(await eventually(() => got.a.length && got.b.length, 30000), 'both heard')
  t.alike(got.a[0].records.map((r) => r.name), [NAME('B')])
  t.alike(got.b[0].records.map((r) => r.name), [NAME('A')])
  t.alike(got.b[0].nodes, [NODE])
})

test('reseed: a peer\'s message is kept only well formed', (t) => {
  t.ok(checkShare({ records: [{ name: NAME('x'), data: 'AA==' }], nodes: [NODE] }))
  t.is(checkShare({ records: [{ name: '../../etc/passwd', data: 'AA' }], nodes: [] }), null, 'a path, not a record name')
  t.is(checkShare({ records: [], nodes: ['example.com:80'] }), null, 'not an I2P address')
  t.is(checkShare({ records: Array(101).fill({ name: NAME('x'), data: '' }), nodes: [] }), null, 'too many')
  t.is(checkShare({ records: [{ name: NAME('x'), data: 'A'.repeat(10000) }], nodes: [] }), null, 'too big')
  t.is(checkShare('nope'), null)
})

if (typeof Bare === 'undefined') {
  const { i2p } = await import('../shell/i2p.js')
  const Sidecar = (await import('bare-sidecar')).default
  const FAKE = fileURLToPath(new URL('./fixtures/router/fake.js', import.meta.url))
  const run = (entry, args) => new Sidecar(FAKE, args)
  const peer = (c) => ({ peer: c.repeat(64), records: [{ name: NAME(c), data: Buffer.from('record ' + c).toString('base64') }], nodes: [] })

  test('i2p: a fresh router takes records from 3 peers, beside the official reseed', { timeout: 30000 }, async (t) => {
    const home = tmpDir(t, 'home')
    const s = i2p({ home, run, zone: 'UTC', locale: 'en', log: () => {}, peersMs: 20000 })
    t.teardown(() => s.stop())
    const me = { dir: tmpDir(t, 'me'), anonymous: false }
    const started = s.begin({ peers: true })
    await eventually(() => s.router.port > 0)
    for (const c of ['a', 'b', 'c']) s.heard(peer(c), me)
    await started
    const db = path.join(home, 'i2p-router', 'netDb')
    t.ok(fs.existsSync(path.join(db, 'ra', NAME('a'))), 'written where i2pd reads them')
    t.ok(fs.existsSync(path.join(db, 'rc', NAME('c'))))
    t.is(s.router.options.reseedThreshold, 3 + 25, 'the official reseed still runs')
    t.is(s.records().length, 3, 'and handed on to peers in turn')
  })

  test('i2p: one peer\'s records are never used alone; an anonymous identity never waits on peers', { timeout: 30000 }, async (t) => {
    const home = tmpDir(t, 'home')
    const s = i2p({ home, run, zone: 'UTC', locale: 'en', log: () => {}, peersMs: 1000 })
    t.teardown(() => s.stop())
    s.heard(peer('a'), { dir: tmpDir(t, 'me'), anonymous: false })
    await s.begin({ peers: true })
    t.absent(fs.existsSync(path.join(home, 'i2p-router', 'netDb')), 'nothing written from one peer')
    t.absent(s.router.options.reseedThreshold)
    const anon = i2p({ home: tmpDir(t, 'home2'), run, zone: 'UTC', locale: 'en', log: () => {}, peersMs: 60000 })
    t.teardown(() => anon.stop())
    const t0 = Date.now()
    await anon.begin({ peers: false })
    t.ok(Date.now() - t0 < 5000, 'started at once')
  })

  test('i2p: DHT nodes from peers go to a regular identity\'s next start, never an anonymous one\'s', (t) => {
    const s = i2p({ home: tmpDir(t, 'home'), run, zone: 'UTC', locale: 'en', log: () => {} })
    const reg = { dir: tmpDir(t, 'reg'), anonymous: false }
    const anon = { dir: tmpDir(t, 'anon'), anonymous: true }
    s.heard({ peer: 'x', records: [], nodes: [NODE] }, reg)
    s.heard({ peer: 'x', records: [], nodes: [NODE] }, anon)
    t.ok(s.open(reg).sam.bootstrap.includes(NODE))
    t.absent(s.open(anon).sam.bootstrap.includes(NODE))
  })
}
