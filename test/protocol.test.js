// The message protocol (contracts/protocol.md), on its own: framing, versions, ids, errors, bytes.
import test from 'brittle'
import b4a from 'b4a'
import FramedStream from 'framed-stream'
import { connect, pair, toWire, fromWire, VERSION } from '../engine/protocol.js'
import testing from 'hypergraph/testing'

const { codeOf, within } = testing

function both (handle) {
  const [a, b] = pair()
  const events = []
  const server = connect(a, { handle })
  const client = connect(b, { onEvent: (event, data) => events.push({ event, data }) })
  return { server, client, events, a, b }
}

test('request, reply, error codes, events', async (t) => {
  const { server, client, events } = both(async (method, params) => {
    if (method === 'add') return params.x + params.y
    if (method === 'nothing') return undefined
    throw Object.assign(new Error('nope'), { code: 'NOT_ALLOWED' })
  })
  t.is(await client.request('add', { x: 2, y: 3 }), 5)
  t.is(await client.request('nothing'), null)
  t.is(await codeOf(client.request('other')), 'NOT_ALLOWED')
  server.emit('live', { id: 1 })
  await within(new Promise((resolve) => setTimeout(resolve, 50)), 100)
  t.alike(events, [{ event: 'live', data: { id: 1 } }])
  t.is(VERSION, 1)
  client.destroy()
})

test('bytes cross as bytes, both ways', async (t) => {
  const { client } = both(async (method, params) => ({ back: params.data, len: params.data.byteLength }))
  const data = b4a.from([0, 1, 2, 255])
  const r = await client.request('echo', { data })
  t.is(r.len, 4)
  t.ok(b4a.isBuffer(r.back) || r.back instanceof Uint8Array)
  t.alike([...r.back], [0, 1, 2, 255])
  t.alike(fromWire(JSON.parse(JSON.stringify(toWire({ a: [b4a.from('hi')] })))).a[0], b4a.from('hi'))
  client.destroy()
})

test('wrong version: BAD_VERSION; bad JSON and unknown ids dropped; then still works', async (t) => {
  const [a, b] = pair()
  connect(a, { handle: async () => 'ok' })
  const raw = new FramedStream(b)
  const got = []
  raw.on('data', (buf) => got.push(JSON.parse(b4a.toString(buf))))
  raw.write(b4a.from(JSON.stringify({ v: 2, id: 7, method: 'x' })))
  raw.write(b4a.from('not json'))
  raw.write(b4a.from(JSON.stringify({ v: 1, id: 99, result: 1 }))) // a reply nobody waits for
  raw.write(b4a.from(JSON.stringify({ v: 1 })))
  raw.write(b4a.from(JSON.stringify({ v: 1, id: 8, method: 'x' })))
  await within(new Promise((resolve) => { const i = setInterval(() => { if (got.length >= 2) { clearInterval(i); resolve() } }, 10) }), 2000)
  t.is(got[0].id, 7)
  t.is(got[0].error.code, 'BAD_VERSION')
  t.alike(got[1], { v: 1, id: 8, result: 'ok' })
  raw.destroy()
})

test('a closed stream rejects what is waiting with CLOSED', async (t) => {
  const { client, a } = both(() => new Promise(() => {}))
  const waiting = client.request('forever')
  a.destroy()
  t.is(await codeOf(waiting), 'CLOSED')
  t.is(await codeOf(client.request('after')), 'CLOSED')
})
