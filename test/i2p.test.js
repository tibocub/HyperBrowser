// The shell's I2P rules (shell/i2p.js), the anonymous flag of identities, and an anonymous engine's contacts.
// No router: what each identity opens with, never the router itself (the router has test/router.test.js).
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { tmpDir } from './helpers.js'

if (typeof Bare !== 'undefined') {
  test('i2p: skipped on Bare (shell code)', (t) => t.pass('skipped on Bare'))
} else {
  const { strictCountry, switchWarning, admit, i2p } = await import('../shell/i2p.js')
  const { identities } = await import('../shell/identities.js')

  test('i2p: strict countries by region or time zone; relaying forced off there', (t) => {
    t.is(strictCountry('Europe/Paris', 'fa-IR'), 'IR', 'by the system region')
    t.is(strictCountry('Asia/Tehran', 'en-US'), 'IR', 'by the time zone')
    t.is(strictCountry('Europe/Istanbul', 'en'), 'TR')
    t.is(strictCountry('Europe/Paris', 'fr-FR'), null)
    t.is(strictCountry('UTC', 'en'), null)
    const home = tmpDir(t, 'i2p')
    const strict = i2p({ home, run: () => { throw new Error('no router here') }, zone: 'Asia/Shanghai', locale: 'zh-CN', log: () => {} })
    t.is(strict.settings().strict, 'CN')
    t.ok(strict.router.options.notransit, 'the router relays nothing')
    const free = i2p({ home: tmpDir(t, 'i2p2'), run: () => { throw new Error('no router here') }, zone: 'Europe/Paris', locale: 'fr-FR', log: () => {} })
    t.absent(free.router.options.notransit, 'elsewhere it relays')
    t.ok(free.router.options.upnp, 'UPnP on by default')
    t.is(free.router.options.bandwidth, 'O')
  })

  test('i2p: the warning when a regular and an anonymous identity follow each other within 10 minutes, either way', (t) => {
    const now = 1e9
    t.ok(switchWarning({ anonymous: null, regular: now - 60000 }, true, now)?.includes('regular identity closed 1 min ago'))
    t.ok(switchWarning({ anonymous: now - 1000, regular: null }, false, now)?.includes('anonymous identity just closed'))
    t.is(switchWarning({ anonymous: null, regular: now - 11 * 60000 }, true, now), null, 'past 10 minutes')
    t.is(switchWarning({ anonymous: now - 1000, regular: null }, true, now), null, 'the same kind')
    const s = i2p({ home: tmpDir(t, 'i2p'), run: () => { throw new Error('no router here') }, zone: 'UTC', locale: 'en', log: () => {} })
    t.ok(s.warning({ dir: '', anonymous: true }, { dir: '', anonymous: false }), 'switching right now: warned')
    t.is(s.warning({ dir: '', anonymous: true }), null, 'nothing closed yet')
    s.closed({ dir: '', anonymous: true })
    t.ok(s.warning({ dir: '', anonymous: false }), 'a regular one after an anonymous one closed')
  })

  test('i2p: what an identity opens with; the DHT nodes it learned stay in its own folder', (t) => {
    const s = i2p({ home: tmpDir(t, 'i2p'), run: () => { throw new Error('no router here') }, zone: 'UTC', locale: 'en', log: () => {} })
    s.router.port = 7656
    const anonDir = tmpDir(t, 'anon')
    const regDir = tmpDir(t, 'reg')
    const anon = s.open({ dir: anonDir, anonymous: true })
    t.is(anon.transport, 'i2p')
    t.is(anon.deviceName, '', 'no computer name')
    t.is(anon.sam.port, 7656)
    const reg = s.open({ dir: regDir, anonymous: false })
    t.is(reg.transport, 'dual')
    t.absent('deviceName' in reg)
    s.learn({ dir: anonDir, anonymous: true }, ['abc:1'])
    t.ok(s.open({ dir: anonDir, anonymous: true }).sam.bootstrap.includes('abc:1'))
    t.absent(s.open({ dir: regDir, anonymous: false }).sam.bootstrap.includes('abc:1'), 'not another identity\'s')
    t.ok(fs.existsSync(path.join(anonDir, 'i2p-nodes.json')))
  })

  test('i2p: an anonymous identity never opens without guards; the updater pauses for it', (t) => {
    t.alike(admit({ anonymous: false }, true), { updates: 'run' })
    t.alike(admit({ anonymous: true }, true), { updates: 'pause' })
    t.exception(() => admit({ anonymous: true }, false), /--no-guards/)
    t.alike(admit({ anonymous: false }, false), { updates: 'run' }, 'a regular one may (a control run)')
  })

  test('identities: anonymous is set at creation, for good, and listed', (t) => {
    const ids = identities(tmpDir(t, 'home'))
    const a = ids.create('Ana', { anonymous: true })
    const b = ids.create('Bob')
    t.ok(ids.get(a).anonymous)
    t.absent(ids.get(b).anonymous)
    t.alike(ids.list().map((i) => [i.name, i.anonymous]), [['Main', false], ['Ana', true], ['Bob', false]])
    ids.rename(a, 'Ann')
    t.ok(ids.get(a).anonymous, 'kept through a rename')
  })
}
