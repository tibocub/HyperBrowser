// The router against the live I2P network, through the shell's supervisor (shell/router.js):
//   node router/soak.mjs switches <dataDir> [count=20]      identity switches: one SAM session opened and closed per
//                                                           switch against one router process; tunnels-ready times
//   node router/soak.mjs soak <dataDir> <log.jsonl> [min=10] runs until stopped: a switch every few minutes, the
//                                                           router's status every minute, appended to the log
// Relaying is on with the default cap (bandwidth O, share 50). Needs router/prebuilds/<os>-<arch>/i2pd.node.
import fs from 'fs'
import { createRequire } from 'module'
import { Router } from '../shell/router.js'

const require = createRequire(import.meta.url)
const Sidecar = require('bare-sidecar')
const sam = require('./sam.cjs')
const HOPS = 'inbound.length=3 outbound.length=3'
const [mode, dataDir, a, b] = process.argv.slice(2)

const router = new Router({ dataDir, run: (entry, args) => new Sidecar(entry, args), options: { bandwidth: 'O', share: 50 } })
await router.start()
await new Promise((resolve) => router.on('state', (s) => s === 'up' && resolve(null)))

/** One identity switch: a fresh destination with 3-hop tunnels, closed once ready. */
async function sw () {
  for (let i = 0; ; i++) {
    try {
      const s = await sam.session('STREAM', { sam: { port: router.port }, options: HOPS })
      s.close()
      return s.readyMs
    } catch (err) {
      if (i >= 5) throw err
      await new Promise((resolve) => setTimeout(resolve, 2000)) // SAM not up yet after a restart
    }
  }
}

if (mode === 'switches') {
  const pid = /** @type {any} */ (router.child)._process.pid
  /** @type {number[]} */
  const times = []
  const first = await sw() // the router's own first tunnels, not a switch
  for (let i = 1; i <= Number(a || 20); i++) {
    times.push(await sw())
    console.log(JSON.stringify({ switch: i, readyMs: times.at(-1), transit: router.status?.transit, rssMB: router.status?.rssMB }))
  }
  times.sort((x, y) => x - y)
  const samePid = /** @type {any} */ (router.child)._process.pid === pid
  console.log(JSON.stringify({ firstMs: first, medianMs: times[times.length >> 1], maxMs: times.at(-1), restarts: router.restarts, samePid }))
  await router.stop()
} else if (mode === 'soak') {
  const log = (/** @type {object} */ o) => fs.appendFileSync(a, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n')
  router.on('state', (state, reason) => log({ state, reason, restarts: router.restarts }))
  setInterval(() => log({ state: router.state, restarts: router.restarts, ...router.status }), 60000)
  const every = Number(b || 10) * 60000
  const loop = async () => {
    try { log({ switchMs: await sw() }) } catch (err) { log({ switchError: /** @type {Error} */ (err).message }) }
    setTimeout(loop, every)
  }
  loop()
  log({ started: true, port: router.port })
} else {
  console.error('mode: switches | soak')
  await router.stop()
}
