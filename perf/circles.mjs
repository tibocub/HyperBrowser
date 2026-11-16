// Spec 018: what opening Configuration's circles costs (circles.list, then each circle's members), and the engine's
// idle CPU while holding (a 1 GB share) for its circles. Tibo makes 3 circles; `--people` others join all three
// and hold, staying online in this process; Tibo's engine is then measured alone in a fresh process.
// Spec 019: the circles window's Invite contacts… for `--friends` friends of Tibo's (Chat conversations, not in the
// circle): each their own invite, one after another as the shell sends them.
//   npm run perf:circles [-- --people 49 --friends 10 --minutes 1]   (49: circles of 50; appends to perf/history.jsonl)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'
import createTestnet from 'hyperdht/testnet.js'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CIRCLES = 3
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : Number(process.argv[i + 1]) }
// shortcut: 5 by default: from 7 (3 circles of 8) hypergraph's autobase crashes while people join (Writer._loadNextNode,
// 'node' of null, 2026-11-16); 49 (circles of 50) once that is fixed
const people = arg('--people', 5)
const minutes = arg('--minutes', 1)
const friends = arg('--friends', 10)
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
const started = Date.now()
const keys = []
for (let i = 0; i < CIRCLES; i++) keys.push((await tibo.request('circles.create', { name: 'C' + i })).key)
const others = []
const pals = [] // spec 019: Tibo's friends
for (let p = 0; p < people; p++) {
  const e = await engine('p' + p)
  for (const key of keys) await e.request('circles.join', { link: (await tibo.request('circles.invite', { key })).link })
  others.push(e)
}
console.log(`${CIRCLES} circles of ${people + 1} made in ${Math.round((Date.now() - started) / 1000)} s`)
await invites()
await tibo.request('close')
const child = spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--measure', tmp, '--bootstrap', JSON.stringify(bootstrap), '--minutes', String(minutes), '--people', String(people)], { stdio: 'inherit' })
const code = await new Promise((resolve) => child.on('exit', resolve))
for (const e of [...others, ...pals]) await e.request('close').catch(() => {})
await testnet.destroy()
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
process.exit(code)

// Tibo's friends by contact link (Chat published by Tibo, a copy of sites/chat), then Invite contacts… to circle C0
async function invites () {
  const folder = path.join(tmp, 'chat-site')
  fs.cpSync(path.join(HERE, '..', 'sites', 'chat'), folder, { recursive: true })
  const { key } = await tibo.request('site.publish', { folder })
  const as = (e, method, args = []) => e.request('site.call', { key, method, args })
  const app = async (e) => {
    await e.request('apps.set', { chat: key })
    await e.request('site.open', { key })
    await e.request('site.consent', { key, allow: true })
    await e.request('site.permit', { key, permission: 'contacts', allow: true })
  }
  await app(tibo)
  for (let f = 0; f < friends; f++) {
    const e = await engine('f' + f)
    pals.push(e)
    await app(e)
    await as(e, 'contacts.add', [(await as(tibo, 'contacts.link')).link])
  }
  for (const end = Date.now() + 120000; Date.now() < end; await wait(500)) if ((await tibo.request('contacts.list')).filter((c) => c.state === 'friend').length === friends) break
  const list = (await tibo.request('contacts.list')).filter((c) => c.state === 'friend')
  const each = []
  const t = Date.now()
  for (const c of list) {
    const s = Date.now()
    await tibo.request('contacts.inviteToCircle', { identity: c.identity, circle: keys[0] })
    each.push(Date.now() - s)
  }
  const all = Date.now() - t
  console.log(`Invite contacts… to ${list.length} friends: ${all} ms (each ${each.join(', ')} ms)`)
  record([['circles.inviteContacts', 'ms', { median: all, min: all, max: all }, 1, list.length], ['circles.inviteContacts.each', 'ms', stats(each), each.length, list.length]])
}

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

async function measure () {
  const tibo = await engine('tibo')
  await wait(10000) // its circles open, holders found
  const open = []
  for (let i = 0; i < 5; i++) {
    const t = Date.now()
    const list = await tibo.request('circles.list')
    for (const c of list) await tibo.request('circles.members', { key: c.key })
    open.push(Date.now() - t)
  }
  const h = await tibo.request('holding.get')
  console.log(`Configuration's circles (list + members of ${CIRCLES}): ${open.join(', ')} ms; holding ${h.on ? 'on' : 'off'}, share ${h.bytes / 1e9} GB, ${Math.round(h.used / 1e6)} MB held`)
  const end = Date.now() + minutes * 60000
  let cpu = process.cpuUsage()
  let at = Date.now()
  const load = []
  while (Date.now() < end) {
    await wait(5000)
    const c = process.cpuUsage(cpu)
    load.push(((c.user + c.system) / 1000) / (Date.now() - at) * 100) // % of one core
    cpu = process.cpuUsage()
    at = Date.now()
  }
  await tibo.request('close')
  const result = { open: stats(open), cpu: stats(load) }
  console.log(`idle while holding: median ${result.cpu.median} % of a core, max ${result.cpu.max} %`)
  record([['circles.open', 'ms', result.open, open.length, people + 1], ['circles.idle.cpu', '% core', result.cpu, load.length, people + 1]])
  process.exit(h.on ? 0 : 1)
}
