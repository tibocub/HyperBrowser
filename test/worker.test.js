// The engine as the shell runs it: a Bare process from pear-runtime (spec 001 US5, SC-003). The shell
// stops sending heartbeats but keeps the pipe open (what a killed shell looks like on Windows: no pipe
// event): the worker must exit by itself. Node only (pear-runtime runs in the shell's Node side).
import test from 'brittle'
import { fileURLToPath } from 'url'
import { tmpDir, within } from './helpers.js'
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
