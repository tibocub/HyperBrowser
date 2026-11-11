// Spec 016 R3: is 20 s enough for a watched place's turn online? Measures, N times, how long a place that
// isn't held takes from its hold to the notification of a record written while it was away: Bob's engine
// stopped, Ann writes, Bob's engine started (it holds the place: a turn starts). Two engines in one process.
//   node perf/turn.mjs [runs] [--public]   (default: a local test DHT; --public: the real one)
import fs from 'fs'
import os from 'os'
import path from 'path'
import createTestnet from 'hyperdht/testnet.js'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

const runs = Number(process.argv[2]) || 5
const pub = process.argv.includes('--public')
const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'hb-turn-'))
const testnet = pub ? null : await createTestnet(3)
const bootstrap = testnet?.bootstrap

async function engine (dir) {
  const [a, b] = pair()
  const events = []
  start(a)
  const rpc = connect(b, { onEvent: (event, data) => events.push({ event, data }) })
  await rpc.request('init', { dir, bootstrap, notifyTurn: 1000 })
  return { rpc, events, dir }
}
const until = async (fn, ms = 120000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)) } return false }

const site = path.join(tmp, 'site')
fs.mkdirSync(site)
fs.writeFileSync(path.join(site, 'index.html'), 'hi')
fs.writeFileSync(path.join(site, 'site.json'), JSON.stringify({
  title: 'Chat', permissions: ['space', 'notifications'], types: { message: { fields: { text: 'text' } } }, notifications: [{ type: 'message', text: 'text' }]
}))
const ann = await engine(path.join(tmp, 'ann'))
const { key } = await ann.rpc.request('site.publish', { folder: site })
const call = (e, method, args, instance) => e.rpc.request('site.call', { key, method, args, instance })
const allow = async (e) => {
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
}
await allow(ann)
const g = await call(ann, 'instances.create', ['G'])
const link = await call(ann, 'createInvite', [{ role: 'member' }], g.key)
let bob = await engine(path.join(tmp, 'bob'))
await allow(bob)
await call(bob, 'instances.join', [link])
await bob.rpc.request('site.permit', { key, permission: 'notifications', allow: true })
await bob.rpc.request('site.close', { key })
await until(async () => (await call(ann, 'peers', [], g.key)).length > 0)
await new Promise((r) => setTimeout(r, 3000))

const times = []
for (let i = 0; i < runs; i++) {
  await bob.rpc.request('close')
  await call(ann, 'put', ['message', { text: 'run ' + i }], g.key)
  const started = Date.now()
  bob = await engine(bob.dir)
  const ok = await until(async () => (await bob.rpc.request('notify.state')).items.some((x) => x.text === 'run ' + i))
  times.push(ok ? Date.now() - started : null)
  console.log(`run ${i}: ${ok ? Date.now() - started + ' ms' : 'not within 120 s'}`)
}
const got = times.filter((x) => x !== null).sort((a, b) => a - b)
console.log(JSON.stringify({ dht: pub ? 'public' : 'testnet', runs, reached: got.length, min: got[0], median: got[got.length >> 1], max: got.at(-1) }))
await bob.rpc.request('close')
await ann.rpc.request('close')
if (testnet) await testnet.destroy()
fs.rmSync(tmp, { recursive: true, force: true })
