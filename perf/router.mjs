// The I2P router's cost, on the live network: start to first tunnels ready (a fresh data folder, then a restart with
// the router records it saved), then its memory and CPU over `--idle` seconds. `--n` starts of each.
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
async function start (dir) {
  const t0 = Date.now()
  const router = new Router({ dataDir: dir, run: (entry, args) => new Sidecar(entry, args) })
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
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 })

const s = { fresh: stats(fresh), restart: stats(restart) }
console.log(JSON.stringify({ ...s, idle }))
record([
  ['router.start.fresh', 'ms', s.fresh, N],
  ['router.start.restart', 'ms', s.restart, N],
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
