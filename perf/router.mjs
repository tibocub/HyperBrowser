// The I2P router's cost, on the live network: start to first tunnels ready (a fresh data folder, then a restart with
// the router records it saved), then its memory and CPU over `--idle` seconds. `--n` starts of each.
// `--peers <netDb folder>` (another router's, e.g. the soak's): also fresh routers started from its newest 100
// records, the official reseed kept on beside them, as a fresh install does from its peers (SC-005).
// Needs router/prebuilds/<os>-<arch>/i2pd.node. Joins I2P and relays while it runs.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { Router } from '../shell/router.js'

const require = createRequire(import.meta.url)
const Sidecar = require('bare-sidecar')
const sam = require('../router/sam.cjs')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : Number(process.argv[i + 1]) }
const N = arg('--n', 3)
const IDLE = arg('--idle', 60)
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'hb-perf-router-'))
const PERSIST_MS = 70000 // i2pd saves the router records it learned about once a minute

/** Starts a router on `dir`, returns ms to the first 3-hop session's tunnels, and the router (still running). */
async function start (dir, options = {}) {
  const t0 = Date.now()
  const router = new Router({ dataDir: dir, run: (entry, args) => new Sidecar(entry, args), options })
  await router.start()
  for (;;) {
    try {
      const s = await sam.session('STREAM', { sam: { port: router.port }, options: 'inbound.length=3 outbound.length=3' })
      s.close()
      return { ms: Date.now() - t0, router }
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
  }
}

const fresh = []
const restart = []
let idle = null
for (let i = 0; i < N; i++) {
  const dir = path.join(tmp, 'r' + i)
  const a = await start(dir)
  fresh.push(a.ms)
  await new Promise((resolve) => setTimeout(resolve, PERSIST_MS))
  if (i === 0) {
    const before = a.router.status
    await new Promise((resolve) => setTimeout(resolve, IDLE * 1000))
    const after = a.router.status
    idle = { rssMB: after?.rssMB, cpuS: Math.round(((after?.cpuS || 0) - (before?.cpuS || 0)) * 100) / 100 }
  }
  await a.router.stop()
  const b = await start(dir)
  restart.push(b.ms)
  await b.router.stop()
  console.log(JSON.stringify({ run: i + 1, freshMs: a.ms, restartMs: b.ms }))
}
const PEERS = process.argv.includes('--peers') ? process.argv[process.argv.indexOf('--peers') + 1] : null
const peers = []
if (PEERS) {
  const records = fs.readdirSync(PEERS).filter((d) => /^r.$/.test(d)).flatMap((d) => fs.readdirSync(path.join(PEERS, d)).map((n) => path.join(PEERS, d, n)))
    .map((f) => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 100)
  for (let i = 0; i < N; i++) {
    const dir = path.join(tmp, 'p' + i)
    for (const { f } of records) {
      const to = path.join(dir, 'netDb', path.basename(path.dirname(f)))
      fs.mkdirSync(to, { recursive: true })
      fs.copyFileSync(f, path.join(to, path.basename(f)))
    }
    const c = await start(dir, { reseedThreshold: records.length + 25 })
    peers.push(c.ms)
    await c.router.stop()
    console.log(JSON.stringify({ run: i + 1, peersMs: c.ms, records: records.length }))
  }
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })

const s = { fresh: stats(fresh), restart: stats(restart), ...(peers.length ? { peers: stats(peers) } : {}) }
console.log(JSON.stringify({ ...s, idle }))
record([
  ['router.start.fresh', 'ms', s.fresh, N],
  ['router.start.restart', 'ms', s.restart, N],
  ...(s.peers ? [['router.start.peers', 'ms', s.peers, N]] : []),
  ['router.idle.rss', 'MB', one(idle?.rssMB || 0), 1],
  ['router.idle.cpu', 's/' + IDLE + 's', one(idle?.cpuS || 0), 1]
])

function one (v) { return { median: v, min: v, max: v } }
function stats (l) { const s = l.slice().sort((a, b) => a - b); return { median: s[s.length >> 1], min: s[0], max: s.at(-1) } }

function record (rows) {
  const git = (c) => { try { return execSync('git ' + c, { cwd: HERE }).toString().trim() } catch { return null } }
  const now = new Date().toISOString()
  const common = {
    date: now, run: now, sha: git('rev-parse HEAD'), dirty: !!git('status --porcelain'), runtime: 'node', version: process.version,
    machine: { cores: os.cpus().length, cpu: os.cpus()[0].model, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${process.platform} ${os.release()}` }
  }
  const line = ([scenario, unit, r, n]) => JSON.stringify({ ...common, scenario, unit, better: 'lower', median: r.median, spread: r.max - r.min, n, min: r.min, max: r.max })
  fs.appendFileSync(path.join(HERE, 'history.jsonl'), rows.map(line).join('\n') + '\n')
}
