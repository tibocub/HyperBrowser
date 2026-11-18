// Spec 024: what projects cost. Two devices of one person on a local DHT: `--files` small files (1 KB) written into a
// project on the PC, the time until all are on the laptop; then Publish: the first (the site made, every file copied),
// and a next one with one file changed, each until a visitor reads it.
//   npm run perf:projects [-- --files 1000]   (appends to perf/history.jsonl)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import createTestnet from 'hyperdht/testnet.js'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : Number(process.argv[i + 1]) }
const FILES = arg('--files', 1000)
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'hb-perf-'))
const testnet = await createTestnet(3)
const { bootstrap } = testnet
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (fn, ms = 600000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await fn()) return true; throw new Error('timed out') }

function engine (name, more = {}) {
  const [a, b] = pair()
  start(a)
  const rpc = connect(b, { onEvent: () => {} })
  return { rpc, init: () => rpc.request('init', { dir: path.join(tmp, name), bootstrap, projects: path.join(tmp, name + '-projects'), deviceName: name, ...more }) }
}

const pc = engine('pc')
await pc.init()
const ide = path.join(tmp, 'ide')
fs.mkdirSync(ide)
fs.writeFileSync(path.join(ide, 'site.json'), JSON.stringify({ title: 'IDE', permissions: ['space', 'projects'] }))
fs.writeFileSync(path.join(ide, 'index.html'), 'ide')
const { key } = await pc.rpc.request('site.publish', { folder: ide })
const allow = async (rpc) => {
  await rpc.request('site.open', { key, timeout: 30000 })
  await rpc.request('site.consent', { key, allow: true })
  await rpc.request('site.permit', { key, permission: 'projects', allow: true })
}
await allow(pc.rpc)
const call = (rpc, method, ...args) => rpc.request('site.call', { key, method: 'projects.' + method, args })

const { code } = await pc.rpc.request('devices.add')
const laptop = engine('laptop', { joinCode: code, joinTimeout: 60000 })
await laptop.init()
await until(() => laptop.rpc.request('site.open', { key, timeout: 30000 }).then(() => true, () => false))
await allow(laptop.rpc)

const project = await call(pc.rpc, 'create', 'Perf')
await until(async () => (await call(laptop.rpc, 'list')).some((p) => p.key === project.key && p.folder))
const there = (await call(laptop.rpc, 'list')).find((p) => p.key === project.key).folder
const page = 'x'.repeat(1000)
let t = performance.now()
fs.writeFileSync(path.join(project.folder, 'site.json'), JSON.stringify({ title: 'Perf' }))
fs.writeFileSync(path.join(project.folder, 'index.html'), 'v1')
for (let i = 0; i < FILES; i++) {
  const dir = path.join(project.folder, 'd' + (i % 20))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, i + '.txt'), page)
}
const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? (e.name === '.swarmfs-trash' ? 0 : count(path.join(d, e.name))) : 1), 0)
await until(() => count(there) >= FILES + 3) // + site.json, index.html, .swarmfsignore
const sync = Math.round(performance.now() - t)

const visitor = engine('visitor')
await visitor.init()
const read = (site, p) => visitor.rpc.request('site.read', { key: site, path: p, timeout: 5000 }).then((r) => Buffer.from(r.bytes).toString(), () => null)
t = performance.now()
const first = await call(pc.rpc, 'publish', project.key)
const firstCall = Math.round(performance.now() - t)
await visitor.rpc.request('site.open', { key: first.site, timeout: 60000 })
await until(async () => (await read(first.site, '')) === 'v1')
const firstSeen = Math.round(performance.now() - t)

fs.writeFileSync(path.join(project.folder, 'index.html'), 'v2')
t = performance.now()
await call(pc.rpc, 'publish', project.key)
const nextCall = Math.round(performance.now() - t)
await until(async () => (await read(first.site, '')) === 'v2')
const nextSeen = Math.round(performance.now() - t)

console.log(`${FILES} files: on the other device in ${sync} ms; publish: first ${firstCall} ms (a visitor reads it at ${firstSeen} ms), one file changed ${nextCall} ms (read at ${nextSeen} ms)`)
const one = (v) => ({ median: v, min: v, max: v })
record([
  ['projects.sync', 'ms', one(sync), 1, FILES],
  ['projects.publish.first', 'ms', one(firstCall), 1, FILES],
  ['projects.publish.first.seen', 'ms', one(firstSeen), 1, FILES],
  ['projects.publish.next', 'ms', one(nextCall), 1, FILES],
  ['projects.publish.next.seen', 'ms', one(nextSeen), 1, FILES]
])

for (const e of [visitor, laptop, pc]) await e.rpc.request('close').catch(() => {})
await testnet.destroy()
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }) } catch {}

// [scenario, unit, { median, min, max }, n, size] → perf/history.jsonl
function record (rows) {
  const git = (c) => { try { return execSync('git ' + c, { cwd: HERE }).toString().trim() } catch { return null } }
  const now = new Date().toISOString()
  const common = {
    date: now, run: now, sha: git('rev-parse HEAD'), dirty: !!git('status --porcelain'), runtime: 'node', version: process.version,
    machine: { cores: os.cpus().length, cpu: os.cpus()[0].model, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${process.platform} ${os.release()}` }
  }
  const line = ([scenario, unit, r, n, size]) => JSON.stringify({ ...common, scenario, size, unit, better: 'lower', median: r.median, spread: Math.round((r.max - r.min) * 10) / 10, n, min: r.min, max: r.max })
  fs.appendFileSync(path.join(HERE, 'history.jsonl'), rows.map(line).join('\n') + '\n')
}
