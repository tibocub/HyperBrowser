// Bare entry for P2P updates (spec 011), started by main.js in an installed HyperBrowser only: pear-runtime's
// updater follows the release channel (package.json "upgrade") and downloads a higher version for this OS.
// Linux, macOS: swapped in for the installed file right away (pear-runtime's applyUpdate). Windows: the
// installed thing is a folder (HyperBrowser\, its .exe and files), which can't be renamed while it runs, so
// the new folder is downloaded beside it (<folder>.update\) and main.js swaps them once HyperBrowser quits.
// Its corestore (client only) in <data folder>/pear-runtime, apart from the engine's.
// Tells main.js one line at a time: 'updating', 'ready <version> [<new folder, Windows>]', 'error <message>'.
//   argv: <data folder> <version> <channel> <name in the release> <installed file or folder> [bootstrap] [delay]
//   (bootstrap host:port,... and delay, the most ms to wait after a release while running: for tests)
/* global Bare */
import PearRuntime from 'pear-runtime'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import path from 'path'

const [data, version, upgrade, name, app, bootstrap, delay] = Bare.argv.slice(2)
const WINDOWS = Bare.platform === 'win32'
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
    say('error installing the update: ' + err.message)
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
