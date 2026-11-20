// Windows: the install is a folder that can't be renamed while it runs, so the new one downloads beside it
// (<folder>.update\) and main.js swaps them once HyperBrowser quits. Linux, macOS: swapped right away.
/* global Bare */
import PearRuntime from 'pear-runtime'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import path from 'path'

const [data, version, upgrade, name, app, bootstrap, delay] = Bare.argv.slice(2)
const WINDOWS = Bare.platform === 'win32'
/** @param {string} line */
const say = (line) => Bare.IPC.write(line + '\n')
const store = new Corestore(path.join(data, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm({ bootstrap: bootstrap ? bootstrap.split(',').map((b) => { const [host, port] = b.split(':'); return { host, port: Number(port) } }) : undefined })
// Windows: `dir` only holds the download (pear-runtime/next), on the install folder's drive so it can be moved
const pear = new PearRuntime({ dir: WINDOWS ? app + '.update' : data, version, upgrade, name, app, store, swarm, delay: delay ? Number(delay) : undefined })
pear.on('error', (err) => say('error ' + err.message))
pear.updater.on('error', (err) => say('error ' + err.message))
let scheduled = false // said once a release: it fires on every append, and a release is many
pear.updater.on('update-scheduled', (ms) => { if (!scheduled) say('scheduled in ' + Math.round(ms / 1000) + ' s'); scheduled = true })
pear.updater.on('updating', () => { scheduled = false; say('updating') })
pear.updater.on('updated', async () => {
  const next = pear.updater.nextVersion
  if (WINDOWS) return say('ready ' + next + ' ' + path.join(pear.updater.next, 'by-arch', Bare.platform + '-' + Bare.arch, 'app', name))
  try {
    await pear.updater.applyUpdate()
    say('ready ' + next)
  } catch (err) {
    say('error installing the update: ' + /** @type {Error} */ (err).message)
  }
})

swarm.on('connection', (c) => store.replicate(c))
pear.ready().then(() => swarm.join(pear.updater.drive.core.discoveryKey, { client: true, server: false }), (err) => say('error ' + err.message))

Bare.IPC.on('end', async () => {
  await swarm.destroy().catch(() => {})
  await pear.close().catch(() => {})
  await store.close().catch(() => {})
  Bare.exit(0)
})
