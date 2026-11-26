// The I2P router process: one per app, started with it, kept across identity switches, restarted with backoff.
// Engines get its SAM port; while it is down, anonymous identities wait and regular ones keep the normal network.
import { EventEmitter } from 'events'
import net from 'net'
import { fileURLToPath } from 'url'

const ENTRY = fileURLToPath(new URL('../router/process.js', import.meta.url))
const FIRST_BACKOFF = 1000
const STEADY_MS = 60000 // a run this long resets the backoff
const PORT_TAKEN = 3 // router/process.js's exit code when SAM can't listen on its port

/**
 * @typedef {{ running: boolean, status?: string, routers?: number, floodfills?: number, transit?: number, transitBytes?: number }} RouterStatus
 * @typedef {'starting' | 'up' | 'down' | 'stopped'} RouterState
 * @typedef {import('stream').Duplex & { stderr?: NodeJS.ReadableStream | null, kill (): void }} RouterChild
 * @typedef {(entry: string, args: string[]) => RouterChild} Run
 */

export class Router extends EventEmitter {
  /**
   * @param {{ dataDir: string, run: Run, entry?: string, options?: { bandwidth?: string, share?: number, notransit?: boolean, ipv6?: boolean, upnp?: boolean, reseedThreshold?: number }, maxBackoff?: number }} opts
   */
  constructor ({ dataDir, run, entry = ENTRY, options = {}, maxBackoff = 60000 }) {
    super()
    this.dataDir = dataDir
    this.run = run
    this.entry = entry
    this.options = options
    this.maxBackoff = maxBackoff
    /** @type {number} */
    this.port = 0
    /** @type {RouterState} */
    this.state = 'stopped'
    /** @type {string | null} why it is down */
    this.reason = null
    /** @type {RouterStatus | null} */
    this.status = null
    this.restarts = 0
    this.backoff = FIRST_BACKOFF
    /** @type {RouterChild | null} */
    this.child = null
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.timer = null
  }

  /** Picks its SAM port without starting (engines get it before the router runs). */
  async pickPort () {
    if (!this.port) this.port = await freePort()
  }

  async start () {
    if (this.state !== 'stopped') return
    this.#set('starting', null)
    await this.#launch()
  }

  // The port is kept across restarts, so engines keep theirs, unless SAM couldn't listen on it: then a new one, said
  // with a 'port' event.
  async #launch () {
    if (!this.port) {
      this.port = await freePort()
      this.emit('port', this.port)
    }
    if (this.state === 'stopped') return // stop() came while picking
    this.#spawn()
  }

  #spawn () {
    this.#set('starting', null)
    const started = Date.now()
    const child = this.run(this.entry, [this.dataDir, String(this.port), JSON.stringify(this.options)])
    this.child = child
    let rest = ''
    child.on('data', (d) => {
      const lines = (rest + d).split('\n')
      rest = /** @type {string} */ (lines.pop())
      for (const line of lines) {
        /** @type {RouterStatus & { error?: string }} */
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.error) { this.reason = msg.error; continue }
        this.status = msg
        this.emit('status', msg)
        if (msg.running && this.state !== 'up') this.#set('up', null)
      }
    })
    child.stderr?.on('data', () => {}) // drained; i2pd logs to its own file
    child.on('error', () => {})
    child.on('exit', (/** @type {number} */ code) => { if (code === PORT_TAKEN) this.port = 0 })
    child.on('close', () => {
      if (this.child !== child) return
      this.child = null
      if (this.state === 'stopped') return
      this.backoff = Date.now() - started > STEADY_MS ? FIRST_BACKOFF : Math.min(this.backoff * 2, this.maxBackoff)
      this.restarts++
      this.#set('down', this.reason || 'the router stopped')
      this.timer = setTimeout(() => { this.timer = null; this.#launch().catch((err) => this.#set('down', err.message)) }, this.backoff)
    })
  }

  /** @param {RouterState} state @param {string | null} reason */
  #set (state, reason) {
    this.state = state
    this.reason = reason
    this.emit('state', state, reason)
  }

  async stop () {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const child = this.child
    this.#set('stopped', null)
    if (!child) return
    this.child = null
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.write('stop\n')
    const killer = setTimeout(() => child.kill(), 15000) // i2pd's own stop waits on its threads
    await closed
    clearTimeout(killer)
  }
}

/** @returns {Promise<number>} */
function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('net').AddressInfo} */ (s.address())
      s.close(() => resolve(port))
    })
  })
}
