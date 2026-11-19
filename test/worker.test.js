// The engine as the shell runs it: a Bare process from pear-runtime. The shell
// stops sending heartbeats but keeps the pipe open (what a killed shell looks like on Windows: no pipe
// event): the worker must exit by itself. Node only (pear-runtime runs in the shell's Node side).
import test from 'brittle'
import { fileURLToPath } from 'url'
import { engine, tmpDir, within, eventually } from './helpers.js'
import { guard } from '../engine/index.js'
import { connect } from '../engine/protocol.js'

const onBare = typeof globalThis.Bare !== 'undefined'

test('no heartbeat: the worker process exits; with heartbeats it stays', { skip: onBare }, async (t) => {
  const { default: PearRuntime } = await import('pear-runtime')
  const worker = PearRuntime.run(fileURLToPath(new URL('../engine/worker.js', import.meta.url)))
  const exited = new Promise((resolve) => worker.once('exit', resolve))
  t.teardown(async () => { worker.destroy(); await within(exited, 10000) })
  const rpc = connect(worker)
  await rpc.request('init', { dir: tmpDir(t, 'worker'), heartbeat: 500 })

  const ping = setInterval(() => rpc.request('ping').catch(() => {}), 250)
  t.is(await within(exited, 3000, 'running'), 'running', 'alive while pinged')
  clearInterval(ping)
  const started = Date.now()
  t.not(await within(exited, 10000, 'running'), 'running', 'exits once the pings stop')
  t.ok(Date.now() - started < 4 * 500 + 3000, 'within 4 periods (plus closing): ' + (Date.now() - started) + ' ms')
})

test('an error escaping in the worker: logged, told to the shell, and the worker keeps running', { skip: onBare }, async (t) => {
  const { default: PearRuntime } = await import('pear-runtime')
  const worker = PearRuntime.run(fileURLToPath(new URL('./worker-escape.js', import.meta.url)))
  const exited = new Promise((resolve) => worker.once('exit', resolve))
  t.teardown(async () => { worker.destroy(); await within(exited, 10000) })
  let log = ''
  worker.stderr.on('data', (d) => { log += d })
  const told = []
  const rpc = connect(worker, { onEvent: (event, data) => { if (event === 'engine.error') told.push(data) } })
  await rpc.request('init', { dir: tmpDir(t, 'worker') })
  t.ok(await eventually(() => told.length === 2, 10000), 'both told')
  t.alike(told, [{ message: 'thrown', code: 'TEST', method: null }, { message: 'rejected', code: null, method: 'site.call' }], 'message, code, method; no stack')
  t.ok(/escaped error TEST: Error: thrown\s+at /.test(log), 'the log has the stack: ' + log.slice(0, 200))
  t.ok(log.includes('escaped error in site.call: Error: rejected'), 'and the method')
  t.is(await rpc.request('ping'), true, 'still running')
  t.is(await within(exited, 500, 'running'), 'running')
})

test("the helper's guard (process.on): one line each, told, and the engine keeps running", async (t) => {
  const e = await engine(t)
  const on = {}
  guard(e.engine, { on: (name, fn) => { on[name] = fn } }, { stack: false })
  const lines = []
  const error = console.error
  console.error = (line) => lines.push(line)
  try {
    on.uncaughtException(Object.assign(new Error('thrown'), { code: 'TEST' }))
    on.unhandledRejection('a string')
  } finally { console.error = error }
  t.alike(lines, ['escaped error TEST: thrown', 'escaped error: a string'])
  t.ok(await eventually(() => e.events.filter((x) => x.event === 'engine.error').length === 2, 5000), 'told')
  t.is(await e.rpc.request('ping'), true, 'still running')
})
