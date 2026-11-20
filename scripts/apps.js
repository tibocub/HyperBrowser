import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import { publish } from '../engine/publish.js'

// id: the preset entry (an id not in preset.json: listed in the store only); store: the Apps site itself.
// To add an app: a line here, a description in its site.json, then npm run apps:publish.
/** @type {App[]} */
export const APPS = [
  { id: 'preset:hb', folder: 'out/home' },
  { id: 'preset:forum', folder: 'sites/forum', instance: 'HyperBrowser' },
  { id: 'preset:apps', folder: 'sites/apps', store: true },
  { id: 'preset:chat', folder: 'sites/chat' },
  { id: 'preset:contacts', folder: 'sites/contacts' },
  { id: 'preset:ide', folder: 'sites/ide' }
]
/**
 * @typedef {{ id: string, folder: string, instance?: string, store?: true }} App
 * @typedef {{ id: string, key?: string, [more: string]: unknown }} Preset A line of shell/preset.json.
 * @typedef {{ id: string, key: string, was: string | null, kept: boolean }} Changed
 * @typedef {{ key: string, title: string, about: string, icon: string, order: number }} Entry The store's `app` record.
 */

const ICON_MAX = 16 * 1024
/** @type {Record<string, string | undefined>} */
const MIME = { svg: 'image/svg+xml', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

// Another folder path or engine folder makes new sites, so a different key already there stays unless `replace`.
/**
 * Publishes the official apps and writes their keys to preset.json; the store lists the others.
 * @param {import('../engine/protocol.js').Rpc} rpc
 * @param {object} opts
 * @param {string} opts.root the repo
 * @param {string} opts.preset preset.json's path
 * @param {App[]} [opts.apps]
 * @param {boolean} [opts.replace] write a key over a different one already there
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<Changed[]>}
 */
export async function publishApps (rpc, { root, preset, apps = APPS, replace = false, log = () => {} }) {
  /** @type {Record<string, string>} */
  const keys = {}
  for (const app of apps) {
    const r = await publish(rpc, path.join(root, app.folder), { instance: app.instance || null })
    keys[app.id] = r.instance || r.key
    log(`${app.id}: ${keys[app.id]}${r.created || r.instanceCreated ? ' (created)' : ''}`)
  }
  /** @type {Preset[]} */
  const presets = JSON.parse(fs.readFileSync(preset, 'utf-8'))
  /** @type {Changed[]} */
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
/** @param {Preset} p */
const line = (p) => '  { ' + Object.entries(p).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + ' }'

/** @param {string} folder @param {string} key @param {number} order @returns {Entry} */
function entry (folder, key, order) {
  const m = JSON.parse(fs.readFileSync(path.join(folder, 'site.json'), 'utf-8'))
  const type = MIME[/** @type {string} */ (String(m.icon).split('.').pop()).toLowerCase()]
  const bytes = type && fs.readFileSync(path.join(folder, m.icon))
  const icon = bytes && bytes.byteLength <= ICON_MAX ? 'data:' + type + ';base64,' + b4a.toString(bytes, 'base64') : ''
  return { key, title: m.title, about: m.description || '', icon, order }
}

/**
 * @param {import('../engine/protocol.js').Rpc} rpc
 * @param {string} store the store site's key
 * @param {Entry[]} entries
 */
async function list (rpc, store, entries) {
  // the owner's own engine: running the command is the owner saying yes
  await rpc.request('site.open', { key: store })
  await rpc.request('site.consent', { key: store, allow: true })
  /** @param {string} method @param {unknown[]} args @param {unknown[]} [chain] */
  const call = (method, args, chain) => rpc.request('site.call', { key: store, method, args, chain })
  /** @type {Array<Entry & { id: string }>} */
  const have = (await call('query', ['app'], [['latest', [1000]]])).items
  /** @type {Array<{ title: string, how: string }>} */
  const done = []
  for (const e of entries) {
    const old = have.find((x) => x.key === e.key)
    if (!old) await call('put', ['app', e])
    else if (Object.keys(e).some((k) => old[/** @type {keyof Entry} */ (k)] !== e[/** @type {keyof Entry} */ (k)])) await call('edit', [old.id, e])
    else continue
    done.push({ title: e.title, how: old ? 'updated' : 'listed' })
  }
  return done
}
