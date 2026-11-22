import test from 'brittle'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { parse, merge, template, defaults } from '../engine/helper-config.js'
import { helper } from '../engine/helper.js'
import { engine, siteFolder, tmpDir, bootstrap, eventually, within, text, sleep } from './helpers.js'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'cli.js')
const KEY = 'ycexw7hb3cqmckdtsewjxgnxnnjom3t6ofqmkq1hgqxqaceutmro'

test('config: key = value, comments, lists, bad lines logged and ignored', (t) => {
  const { values, errors } = parse(`# a comment
name = Box one
share = 12.5
apps = none
seed = ${KEY}
seed = ${KEY.replace('y', 'n')}
join = hg:abc
colour = blue
share = lots
apps = some
seed = not-a-key
toString = x
`)
  t.alike(values, { name: 'Box one', share: 12.5, apps: 'none', seed: [KEY, KEY.replace('y', 'n')], join: ['hg:abc'] })
  t.is(errors.length, 5, errors.join('; '))
  t.ok(errors[0].startsWith('line 8: unknown setting "colour"'))
})

test('config: the written file sets nothing; command line, then file, then defaults', (t) => {
  const base = defaults('vps1')
  t.is(base.name, 'Helper (vps1)')
  t.is(base.apps, 'official')
  t.is(base.share, null)
  t.alike(parse(template(base)), { values: {}, errors: [] }, 'every setting commented out')
  const file = { name: 'From file', join: ['hg:a'], dir: '/srv/h' }
  const m = merge({ dir: '/cli', join: ['hg:b', 'hg:a'], name: undefined }, file, base)
  t.is(m.dir, '/cli')
  t.is(m.name, 'From file')
  t.alike(m.join, ['hg:a', 'hg:b'], 'a --join adds to the file\'s')
  t.alike(m.seed, [])
})

const config = (c = {}) => ({ ...defaults('test'), apps: 'none', share: 0.5, ...c })
const lines = () => {
  const out = []
  const log = (l) => out.push(l)
  return { out, log, has: (re) => out.some((l) => re.test(l)) }
}

test('helper: joins from a link once, remembers it, a used link is refused once; its name, its share capped', async (t) => {
  t.timeout(120000)
  const a = await engine(t)
  const ring = await a.rpc.request('circles.create', { name: 'Family' })
  const link = (await a.rpc.request('circles.invite', { key: ring.key })).link
  const h = await engine(t)
  const l = lines()
  const hp = helper({ rpc: h.rpc, dir: h.dir, preset: '', log: l.log, tick: 3600000 })
  t.teardown(() => hp.close())
  await hp.apply(config({ join: [link], name: 'Helper (box)' }))
  t.ok(l.has(/^joined "Family"$/), l.out.join(' | '))
  t.is((await h.rpc.request('contacts.me')).name, 'Helper (box)')
  const h2 = await engine(t)
  const l2 = lines()
  let drift = 0 // the disk's free space moving a little (logs, other programs) between passes
  // The helper sees 3 GB free whatever the disk has: the real figure moved by more than 0.1 GB
  // between passes while other test files wrote to the same disk. The engine still checks the
  // real one when the share is set (about 1 GB here, so the disk needs 3 GB free).
  const FREE = 3e9
  const rpc2 = { request: async (m, a) => { const r = await h2.rpc.request(m, a); if (m === 'holding.get') r.free = FREE - drift; return r } }
  const hp2 = helper({ rpc: rpc2, dir: h2.dir, preset: '', log: l2.log, tick: 3600000 })
  t.teardown(() => hp2.close())
  await hp2.apply(config({ join: [link, 'hg:nonsense'] }))
  t.is(l2.out.filter((x) => x.startsWith('refused:')).length, 2, l2.out.join(' | '))
  const n = l2.out.length
  await hp2.apply(config({ join: [link, 'hg:nonsense'] }))
  t.is(l2.out.length, n, 'not tried again')
  t.alike(JSON.parse(fs.readFileSync(path.join(h2.dir, 'helper.json'), 'utf-8')).links, { [link]: 'refused', 'hg:nonsense': 'refused' }, 'remembered in its folder')
  await hp2.apply(config({ share: 1e6 }))
  t.ok(l2.has(/^share: [\d.]+ GB \(capped: 1000000 GB asked/), 'above the disk: the most allowed, logged')
  t.ok((await h2.rpc.request('holding.get')).on, 'holding on')
  const shares = l2.out.filter((x) => x.startsWith('share:')).length
  drift = 5 * 1024 * 1024
  await hp2.apply(config({ share: 1e6 }))
  t.is(l2.out.filter((x) => x.startsWith('share:')).length, shares, 'capped: a few MB less free sets and logs nothing again')
})

test('helper: B writes to A while A is offline; A reads it with only the helper online (SC-1)', async (t) => {
  t.timeout(420000)
  const APP = { title: 'Talk', permissions: ['space'], types: { message: { fields: { text: 'string' } } } }
  const adir = tmpDir(t, 'a')
  const bdir = tmpDir(t, 'b')
  let a = await engine(t, { dir: adir })
  const b = await engine(t, { dir: bdir })
  const ring = await a.rpc.request('circles.create', { name: 'AB' })
  await b.rpc.request('circles.join', { link: (await a.rpc.request('circles.invite', { key: ring.key })).link })
  const h = await engine(t)
  const hp = helper({ rpc: h.rpc, dir: h.dir, preset: '', log: () => {}, tick: 2000 })
  t.teardown(() => hp.close())
  const { key } = await b.rpc.request('site.publish', { folder: siteFolder(t, { manifest: APP }) })
  await hp.apply(config({ join: [(await a.rpc.request('circles.invite', { key: ring.key })).link], seed: [key] }))
  const call = (e, method, args, instance = null) => e.rpc.request('site.call', { key, instance, method, args })
  const open = async (e) => { await e.rpc.request('site.open', { key, timeout: 60000 }); await e.rpc.request('site.consent', { key, allow: true }) }
  await open(b)
  await open(a)
  const room = await call(b, 'instances.create', ['B and A', { private: true }])
  await call(a, 'instances.join', [await call(b, 'createInvite', [{ role: 'member' }], room.key)])
  await a.rpc.request('close') // A offline
  await call(b, 'put', ['message', { text: 'while you were away' }], room.key)
  t.ok(await eventually(async () => (await call(b, 'copies', [], room.key)).kept >= 1, 180000, 500), "the helper keeps B's conversation")
  await b.rpc.request('close') // B offline: only the helper
  a = await engine(t, { dir: adir })
  await open(a)
  let last = null
  const latest = () => a.rpc.request('site.call', { key, instance: room.key, method: 'query', args: ['message'], chain: [['latest', [5]]] }).then((r) => { last = JSON.stringify(r).slice(0, 300); return r }, (err) => { last = err.code + ' ' + err.message; return { items: [] } })
  t.ok(await eventually(async () => (await latest()).items.some((m) => m.text === 'while you were away'), 180000, 1000), 'A reads it: ' + last)
})

test('helper: an app it keeps gets a new version within 30 s, no restart, and serves it (SC-2)', async (t) => {
  t.timeout(180000)
  const folder = siteFolder(t, { files: { 'index.html': '<h1>v1</h1>', 'big.bin': 'x'.repeat(300 * 1024), 'sub/page.html': 'p1' } })
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder })
  const presetFile = path.join(tmpDir(t, 'preset'), 'preset.json')
  fs.writeFileSync(presetFile, JSON.stringify([{ id: 'preset:x', key }]))
  const h = await engine(t)
  const l = lines()
  const hp = helper({ rpc: h.rpc, dir: h.dir, preset: presetFile, log: l.log, tick: 1000 })
  t.teardown(() => hp.close())
  await hp.apply(config({ apps: 'official' }))
  t.ok(l.has(/^keeping Test site/), l.out.join(' | '))
  fs.writeFileSync(path.join(folder, 'index.html'), '<h1>v2</h1>')
  fs.writeFileSync(path.join(folder, 'big.bin'), 'y'.repeat(310 * 1024))
  const t0 = Date.now()
  await owner.rpc.request('site.publish', { folder })
  t.ok(await eventually(() => l.has(/^Test site: new version/), 30000, 250), 'logged within 30 s: ' + l.out.join(' | '))
  t.comment(`new version at the helper after ${Date.now() - t0} ms`)
  await sleep(1000)
  await owner.rpc.request('close') // the helper alone serves it
  const v = await engine(t)
  await v.rpc.request('site.open', { key, timeout: 30000 })
  const read = async (p) => text((await v.rpc.request('site.read', { key, path: p, timeout: 15000 })).bytes)
  t.is(await read(''), '<h1>v2</h1>', 'the new version, from the helper')
  t.is((await read('big.bin'))[0], 'y')
  t.is(await read('sub/page.html'), 'p1', 'a file nobody read, kept whole')
})

test('helper command: writes its config file, reads it again when it changes, stops on a signal', async (t) => {
  t.timeout(120000)
  const dir = tmpDir(t, 'h')
  const conf = path.join(tmpDir(t, 'conf'), 'helper.conf')
  const nodes = await bootstrap(t)
  const child = spawn(process.execPath, [CLI, 'helper', '--config', conf, '--dir', dir, '--bootstrap', nodes.map((n) => `${n.host}:${n.port}`).join(',')])
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const exited = new Promise((resolve) => child.on('exit', resolve))
  t.teardown(async () => { child.kill(); await within(exited, 10000) })
  t.ok(await eventually(() => /online; stop with/.test(out), 60000, 200), out)
  t.ok(/written with the defaults/.test(out))
  t.alike(parse(fs.readFileSync(conf, 'utf-8')).values, {}, 'every setting commented out')
  fs.writeFileSync(conf, 'name = Box two\nshare = 0.5\napps = none\nbogus = 1\n')
  t.ok(await eventually(() => /name: Box two/.test(out) && /unknown setting "bogus"/.test(out), 30000, 200), out)
  if (process.platform !== 'win32') { // Windows has no SIGTERM: kill() ends the process at once
    child.kill('SIGTERM')
    t.is(await within(exited, 15000), 0, 'stopped cleanly')
  }
})

test('the release seeder: its service reads the channel the installer writes, as the helper user', (t) => {
  const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
  const unit = fs.readFileSync(path.join(scripts, 'hyperbrowser-seed.service'), 'utf8')
  const install = fs.readFileSync(path.join(scripts, 'helper-install.sh'), 'utf8')
  t.ok(unit.includes('User=hyperbrowser'), 'runs as the helper user')
  t.ok(unit.includes('EnvironmentFile=/etc/default/hyperbrowser-seed'), 'reads the env file')
  t.ok(unit.includes('ExecStart=/usr/bin/env pear seed ${HB_RELEASE_LINK}'), 'seeds the channel as one argument')
  t.ok(install.includes('echo "HB_RELEASE_LINK=$LINK" > /etc/default/hyperbrowser-seed'), 'the installer writes that file')
  t.ok(install.includes('scripts/hyperbrowser-seed.service" /etc/systemd/system/hyperbrowser-seed.service'), 'and installs the service')
  const ok = /\^pear:\/\/\[a-z0-9\]\+\$/.test(install)
  t.ok(ok, 'only a pear:// link is accepted')
})
