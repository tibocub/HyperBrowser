// Spec 020: the helper's idle CPU and memory while it holds for a circle and keeps the official apps. Tibo's engine
// publishes the apps (scripts/apps.js, into a copy of preset.json) and makes a circle; `--people` others join it and
// stay online in this process; the helper then runs alone in a fresh process, joins from its config, keeps the apps,
// and is measured for `--minutes`.
//   node --expose-gc perf/helper.mjs [-- --people 3 --minutes 1]   (appends to perf/history.jsonl)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'
import createTestnet from 'hyperdht/testnet.js'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'
import { helper } from '../engine/helper.js'
import { APPS, publishApps } from '../scripts/apps.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : Number(process.argv[i + 1]) }
const people = arg('--people', 3)
const minutes = arg('--minutes', 1)
const CHILD = process.argv.includes('--measure')
const tmp = CHILD ? process.argv[process.argv.indexOf('--measure') + 1] : fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'hb-perf-'))
const testnet = CHILD ? null : await createTestnet(3)
const bootstrap = CHILD ? JSON.parse(process.argv[process.argv.indexOf('--bootstrap') + 1]) : testnet.bootstrap
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function engine (name) {
  const [a, b] = pair()
  start(a)
  const rpc = connect(b, { onEvent: () => {} })
  await rpc.request('init', { dir: path.join(tmp, name), bootstrap })
  return rpc
}

if (CHILD) await measure()

const tibo = await engine('tibo')
const preset = path.join(tmp, 'preset.json')
fs.copyFileSync(path.join(ROOT, 'shell', 'preset.json'), preset)
const apps = APPS.filter((a) => fs.existsSync(path.join(ROOT, a.folder))) // out/home: after npm run home:build
await publishApps(tibo, { root: ROOT, preset, apps, replace: true })
const ring = await tibo.request('circles.create', { name: 'Perf' })
const others = []
for (let p = 0; p < people; p++) {
  const e = await engine('p' + p)
  await e.request('circles.join', { link: (await tibo.request('circles.invite', { key: ring.key })).link })
  others.push(e)
}
const link = (await tibo.request('circles.invite', { key: ring.key })).link
console.log(`${apps.length} apps published, a circle of ${people + 1}`)
const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--measure', tmp, '--bootstrap', JSON.stringify(bootstrap), '--minutes', String(minutes), '--people', String(people), '--link', link, '--apps', String(apps.filter((a) => !a.instance).length)], { stdio: 'inherit' })
const code = await new Promise((resolve) => child.on('exit', resolve))
for (const e of [tibo, ...others]) await e.request('close').catch(() => {})
await testnet.destroy()
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
process.exit(code)

async function measure () {
  const rpc = await engine('helper')
  const lines = []
  const h = helper({ rpc, dir: path.join(tmp, 'helper'), preset: path.join(tmp, 'preset.json'), log: (l) => lines.push(l) })
  const t = Date.now()
  await h.apply({ name: 'Helper (perf)', share: 1, apps: 'official', seed: [], join: [process.argv[process.argv.indexOf('--link') + 1]] })
  const want = arg('--apps', 0) // the forum is an invite-only instance: a stranger, the helper too, can't open it
  const kept = () => lines.filter((l) => l.startsWith('keeping ')).length
  for (const end = Date.now() + 120000; kept() < want && Date.now() < end; await wait(500));
  const ready = Date.now() - t
  console.log(`helper ready in ${ready} ms: ${lines.join(' | ')}`)
  const end = Date.now() + minutes * 60000
  let cpu = process.cpuUsage()
  let at = Date.now()
  const load = []
  const rss = []
  while (Date.now() < end) {
    await wait(5000)
    const c = process.cpuUsage(cpu)
    load.push(((c.user + c.system) / 1000) / (Date.now() - at) * 100) // % of one core
    global.gc?.()
    rss.push(process.memoryUsage().rss / 1e6)
    cpu = process.cpuUsage()
    at = Date.now()
  }
  await h.close()
  await rpc.request('close')
  const result = { cpu: stats(load), rss: stats(rss) }
  console.log(`helper idle: median ${result.cpu.median} % of a core (max ${result.cpu.max}), ${result.rss.median} MB resident`)
  record([['helper.ready', 'ms', { median: ready, min: ready, max: ready }, 1, people + 1], ['helper.idle.cpu', '% core', result.cpu, load.length, people + 1], ['helper.idle.rss', 'MB', result.rss, rss.length, people + 1]])
  process.exit(kept() === want && lines.some((l) => l.startsWith('joined')) ? 0 : 1)
}

function stats (l) { const s = l.slice().sort((a, b) => a - b); return { median: Math.round(s[s.length >> 1] * 10) / 10, min: Math.round(s[0] * 10) / 10, max: Math.round(s.at(-1) * 10) / 10 } }

// [scenario, unit, { median, min, max }, n, size] → perf/history.jsonl (as perf/circles.mjs)
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
