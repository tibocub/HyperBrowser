// The I2P router: i2pd loaded as an addon in its own Bare process, one per app, started by shell/router.js.
// It outlives identity switches; engines reach it over SAM on 127.0.0.1. Says one JSON status line every few seconds.
/* global Bare */
import process from 'process'
import { pathToFileURL } from 'url'

const [dataDir, samPort, more] = Bare.argv.slice(2)
const PORT_TAKEN = 3 // exit code: the supervisor picks another port
const STATUS_MS =Number(process.env.HB_ROUTER_STATUS_MS) || 10000
const ADDON = process.env.HB_ROUTER_ADDON
  ? pathToFileURL(process.env.HB_ROUTER_ADDON).href
  : new URL('./prebuilds/' + Bare.platform + '-' + Bare.arch + '/i2pd.node', import.meta.url).href

/** @param {object} msg */
const say = (msg) => Bare.IPC.write(JSON.stringify(msg) + '\n')

/** @type {{ start (o: object): void, stop (): void, status (): { sam?: boolean } }} */
let i2pd
try {
  i2pd = (await import(ADDON)).default
  i2pd.start({ dataDir, samPort: Number(samPort), ...(more ? JSON.parse(more) : {}) })
} catch (err) {
  say({ error: 'the router could not start: ' + /** @type {Error} */ (err).message })
  Bare.exit(1)
}
if (i2pd.status().sam === false) {
  say({ error: 'SAM could not listen on port ' + samPort })
  i2pd.stop()
  Bare.exit(PORT_TAKEN)
}

function report () {
  const cpu = process.cpuUsage()
  say({ ...i2pd.status(), rssMB: Math.round(process.memoryUsage().rss / 1e6), cpuS: (cpu.user + cpu.system) / 1e6 })
}
const timer = setInterval(report, STATUS_MS)
report()

function end () {
  clearInterval(timer)
  i2pd.stop()
  Bare.exit(0) // i2pd's own threads may still be winding down; this process owns them
}
Bare.IPC.on('data', (d) => { if (String(d).includes('stop')) end() })
Bare.IPC.on('end', end)
