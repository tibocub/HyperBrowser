// The engine's entry and lifecycle: init, refusals, heartbeat, close (spec 001 US5, FR-001..005, SC-003, SC-005).
import test from 'brittle'
import b4a from 'b4a'
import FramedStream from 'framed-stream'
import { start } from '../engine/index.js'
import { pair } from '../engine/protocol.js'
import { engine, codeOf, within, sleep, tmpDir, bootstrap } from './helpers.js'

test('before init: NOT_READY; init gives the identity; a second init: ALREADY', async (t) => {
  const e = await engine(t, { init: false })
  t.is(await codeOf(e.rpc.request('site.open', { key: 'x' })), 'NOT_READY')
  t.is(await codeOf(e.rpc.request('init', {})), 'INVALID_PARAMS')
  const r = await e.rpc.request('init', { dir: e.dir, bootstrap: await bootstrap(t) })
  t.is(typeof r.identity, 'string')
  t.is(r.version, 1)
  t.is(await codeOf(e.rpc.request('init', { dir: e.dir })), 'ALREADY')
})

test('unknown methods, bad params and malformed frames: refused or dropped, the engine goes on', async (t) => {
  const e = await engine(t)
  t.is(await codeOf(e.rpc.request('nope')), 'UNKNOWN_METHOD')
  t.is(await codeOf(e.rpc.request('site.open', { key: 42 })), 'INVALID_PARAMS')
  t.is(await codeOf(e.rpc.request('site.open', { key: 'not a key' })), 'INVALID_KEY')
  t.is(await codeOf(e.rpc.request('site.read', { key: 'l'.repeat(52), path: 'a' })), 'INVALID_KEY')
  t.is(await e.rpc.request('ping'), true)
})

test('malformed frames on the raw stream never crash it', async (t) => {
  const [a, b] = pair()
  const eng = start(a)
  const raw = new FramedStream(b)
  const got = []
  raw.on('data', (buf) => got.push(JSON.parse(b4a.toString(buf))))
  for (const junk of ['', 'null', '[]', '"x"', '{"v":1,"id":1}', '{"v":1,"method":5}', '{"v":3,"id":2,"method":"ping"}']) raw.write(b4a.from(junk))
  raw.write(b4a.from(JSON.stringify({ v: 1, id: 3, method: 'ping' })))
  await within(new Promise((resolve) => { const i = setInterval(() => { if (got.some((m) => m.id === 3)) { clearInterval(i); resolve() } }, 10) }), 2000)
  t.is(got.find((m) => m.id === 2).error.code, 'BAD_VERSION')
  t.is(got.find((m) => m.id === 3).result, true)
  raw.destroy()
  await within(eng.closed, 5000)
})

test('no heartbeat for 3 periods: the engine closes itself and says why', async (t) => {
  const e = await engine(t, { heartbeat: 300 })
  const started = Date.now()
  const reason = await within(e.engine.closed, 10000, 'still running')
  t.is(reason, 'heartbeat')
  t.ok(Date.now() - started < 4 * 300 + 2000, 'within 4 periods (plus closing)')
  t.ok(e.events.some((ev) => ev.event === 'closing' && ev.data.reason === 'heartbeat'))
})

test('pings keep it running', async (t) => {
  const e = await engine(t, { heartbeat: 200 })
  const ping = setInterval(() => e.rpc.request('ping').catch(() => {}), 100)
  await sleep(1500)
  clearInterval(ping)
  t.is(await within(e.engine.closed, 10, 'running'), 'running')
})

test('close: replies, then the engine ends', async (t) => {
  const dir = tmpDir(t, 'hb')
  const e = await engine(t, { dir })
  t.is(await e.rpc.request('close'), true)
  t.is(await within(e.engine.closed, 5000, 'running'), 'close')
})
