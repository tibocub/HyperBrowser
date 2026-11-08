// The official apps (scripts/apps.js): `npm run apps:publish` publishes each from its folder and writes its key
// into preset.json; a rerun changes nothing. On a copy of preset.json and an engine of the tests.
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, tmpDir, siteApi, eventually, codeOf } from './helpers.js'
import { APPS, publishApps } from '../scripts/apps.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('apps:publish writes the apps\' keys into preset.json, a rerun changes nothing', async (t) => {
  const e = await engine(t)
  const preset = path.join(tmpDir(t, 'preset'), 'preset.json')
  const before = [{ id: 'preset:hb', key: 'k'.repeat(52), title: 'HyperBrowser', glyph: 'hb', kind: 'installed' }, { id: 'preset:forum', title: 'Forum', kind: 'installed' }, { id: 'preset:chat', title: 'Chat', glyph: 'site', kind: 'installed' }]
  fs.writeFileSync(preset, JSON.stringify(before))
  const apps = APPS.filter((a) => a.id === 'preset:forum' || a.id === 'preset:chat') // out/home is built by home:build
  const changed = await publishApps(e.rpc, { root: ROOT, preset, apps })
  t.alike(changed.map((c) => c.id).sort(), ['preset:chat', 'preset:forum'])
  const after = JSON.parse(fs.readFileSync(preset, 'utf-8'))
  t.alike(after[0], before[0], 'an app not published keeps its entry')
  t.alike(after[2], { ...before[2], key: changed.find((c) => c.id === 'preset:chat').key }, 'only the key is added')
  const app = (await e.rpc.request('site.publish', { folder: path.join(ROOT, 'sites', 'forum') })).key
  t.not(after[1].key, app, "the forum's key is its official instance's, not the app's")
  const text = fs.readFileSync(preset, 'utf-8')
  t.alike(await publishApps(e.rpc, { root: ROOT, preset, apps }), [], 'a rerun: same keys')
  t.is(fs.readFileSync(preset, 'utf-8'), text, 'the file untouched')
  const other = await engine(t) // another engine folder: other keys, kept out unless replace
  const kept = await publishApps(other.rpc, { root: ROOT, preset, apps })
  t.ok(kept.length === 2 && kept.every((c) => c.kept), 'a different key is reported, not written')
  t.is(fs.readFileSync(preset, 'utf-8'), text)
  await publishApps(other.rpc, { root: ROOT, preset, apps, replace: true })
  t.is(JSON.parse(fs.readFileSync(preset, 'utf-8'))[2].key, kept.find((c) => c.id === 'preset:chat').key, 'replace writes it')
})

test('the Apps store lists the apps, a visitor reads the list and can\'t add to it (spec 014)', async (t) => {
  const owner = await engine(t)
  const preset = path.join(tmpDir(t, 'preset'), 'preset.json')
  fs.writeFileSync(preset, JSON.stringify([{ id: 'preset:apps', title: 'Apps' }]))
  const apps = APPS.filter((a) => ['preset:forum', 'preset:apps', 'preset:chat'].includes(a.id))
  await publishApps(owner.rpc, { root: ROOT, preset, apps })
  const store = JSON.parse(fs.readFileSync(preset, 'utf-8'))[0].key
  const forum = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites', 'forum', 'site.json'), 'utf-8'))

  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: store })
  await visitor.rpc.request('site.consent', { key: store, allow: true })
  const hyper = siteApi(visitor, store)
  let items = []
  t.ok(await eventually(async () => (items = (await hyper.query('app').latest(10)).items).length === 2, 30000), 'two entries reach a visitor')
  const f = items.find((x) => x.title === forum.title)
  t.is(f.about, forum.description, "the app's site.json description")
  t.ok(f.icon.startsWith('data:image/svg+xml;base64,'), 'its icon, as a data URL')
  t.is(items.find((x) => x.title === 'Chat').order, APPS.findIndex((a) => a.id === 'preset:chat'))

  t.is(await codeOf(hyper.put('app', { key: 'k'.repeat(52), title: 'Mine', about: '', icon: '', order: 0 })), 'NOT_ALLOWED', 'a visitor adds no entry')
  t.is(await codeOf(hyper.edit(f.id, { title: 'Hijacked' })), 'NOT_ALLOWED', 'nor edits one')
  t.ok(await hyper.put('profile', { name: 'bob' }), 'while a visitor may write in this public site')

  // an entry that differs from the app's site.json (an older description): the rerun edits it, nothing else
  const said = []
  await siteApi(owner, store).edit(f.id, { about: 'an older line' })
  await publishApps(owner.rpc, { root: ROOT, preset, apps, log: (l) => said.push(l) })
  t.alike(said.filter((l) => l.startsWith('store:')), ['store: ' + forum.title + ' updated'])
  t.ok(await eventually(async () => (await hyper.query('app').latest(10)).items.find((x) => x.id === f.id)?.about === forum.description, 30000), 'the visitor sees it')
})
