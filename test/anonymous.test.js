// An anonymous identity's engine (transport 'i2p'), over hypergraph's SAM stand-in, no router: it opens over I2P, its
// contacts aren't findable unless turned on (finding works over I2P, not Hyperswarm), and it gives the DHT nodes it met.
import test from 'brittle'
import sam from 'hypergraph/test/next/net/_sam.js'
import dht from 'hypergraph/lib/i2p/dht.js'
import { engine } from './helpers.js'

async function i2p (t) {
  const router = await sam.standIn()
  const boot = await dht.I2PDHT.open({ sam: { port: router.port }, ephemeral: false, firewalled: false })
  await boot.ready()
  t.teardown(async () => { await boot.destroy(); await router.close() }, { order: 2000 })
  return { port: router.port, bootstrap: [boot.bootstrapAddress] }
}

test('anonymous engine: opens over I2P; contacts not findable by default, findable when turned on; DHT nodes given', { timeout: 90000 }, async (t) => {
  const e = await engine(t, { transport: 'i2p', sam: await i2p(t), deviceName: '' })
  const me = await e.rpc.request('contacts.me')
  t.is(me.findable, false, 'not findable: announcing would tell when it is online')
  await e.rpc.request('contacts.setMe', { findable: true })
  t.is((await e.rpc.request('contacts.me')).findable, true)
  const { nodes } = await e.rpc.request('i2p.nodes')
  t.ok(Array.isArray(nodes) && nodes.length >= 1, 'the DHT nodes it met')
  const { devices } = await e.rpc.request('devices.list')
  t.ok(devices.every((/** @type {{ name: string }} */ d) => d.name === ''), 'no computer name')
})
