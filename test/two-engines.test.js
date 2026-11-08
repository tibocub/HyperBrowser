// Two engines, two processes: the command line publishes a folder, this process opens the printed key alone
// (spec 001 US1, US2, FR-009; SC-001). The child runs on the runtime running this test (Node or Bare).
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { engine, siteFolder, tmpDir, bootstrap, eventually, within, text } from './helpers.js'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'cli.js')

// The child and what it printed so far; killed (and waited for) at teardown, before the folders go.
function cli (t, args) {
  const child = spawn(process.execPath, [CLI, ...args])
  const out = { text: '', code: null }
  child.stdout.on('data', (d) => { out.text += d })
  child.stderr.on('data', (d) => { out.text += d })
  const exited = new Promise((resolve) => child.on('exit', (code) => { out.code = code; resolve(code) }))
  t.teardown(async () => {
    if (out.code === null) child.kill()
    await within(exited, 10000)
  })
  return { out, exited }
}

const boot = (nodes) => nodes.map((n) => `${n.host}:${n.port}`).join(',')

test('publish from the command line; another engine opens the key alone', async (t) => {
  const folder = siteFolder(t, { manifest: { title: 'From the CLI' }, files: { 'index.html': '<p>published</p>' } })
  const net = boot(await bootstrap(t))
  const publisher = cli(t, ['publish', folder, '--dir', tmpDir(t, 'owner'), '--bootstrap', net])
  const key = await eventually(() => /key: ([a-z0-9]{52})/.exec(publisher.out.text)?.[1], 60000, 100)
  t.ok(key, 'the key is printed: ' + publisher.out.text.trim())
  t.ok(publisher.out.text.includes('created'), 'the first time')
  t.is(publisher.out.code, null, 'and it stays online')

  const started = Date.now()
  const visitor = await engine(t)
  const opened = await visitor.rpc.request('site.open', { key })
  t.is(opened.manifest.title, 'From the CLI')
  t.is(text((await visitor.rpc.request('site.read', { key, path: '' })).bytes), '<p>published</p>')
  t.comment(`opened and read in ${Date.now() - started} ms`)
  t.ok(Date.now() - started < 15000, 'SC-001: within 15 s')

  const reader = cli(t, ['open', key, '--once', '--dir', tmpDir(t, 'reader'), '--bootstrap', net])
  t.is(await within(reader.exited, 60000, 'timeout'), 0, reader.out.text.trim())
  t.ok(reader.out.text.includes('title: From the CLI'))
  t.ok(reader.out.text.includes('entry bytes: ' + fs.statSync(path.join(folder, 'index.html')).size))
})

test('the command line refuses a bad folder and says why', async (t) => {
  const folder = siteFolder(t, { manifest: null })
  const r = cli(t, ['publish', folder, '--dir', tmpDir(t, 'owner'), '--bootstrap', boot(await bootstrap(t))])
  t.is(await within(r.exited, 60000, 'timeout'), 1)
  t.ok(r.out.text.includes('NO_MANIFEST'), r.out.text.trim())
  const usage = cli(t, [])
  t.is(await within(usage.exited, 10000, 'timeout'), 1)
  t.ok(usage.out.text.includes('publish <folder>'))
})

test('publish --invite: an invite-only site and a one-use link into it (spec 006)', async (t) => {
  const folder = siteFolder(t, { manifest: { title: 'Closed', permissions: ['space'], public: false }, files: { 'index.html': '<p>members</p>' } })
  const publisher = cli(t, ['publish', folder, '--dir', tmpDir(t, 'owner'), '--bootstrap', boot(await bootstrap(t)), '--invite', 'admin'])
  const link = await eventually(() => /invite \(admin, one use\): (hg:\S+)/.exec(publisher.out.text)?.[1], 60000, 100)
  t.ok(link, 'an invite is printed: ' + publisher.out.text.trim())
  const key = /key: ([a-z0-9]{52})/.exec(publisher.out.text)[1]
  const admin = await engine(t)
  t.is((await admin.rpc.request('site.open', { key: link })).key, key)
  t.is(text((await admin.rpc.request('site.read', { key, path: '' })).bytes), '<p>members</p>')
  await admin.rpc.request('site.consent', { key, allow: true })
  const me = await admin.rpc.request('site.call', { key, method: 'info' })
  t.ok(await eventually(async () => (await admin.rpc.request('site.call', { key, method: 'getRole', args: [me.identity] })) === 'admin', 15000), 'in as admin')
  const usage = cli(t, ['publish', folder, '--invite', 'king'])
  t.is(await within(usage.exited, 10000, 'timeout'), 1, 'a role other than member or admin: usage')
})

test('publish --instance: the app\'s instance, made once; its invite opens the app on it; official names it', async (t) => {
  t.timeout(180000)
  const folder = siteFolder(t, { manifest: { title: 'App', permissions: ['space'], types: { official: { fields: { instance: 'string' }, put: { permission: 'decide' } } } } })
  const net = boot(await bootstrap(t))
  const dir = tmpDir(t, 'owner')
  const first = cli(t, ['publish', folder, '--dir', dir, '--bootstrap', net, '--instance', 'HyperBrowser', '--invite', 'admin', '--once'])
  t.is(await within(first.exited, 60000, 'timeout'), 0, first.out.text.trim())
  const key = /key: ([a-z0-9]{52})/.exec(first.out.text)?.[1]
  const instance = /instance: ([a-z0-9]{52}) \(created\)/.exec(first.out.text)?.[1]
  const link = /invite \(admin, one use, to the instance\): (hg:\S+)/.exec(first.out.text)?.[1]
  t.ok(key && instance && link, first.out.text.trim())

  const again = cli(t, ['publish', folder, '--dir', dir, '--bootstrap', net, '--instance', 'HyperBrowser', '--invite', 'admin'])
  t.ok(await eventually(() => new RegExp(`instance: ${instance}\\r?\\n`).test(again.out.text), 60000, 100), 'the same instance the second time: ' + again.out.text.trim()) // Bare prints \r\n on Windows
  await eventually(() => again.out.text.includes('online'), 60000, 100)

  const tibo = await engine(t)
  const o = await tibo.rpc.request('site.open', { key: link })
  t.alike([o.key, o.instance], [key, instance], 'the invite opens the app on the instance')
  await tibo.rpc.request('site.consent', { key, allow: true })
  t.ok(await eventually(async () => (await tibo.rpc.request('site.call', { key, method: 'query', args: ['official'], chain: [['latest', [1]]] })).items[0]?.instance === instance, 20000), 'the app names its official instance')
  t.is(await tibo.rpc.request('site.call', { key, instance, method: 'getRole', args: [(await tibo.rpc.request('site.call', { key, method: 'info' })).identity] }), 'admin', 'an admin of the instance')
})
