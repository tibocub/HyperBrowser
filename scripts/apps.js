// HyperBrowser's official apps (`npm run apps:publish`): each published from its folder on the owner's engine,
// its key written in shell/preset.json, and listed in the Apps store (spec 014) with its site.json's title,
// `description` and icon. A folder keeps its key, so a rerun changes nothing.
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import { publish } from '../engine/publish.js'

// id: the preset entry (an id not in preset.json: listed in the store only); store: the Apps site itself.
// The forum's key is its official instance's (docs/forum.md). To add an app: a line here, a description in its
// site.json, then npm run apps:publish.
export const APPS = [
  { id: 'preset:hb', folder: 'out/home' },
  { id: 'preset:forum', folder: 'sites/forum', instance: 'HyperBrowser' },
  { id: 'preset:apps', folder: 'sites/apps', store: true },
  { id: 'preset:chat', folder: 'sites/chat' },
  { id: 'preset:contacts', folder: 'sites/contacts' }
]
const ICON_MAX = 16 * 1024
const MIME = { svg: 'image/svg+xml', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

// Publishes `apps` (folders relative to `root`) on `rpc` (an init'ed engine) and writes their keys into the
// preset file. A different key already there stays unless `replace` (another folder path, or another engine
// folder, makes new sites: installs point at the old key). → [{ id, key, was, kept }] (was: null for a new one).
export async function publishApps (rpc, { root, preset, apps = APPS, replace = false, log = () => {} }) {
  const keys = {}
  for (const app of apps) {
    const r = await publish(rpc, path.join(root, app.folder), { instance: app.instance || null })
    keys[app.id] = r.instance || r.key
    log(`${app.id}: ${keys[app.id]}${r.created || r.instanceCreated ? ' (created)' : ''}`)
  }
  const presets = JSON.parse(fs.readFileSync(preset, 'utf-8'))
  const changed = []
  const out = presets.map((p) => {
    if (!keys[p.id] || keys[p.id] === p.key) return p
    const kept = !!p.key && !replace
    changed.push({ id: p.id, key: keys[p.id], was: p.key || null, kept })
    if (kept) return p
    const { id, key, ...rest } = p
    return { id, key: keys[p.id], ...rest }
  })
  if (changed.some((c) => !c.kept)) fs.writeFileSync(preset, '[\n' + out.map(line).join(',\n') + '\n]\n')
  if (changed.some((c) => c.kept)) return changed // the wrong sites: list nothing in the store
  const store = apps.find((a) => a.store)
  if (store) {
    const entries = apps.filter((a) => !a.store).map((a) => entry(path.join(root, a.folder), keys[a.id], APPS.findIndex((x) => x.id === a.id)))
    for (const e of await list(rpc, keys[store.id], entries)) log(`store: ${e.title} ${e.how}`)
  }
  return changed
}

// one entry a line, as preset.json is written by hand: { "id": "…", "key": "…" }
const line = (p) => '  { ' + Object.entries(p).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + ' }'

// The store's entry for an app's folder: its site.json's title, description and icon (a data: URL, ≤ 16 KB).
function entry (folder, key, order) {
  const m = JSON.parse(fs.readFileSync(path.join(folder, 'site.json'), 'utf-8'))
  const type = MIME[String(m.icon).split('.').pop().toLowerCase()]
  const bytes = type && fs.readFileSync(path.join(folder, m.icon))
  const icon = bytes && bytes.byteLength <= ICON_MAX ? 'data:' + type + ';base64,' + b4a.toString(bytes, 'base64') : ''
  return { key, title: m.title, about: m.description || '', icon, order }
}

// Puts the entries missing from the store, edits the ones that differ (matched by key). → [{ title, how }]
async function list (rpc, store, entries) {
  // the owner's own engine: running the command is the owner saying yes
  await rpc.request('site.open', { key: store })
  await rpc.request('site.consent', { key: store, allow: true })
  const call = (method, args, chain) => rpc.request('site.call', { key: store, method, args, chain })
  const have = (await call('query', ['app'], [['latest', [1000]]])).items
  const done = []
  for (const e of entries) {
    const old = have.find((x) => x.key === e.key)
    if (!old) await call('put', ['app', e])
    else if (Object.keys(e).some((k) => old[k] !== e[k])) await call('edit', [old.id, e])
    else continue
    done.push({ title: e.title, how: old ? 'updated' : 'listed' })
  }
  return done
}
