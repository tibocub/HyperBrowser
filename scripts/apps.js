// HyperBrowser's official apps (`npm run apps:publish`): each published from its folder on the owner's engine,
// its key written in shell/preset.json. A folder keeps its key, so a rerun changes nothing in preset.json.
import fs from 'fs'
import path from 'path'
import { publish } from '../engine/publish.js'

// id: the preset entry; the forum's preset key is its official instance's (docs/forum.md)
export const APPS = [
  { id: 'preset:hb', folder: 'out/home' },
  { id: 'preset:forum', folder: 'sites/forum', instance: 'HyperBrowser' },
  { id: 'preset:chat', folder: 'sites/chat' },
  { id: 'preset:contacts', folder: 'sites/contacts' }
]

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
  const list = JSON.parse(fs.readFileSync(preset, 'utf-8'))
  const changed = []
  const out = list.map((p) => {
    if (!keys[p.id] || keys[p.id] === p.key) return p
    const kept = !!p.key && !replace
    changed.push({ id: p.id, key: keys[p.id], was: p.key || null, kept })
    if (kept) return p
    const { id, key, ...rest } = p
    return { id, key: keys[p.id], ...rest }
  })
  if (changed.some((c) => !c.kept)) fs.writeFileSync(preset, '[\n' + out.map(line).join(',\n') + '\n]\n')
  return changed
}

// one entry a line, as preset.json is written by hand: { "id": "…", "key": "…" }
const line = (p) => '  { ' + Object.entries(p).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + ' }'
