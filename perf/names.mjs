// what typing a name costs the engine (names.resolve). An authority of `--names` names is made by another
// person's hypergraph on a local DHT; the engine resolves one name by the authority's link (the first time: it joins
// the authority), then `--n` names by the authority's name (held: local reads).
//   npm run perf:names [-- --names 200 --n 20]   (appends to perf/history.jsonl)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import createTestnet from 'hyperdht/testnet.js'
import { Hypergraph } from 'hypergraph/next'
import hyperdns from 'hyperdns'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : Number(process.argv[i + 1]) }
const NAMES = arg('--names', 200)
const N = arg('--n', 20)
const SITE = 'y'.repeat(52)
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'hb-perf-'))
const testnet = await createTestnet(3)
const { bootstrap } = testnet

const owner = await Hypergraph.open(path.join(tmp, 'owner'), { bootstrap })
await owner.connectToSwarm()
const { dns, link } = await hyperdns.createAuthority('perfDNS', { hg: owner })
for (let i = 0; i < NAMES; i++) await dns.publish('site' + i, { type: 'hyper', value: 'hyper://' + SITE })

const [a, b] = pair()
start(a)
const rpc = connect(b, { onEvent: () => {} })
await rpc.request('init', { dir: path.join(tmp, 'engine'), bootstrap })

let t = performance.now()
await rpc.request('names.resolve', { address: 'site0@' + link, timeout: 30000 })
const first = Math.round(performance.now() - t)
const each = []
for (let i = 0; i < N; i++) {
  t = performance.now()
  await rpc.request('names.resolve', { address: 'site' + ((i * 7) % NAMES) + '@perfDNS' })
  each.push(performance.now() - t)
}
console.log(`names.resolve by link (joins): ${first} ms; by name, held: median ${stats(each).median} ms (${N} of ${NAMES} names)`)
record([['names.resolve.first', 'ms', { median: first, min: first, max: first }, 1, NAMES], ['names.resolve.held', 'ms', stats(each), N, NAMES]])

await rpc.request('close')
await owner.close()
await testnet.destroy()
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }) } catch {}

function stats (l) { const s = l.slice().sort((a, b) => a - b); return { median: Math.round(s[s.length >> 1] * 10) / 10, min: Math.round(s[0] * 10) / 10, max: Math.round(s.at(-1) * 10) / 10 } }

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
