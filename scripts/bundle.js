// The official apps inside HyperBrowser (spec 015): snapshots of their own signed P2P data (SwarmFS packs),
// made from the owner's engine folder by `npm run build -- --apps-from <dir>`, imported by the engine at start
// (engine/index.js unbundle). Not copies of their files: the same sites, same keys, updated by peers.
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { SwarmFS } from 'swarmfs'

// Packs each preset app with a key (shell/preset.json entries) held in the engine folder `from` into `out`:
// out/<key>/ per app, and out/bundle.json { id, apps: [{ id, key }] } (a new id per bundle: engines import
// it once). An app's instance (the forum's official one) packs its app: the instance is invite-only while
// testing, so not public: its posts come from peers, as before. The folder is opened offline: no process
// may have it open (stop `cli.js publish`), and edits in its linked folders since publishing are not packed.
export async function bundleApps (from, out, presets) {
  if (!fs.existsSync(path.join(from, 'cores'))) throw new Error('not an engine folder: ' + from)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const sfs = await SwarmFS.open(from, { offline: true })
  const apps = []
  try {
    for (const p of presets.filter((x) => x.key)) {
      let site = await sfs.site(p.key, { timeout: 0 }).catch(() => null)
      if (!site) throw new Error(`${p.id} (${p.key}) is not a site held in ${from}: run npm run apps:publish there first`)
      if (site.app) site = await sfs.site(site.app, { timeout: 0 }) // an instance: its app
      await sfs.exportSites([site.key], path.join(out, site.key))
      apps.push({ id: p.id, key: site.key })
    }
  } finally {
    await sfs.close()
  }
  fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ id: new Date().toISOString() + '-' + b4a.toString(crypto.randomBytes(4), 'hex'), apps }, null, 2))
  return apps
}
