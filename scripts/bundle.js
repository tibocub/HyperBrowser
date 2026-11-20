// Not copies of the apps' files: their own signed data, the same sites and keys, updated by peers.
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { SwarmFS } from 'swarmfs'

// The folder is opened offline: no process may have it open (stop `cli.js publish`).
// An instance (the official forum) packs its app: the instance is invite-only, so its posts come from peers.
/**
 * @param {string} from the owner's engine folder
 * @param {string} out
 * @param {import('./apps.js').Preset[]} presets
 */
export async function bundleApps (from, out, presets) {
  if (!fs.existsSync(path.join(from, 'cores'))) throw new Error('not an engine folder: ' + from)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const sfs = await SwarmFS.open(from, { offline: true })
  /** @type {Array<{ id: string, key: string }>} */
  const apps = []
  try {
    for (const p of presets.filter((x) => x.key)) {
      let site = await sfs.site(/** @type {string} */ (p.key), { timeout: 0 }).catch(() => null)
      if (!site) throw new Error(`${p.id} (${p.key}) is not a site held in ${from}: run npm run apps:publish there first`)
      if (site.app) site = await sfs.site(site.app, { timeout: 0 })
      await sfs.exportSites([site.key], path.join(out, site.key))
      apps.push({ id: p.id, key: site.key })
    }
  } finally {
    await sfs.close()
  }
  fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ id: new Date().toISOString() + '-' + b4a.toString(crypto.randomBytes(4), 'hex'), apps }, null, 2))
  return apps
}
