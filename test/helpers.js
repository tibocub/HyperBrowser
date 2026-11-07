// Test helpers on Node and Bare: an engine started exactly as the worker does (start() on one end of a
// stream), on the test's own DHT (hypergraph/testing), and site folders.
import fs from 'fs'
import b4a from 'b4a'
import path from 'path'
import testing from 'hypergraph/testing'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

export const { bootstrap, tmpDir, eventually, within, codeOf, sleep } = testing

// { rpc, dir, engine, events, next(event) }: init'ed unless { init: false }.
export async function engine (t, { init = true, dir = tmpDir(t, 'hb'), ...opts } = {}) {
  const [a, b] = pair()
  const events = []
  const waiters = []
  const eng = start(a)
  const rpc = connect(b, {
    onEvent: (event, data) => {
      events.push({ event, data })
      for (const w of waiters.splice(0)) w({ event, data })
    }
  })
  t.teardown(() => within(rpc.request('close').catch(() => {}), 15000)) // before the folders go (order 1000)
  if (init) await rpc.request('init', { dir, bootstrap: await bootstrap(t), ...opts })
  return { rpc, dir, engine: eng, events, next: () => new Promise((resolve) => waiters.push(resolve)) }
}

// A folder with `files` ({ name: text }); site.json from `manifest` unless it is null.
export function siteFolder (t, { manifest = { title: 'Test site' }, files = { 'index.html': '<h1>hi</h1>' } } = {}) {
  const dir = tmpDir(t, 'site')
  if (manifest !== null) files = { 'site.json': typeof manifest === 'string' ? manifest : JSON.stringify(manifest), ...files }
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), text)
  }
  return dir
}

export const text = (bytes) => b4a.toString(bytes)
