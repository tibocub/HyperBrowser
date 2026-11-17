// spec 022: names.resolve, the shell's call resolving name@authority through HyperDNS (an authority made by
// another person's hypergraph on the test's DHT), and its errors.
import test from 'brittle'
import testing from 'hypergraph/testing'
import hyperdns from 'hyperdns'
import { engine, codeOf } from './helpers.js'

const SITE = 'y'.repeat(52)

async function authority (t, records) {
  const hg = await testing.open(t)
  const a = await hyperdns.createAuthority('bobsDNS', { hg })
  for (const [name, type, value] of records) await a.dns.publish(name, { type, value })
  return a
}

test('names.resolve: name@link reaches an authority not joined yet; then its name works', async (t) => {
  const e = await engine(t)
  const a = await authority(t, [['blog', 'hyper', 'hyper://' + SITE], ['old', 'hyper', 'hg:' + SITE]])

  const r = await e.rpc.request('names.resolve', { address: 'blog@' + a.link })
  t.is(r.key, SITE, 'hyper://<key>: the key')
  t.is(r.authority, a.space.key)
  t.is((await e.rpc.request('names.resolve', { address: 'blog@bobsDNS' })).key, SITE, 'held now: by name')
  t.is((await e.rpc.request('names.resolve', { address: 'old@bobsDNS' })).key, 'hg:' + SITE, 'an hg: link as is')
})

test('names.resolve: each failure has its own code', async (t) => {
  const e = await engine(t)
  const a = await authority(t, [['ip', 'A', '1.2.3.4']])
  await e.rpc.request('names.resolve', { address: 'ip@' + a.link }).catch(() => {}) // joins it

  t.is(await codeOf(e.rpc.request('names.resolve', { address: 'blog@nowhere' })), 'UNKNOWN_AUTHORITY')
  t.is(await codeOf(e.rpc.request('names.resolve', { address: 'nope@bobsDNS' })), 'UNKNOWN_NAME')
  t.is(await codeOf(e.rpc.request('names.resolve', { address: 'ip@bobsDNS' })), 'NOT_A_SITE')
  t.is(await codeOf(e.rpc.request('names.resolve', { address: 'blog@hg:' + SITE, timeout: 2000 })), 'UNAVAILABLE', 'nobody holds it')
  t.is(await codeOf(e.rpc.request('names.resolve', { address: 42 })), 'INVALID_PARAMS')
  t.is(await codeOf(e.rpc.request('names.resolve', { address: 'no-at-sign' })), 'INVALID_PARAMS')
})
