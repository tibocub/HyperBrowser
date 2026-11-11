// SC-005 (spec 016): with 50 watched places and nothing happening, the engine's memory grows by at most 200 MB and
// it adds no sustained CPU load. Ann makes 50 conversations of a test app (24 of them Chat's, so held; 26 in turns),
// Bob joins them all; Ann leaves; Bob says yes to notifications and is measured while nothing happens.
//   npm run perf [-- --minutes 3]    appends to perf/history.jsonl (hypergraph's shape: perf/history.jsonl there)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'
import createTestnet from 'hyperdht/testnet.js'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLACES = 50
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : Number(process.argv[i + 1]) }
const minutes = arg('--minutes', 3)
const CHILD = process.argv.includes('--measure') // Bob's engine alone, in a fresh process: its memory is its own
const tmp = CHILD ? process.argv[process.argv.indexOf('--measure') + 1] : fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'hb-perf-'))
const testnet = CHILD ? null : await createTestnet(3)
const bootstrap = CHILD ? JSON.parse(process.argv[process.argv.indexOf('--bootstrap') + 1]) : testnet.bootstrap
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const MB = (b) => Math.round(b / 1e5) / 10

async function engine (name) {
  const [a, b] = pair()
  start(a)
  const rpc = connect(b, { onEvent: () => {} })
  await rpc.request('init', { dir: path.join(tmp, name), bootstrap })
  return rpc
}

if (CHILD) await measure()

const site = path.join(tmp, 'site')
fs.mkdirSync(site)
fs.writeFileSync(path.join(site, 'index.html'), 'hi')
fs.writeFileSync(path.join(site, 'site.json'), JSON.stringify({
  title: 'Chat', permissions: ['space', 'notifications'], types: { message: { fields: { text: 'text' } } }, notifications: [{ type: 'message', text: 'text' }]
}))
const ann = await engine('ann')
const { key } = await ann.request('site.publish', { folder: site })
const call = (e, method, args, instance) => e.request('site.call', { key, method, args, instance })
const open = async (e) => { await e.request('site.open', { key }); await e.request('site.consent', { key, allow: true }) }
await open(ann)
const bob = await engine('bob')
await open(bob)
await bob.request('apps.set', { chat: key })
const started = Date.now()
for (let i = 0; i < PLACES; i++) {
  const g = await call(ann, 'instances.create', ['G' + i])
  await call(ann, 'put', ['message', { text: 'history' }], g.key)
  await call(bob, 'instances.join', [await call(ann, 'createInvite', [{ role: 'member' }], g.key)])
}
console.log(`${PLACES} places joined in ${Math.round((Date.now() - started) / 1000)} s`)
await bob.request('site.keep', { key, keep: true, timeout: 30000 }) // installed: still here when Bob starts again alone
await ann.request('close')
await bob.request('close')
fs.writeFileSync(path.join(tmp, 'key'), key)
const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--measure', tmp, '--bootstrap', JSON.stringify(bootstrap), '--minutes', String(minutes)], { stdio: 'inherit' })
const code = await new Promise((resolve) => child.on('exit', resolve))
await testnet.destroy()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(code)

async function measure () {
const key = fs.readFileSync(path.join(tmp, 'key'), 'utf-8')
const bob = await engine('bob')
await bob.request('apps.set', { chat: key })
await wait(10000)
globalThis.gc?.()
const before = process.memoryUsage().rss
console.log(`Bob's engine alone: ${MB(before)} MB before watching`)
await bob.request('site.open', { key })
await bob.request('site.permit', { key, permission: 'notifications', allow: true })
await bob.request('site.close', { key })
console.log(`watching; measuring for ${minutes} min`)
const end = Date.now() + minutes * 60000
let cpu = process.cpuUsage()
let at = Date.now()
const rss = []
const load = []
while (Date.now() < end) {
  await wait(10000)
  const c = process.cpuUsage(cpu)
  load.push(((c.user + c.system) / 1000) / (Date.now() - at) * 100) // % of one core
  cpu = process.cpuUsage()
  at = Date.now()
  rss.push(process.memoryUsage().rss - before)
}
const s = await bob.request('notify.state')
await bob.request('close')

const half = load.slice(load.length >> 1) // the second half: after the first turns settle
const median = (l) => l.slice().sort((a, b) => a - b)[l.length >> 1]
const growth = rss.map(MB)
const result = {
  memory: { median: median(growth), min: Math.min(...growth), max: Math.max(...growth) },
  cpu: { median: Math.round(median(half) * 10) / 10, min: Math.round(Math.min(...half) * 10) / 10, max: Math.round(Math.max(...half) * 10) / 10 }
}
console.log(`memory growth: max ${result.memory.max} MB (SC-005: at most 200); CPU, second half: median ${result.cpu.median} % of a core, max ${result.cpu.max} %; ${s.items.length} notifications (0 expected)`)

const git = (c) => { try { return execSync('git ' + c, { cwd: HERE }).toString().trim() } catch { return null } }
const now = new Date().toISOString()
const common = {
  date: now, run: now, sha: git('rev-parse HEAD'), dirty: !!git('status --porcelain'), runtime: 'node', version: process.version,
  machine: { cores: os.cpus().length, cpu: os.cpus()[0].model, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${process.platform} ${os.release()}` }
}
const line = (scenario, unit, r, n) => JSON.stringify({ ...common, scenario, size: PLACES, unit, better: 'lower', median: r.median, spread: Math.round((r.max - r.min) * 10) / 10, n, min: r.min, max: r.max })
fs.appendFileSync(path.join(HERE, 'history.jsonl'), line('notifications.idle.memory', 'MB', result.memory, rss.length) + '\n' + line('notifications.idle.cpu', '% core', result.cpu, half.length) + '\n')
process.exit(result.memory.max <= 200 && s.items.length === 0 ? 0 : 1)
}
