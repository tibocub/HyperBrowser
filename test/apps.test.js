// The official apps (scripts/apps.js): `npm run apps:publish` publishes each from its folder and writes its key
// into preset.json; a rerun changes nothing. On a copy of preset.json and an engine of the tests.
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, tmpDir } from './helpers.js'
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
