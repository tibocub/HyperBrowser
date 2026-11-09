// Bundled apps (spec 015): snapshots of the apps' own data packed from an owner's engine folder; a fresh
// engine with nobody online opens every page; the next start doesn't import again; an edit published after
// the build reaches it from a peer. A changed snapshot is refused (the start goes on).
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, tmpDir, eventually, within } from './helpers.js'
import { publish } from '../engine/publish.js'
import { bundleApps } from '../scripts/bundle.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = (dir, at = '') => fs.readdirSync(path.join(dir, at), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? files(dir, at + e.name + '/') : [at + e.name])

// An owner's engine folder with Contacts (a copy, edited later) and the forum app with its instance.
async function owner (t) {
  const contacts = path.join(tmpDir(t, 'contacts-src'), 'contacts')
  fs.cpSync(path.join(ROOT, 'sites', 'contacts'), contacts, { recursive: true })
  const e = await engine(t)
  const c = await publish(e.rpc, contacts)
  const f = await publish(e.rpc, path.join(ROOT, 'sites', 'forum'), { instance: 'Test forum' })
  await within(e.rpc.request('close'), 15000)
  await e.engine.closed
  return { dir: e.dir, contacts, presets: [{ id: 'preset:contacts', key: c.key }, { id: 'preset:forum', key: f.instance }], keys: { contacts: c.key, forum: f.key } }
}

async function readAll (e, key, folder) {
  await e.rpc.request('site.open', { key, timeout: 5000 })
  for (const p of files(folder)) {
    const { bytes } = await e.rpc.request('site.read', { key, path: p, timeout: 5000 })
    if (Buffer.compare(Buffer.from(bytes), fs.readFileSync(path.join(folder, p))) !== 0) return p
  }
  return null
}

test('a fresh engine opens every bundled page with nobody online; the next start imports nothing', { timeout: 180000 }, async (t) => {
  const o = await owner(t)
  const out = tmpDir(t, 'bundle')
  const apps = await bundleApps(o.dir, out, o.presets)
  t.alike(apps.map((a) => a.key), [o.keys.contacts, o.keys.forum], "Contacts, and the forum's app for its instance")

  const dir = tmpDir(t, 'fresh')
  const e = await engine(t, { dir, bundle: out })
  t.is(await readAll(e, o.keys.contacts, o.contacts), null, 'every page of Contacts, offline')
  t.is(await readAll(e, o.keys.forum, path.join(ROOT, 'sites', 'forum')), null, 'every page of the forum app (fonts too: not inline)')
  t.ok((await e.rpc.request('site.keep', { key: o.keys.contacts, keep: true, timeout: 5000 })).kept, 'installed with no peer')
  await within(e.rpc.request('close'), 15000)
  await e.engine.closed
  const marker = path.join(dir, 'bundled.json')
  const at = fs.statSync(marker).mtimeMs

  const again = await engine(t, { dir, bundle: out })
  t.is(fs.statSync(marker).mtimeMs, at, 'not imported again')
  t.is(await readAll(again, o.keys.contacts, o.contacts), null, 'still there')

  fs.writeFileSync(path.join(o.contacts, 'index.html'), '<h1>Contacts 2</h1>') // published after the build
  await engine(t, { dir: o.dir }) // the owner online: its linked folder's edit published
  t.ok(await eventually(async () => {
    const r = await again.rpc.request('site.read', { key: o.keys.contacts, path: 'index.html', timeout: 2000 }).catch(() => null)
    return r && Buffer.from(r.bytes).toString() === '<h1>Contacts 2</h1>'
  }, 60000, 500), 'the edit reaches the bundled install from a peer')
})

test('a changed snapshot is refused and the engine starts anyway', { timeout: 180000 }, async (t) => {
  const o = await owner(t)
  const out = tmpDir(t, 'bundle')
  await bundleApps(o.dir, out, o.presets.slice(0, 1))
  const pack = path.join(out, o.keys.contacts, 'spaces', 'spaces.json')
  const meta = JSON.parse(fs.readFileSync(pack, 'utf-8'))
  meta.spaces[0].cores[0].length += 3
  fs.writeFileSync(pack, JSON.stringify(meta))
  const dir = tmpDir(t, 'fresh')
  const e = await engine(t, { dir, bundle: out })
  t.ok(await e.rpc.request('ping'), 'started')
  t.absent(fs.existsSync(path.join(dir, 'bundled.json')), 'not marked done: tried again next start')
  t.is((await e.rpc.request('hosting')).sites, 0, 'nothing of it kept')
})
