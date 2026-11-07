// The site API through the engine (spec 001 US4; FR-013..016; SC-004): hypergraph's site handle for the
// site's own space, asked once per site, live views across the boundary. The types used are those a
// SwarmFS site space has (profile, site, file): a site's own types are a request (research R11).
import test from 'brittle'
import b4a from 'b4a'
import { engine, siteFolder, codeOf, eventually, sleep } from './helpers.js'

const DYNAMIC = { manifest: { title: 'Dynamic', permissions: ['space'] } }

async function published (t, opts = DYNAMIC) {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t, opts) })
  await owner.rpc.request('site.open', { key })
  return { owner, key }
}

const liveEvents = (e, id) => e.events.filter((ev) => ev.event === 'live' && ev.data.id === id).map((ev) => ev.data)

test('a static site has no API; a dynamic one asks first; no means no', async (t) => {
  const { owner: e, key: staticKey } = await published(t, { manifest: { title: 'Static' } })
  t.is(await codeOf(e.rpc.request('site.call', { key: staticKey, method: 'query', args: ['profile'], chain: [['latest', [5]]] })), 'NOT_ALLOWED')
  t.is(await codeOf(e.rpc.request('site.live', { key: staticKey, args: ['profile'] })), 'NOT_ALLOWED')
  t.is(await codeOf(e.rpc.request('site.on', { key: staticKey, event: 'change' })), 'NOT_ALLOWED')

  const { key } = await e.rpc.request('site.publish', { folder: siteFolder(t, DYNAMIC) })
  await e.rpc.request('site.open', { key })
  t.is(await codeOf(e.rpc.request('site.call', { key, method: 'info' })), 'NEEDS_CONSENT')
  await e.rpc.request('site.consent', { key, allow: false })
  t.is(await codeOf(e.rpc.request('site.call', { key, method: 'info' })), 'NOT_ALLOWED')
  t.is(await codeOf(e.rpc.request('site.call', { key: 'y'.repeat(52), method: 'info' })), 'NOT_FOUND', 'a site not opened here')
})

test('two sites answered at the same moment: both answers kept', async (t) => {
  const { owner: e, key: a } = await published(t)
  const { key: b } = await e.rpc.request('site.publish', { folder: siteFolder(t, DYNAMIC) })
  await e.rpc.request('site.open', { key: b })
  await Promise.all([e.rpc.request('site.consent', { key: a, allow: true }), e.rpc.request('site.consent', { key: b, allow: true })])
  t.is((await e.rpc.request('site.call', { key: a, method: 'info' })).key, a)
  t.is((await e.rpc.request('site.call', { key: b, method: 'info' })).key, b)
})

test('after yes: calls, query chains, info; the answer is remembered after a restart', async (t) => {
  const { owner, key } = await published(t)
  await owner.rpc.request('site.consent', { key, allow: true })
  const info = await owner.rpc.request('site.call', { key, method: 'info' })
  t.is(info.key, key)
  t.is(typeof info.identity, 'string')

  const rec = await owner.rpc.request('site.call', { key, method: 'put', args: ['profile', { name: 'ann' }] })
  t.is(rec.name, 'ann')
  t.is(rec.author, info.identity, 'written as the person (main identity)')
  t.is((await owner.rpc.request('site.call', { key, method: 'get', args: [rec.id] })).record.name, 'ann')
  const mine = await owner.rpc.request('site.call', { key, method: 'query', args: ['profile'], chain: [['by', [info.identity]], ['latest', [10]]] })
  t.alike(mine.items.map((r) => r.name), ['ann'])
  t.is(typeof mine.complete, 'boolean')
  t.ok(Array.isArray(await owner.rpc.request('site.call', { key, method: 'subspaces' })), 'sync getters work too')

  t.is(await codeOf(owner.rpc.request('site.call', { key, method: 'addProtocol', args: ['x', {}] })), 'UNKNOWN_METHOD')
  t.is(await codeOf(owner.rpc.request('site.call', { key, method: 'memberConnections' })), 'UNKNOWN_METHOD')
  t.is(await codeOf(owner.rpc.request('site.call', { key, method: 'query', args: ['profile'], chain: [['latest', [1]], ['latest', [1]]] })), 'INVALID_PARAMS')
  t.is(await codeOf(owner.rpc.request('site.call', { key, method: 'query', args: ['profile'], chain: [['constructor', []], ['latest', [1]]] })), 'INVALID_PARAMS')

  // another site's space as a sub-space: refused; its own pages sub-space: allowed, bytes cross as bytes
  const other = await owner.rpc.request('site.publish', { folder: siteFolder(t, DYNAMIC) })
  t.is(await codeOf(owner.rpc.request('site.call', { key, sub: other.key, method: 'info' })), 'NOT_ALLOWED')
  const site = (await owner.rpc.request('site.call', { key, method: 'query', args: ['site'], chain: [['latest', [1]]] })).items[0]
  const files = await owner.rpc.request('site.call', { key, sub: site.pages, method: 'query', args: ['file'], chain: [['latest', [10]]] })
  const index = files.items.find((f) => f.name === 'index.html')
  t.ok(index.data instanceof Uint8Array, 'a bytes field arrives as bytes')
  t.is(b4a.toString(index.data), '<h1>hi</h1>')

  // restart: same folder, the answer is still there
  await owner.rpc.request('close')
  const again = await engine(t, { dir: owner.dir })
  await again.rpc.request('site.open', { key })
  t.is((await again.rpc.request('site.call', { key, method: 'info' })).key, key)
})

test('live views and events cross the boundary, from another engine', async (t) => {
  const { owner, key } = await published(t)
  await owner.rpc.request('site.consent', { key, allow: true })
  const ann = await owner.rpc.request('site.call', { key, method: 'put', args: ['profile', { name: 'ann' }] })

  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key })
  await visitor.rpc.request('site.consent', { key, allow: true })
  // straight after opening: an answer, maybe incomplete, never an error (types may still be on their way)
  const first = await visitor.rpc.request('site.call', { key, method: 'query', args: ['profile'], chain: [['latest', [10]]] })
  t.ok(Array.isArray(first.items) && typeof first.complete === 'boolean')

  const { id } = await visitor.rpc.request('site.live', { key, args: ['profile'], opts: { limit: 10 } })
  t.ok(await eventually(() => liveEvents(visitor, id).some((d) => d.items.some((r) => r.id === ann.id)), 15000), 'the live view gets the owner\'s record')

  const { id: changes } = await owner.rpc.request('site.on', { key, event: 'change' })
  const { id: ownerLive } = await owner.rpc.request('site.live', { key, args: ['profile'] })
  const bob = await visitor.rpc.request('site.call', { key, method: 'put', args: ['profile', { name: 'bob' }] })
  t.ok(await eventually(() => liveEvents(owner, ownerLive).some((d) => d.items.some((r) => r.id === bob.id)), 15000), 'SC-004: the visitor\'s record reaches the owner\'s live view')
  t.ok(await eventually(() => owner.events.some((ev) => ev.event === 'event' && ev.data.id === changes && ev.data.data.records.some((r) => r.id === bob.id)), 15000), 'and a change event')
  t.is(await codeOf(owner.rpc.request('site.on', { key, event: 'logs' })), 'NOT_ALLOWED', 'events a site may not hear')

  // off stops one; site.close stops the rest
  await visitor.rpc.request('site.off', { id })
  const before = liveEvents(visitor, id).length
  await visitor.rpc.request('site.call', { key, method: 'edit', args: [bob.id, { name: 'bobby' }] })
  await sleep(1000)
  t.is(liveEvents(visitor, id).length, before, 'nothing after off')
  await owner.rpc.request('site.close', { key })
  t.is(await codeOf(owner.rpc.request('site.call', { key, method: 'info' })), 'NOT_FOUND', 'closed: open it again first')
})

test('a type the space never had: INVALID_TYPE once complete, not before', async (t) => {
  const { key } = await published(t)
  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key })
  await visitor.rpc.request('site.consent', { key, allow: true })
  const read = () => visitor.rpc.request('site.call', { key, method: 'query', args: ['nosuch'], chain: [['latest', [5]]] }).then((r) => r, (err) => err)
  const r = await read()
  if (!(r instanceof Error)) t.alike(r, { items: [], complete: false }, 'before the space is complete: empty and incomplete')
  t.ok(await eventually(async () => (await read()).code === 'INVALID_TYPE', 15000), 'then INVALID_TYPE')
})
