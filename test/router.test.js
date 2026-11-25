// The router's supervisor (shell code: Electron's Node), with a stand-in router process.
import test from 'brittle'

if (typeof Bare !== 'undefined') {
  test('router: skipped on Bare (shell code)', (t) => t.pass('skipped on Bare'))
} else {
  const { fileURLToPath } = await import('url')
  const Sidecar = (await import('bare-sidecar')).default
  const { Router } = await import('../shell/router.js')
  const { tmpDir, eventually } = await import('./helpers.js')

  const FAKE = fileURLToPath(new URL('./fixtures/router/fake.js', import.meta.url))
  // bare-sidecar passes no env option: the child inherits this process's
  /** @param {Record<string, string>} env */
  const runWith = (env) => (entry, args) => { Object.assign(process.env, env); try { return new Sidecar(entry, args) } finally { for (const k in env) delete process.env[k] } }

  test('router: starts with a loopback SAM port and the relaying options, stops on request', async (t) => {
    const r = new Router({ dataDir: tmpDir(t, 'router'), run: runWith({}), entry: FAKE, options: { bandwidth: 'O', share: 50 } })
    /** @type {any[]} */
    const seen = []
    r.on('status', (s) => seen.push(s))
    await r.start()
    t.ok(r.port > 0, 'a port picked')
    await eventually(() => r.state === 'up')
    t.is(seen[0].port, r.port, 'the process got the port')
    t.alike(seen[0].options, { bandwidth: 'O', share: 50 })
    await r.stop()
    t.is(r.state, 'stopped')
    t.is(r.restarts, 0)
  })

  test('router: a crash restarts it on the same port, with growing backoff', async (t) => {
    const r = new Router({ dataDir: tmpDir(t, 'router'), run: runWith({ HB_FAKE_EXIT_MS: '300' }), entry: FAKE })
    /** @type {string[]} */
    const states = []
    r.on('state', (s) => states.push(s))
    await r.start()
    const port = r.port
    await eventually(() => r.restarts >= 2, 15000)
    t.ok(states.includes('down'), 'said down while restarting')
    t.is(r.port, port, 'same port: engines keep theirs')
    t.ok(r.backoff >= 4000, 'backoff doubled: ' + r.backoff)
    await r.stop()
    const restarts = r.restarts
    await new Promise((resolve) => setTimeout(resolve, 1500))
    t.is(r.restarts, restarts, 'no restart after stop()')
  })

  test('router: SAM could not listen on its port (exit 3): restarted on a new port, said with a port event', async (t) => {
    const r = new Router({ dataDir: tmpDir(t, 'router'), run: runWith({ HB_FAKE_EXIT_MS: '200', HB_FAKE_EXIT_CODE: '3' }), entry: FAKE })
    /** @type {number[]} */
    const ports = []
    r.on('port', (p) => ports.push(p))
    await r.start()
    await eventually(() => ports.length >= 2, 10000)
    t.not(ports[1], ports[0], 'another port')
    await r.stop()
  })
}
