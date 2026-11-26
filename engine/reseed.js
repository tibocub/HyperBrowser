// Reseeding I2P through our own peers (regular identities only, on the regular network): on a topic of its own,
// each engine hands what the shell gave it (its router's newest router records, the I2P DHT nodes it knows) and
// takes the others'. The shell decides what to use: never one peer's records alone (an eclipse), always beside
// I2P's official reseed. Records are only checked for shape here; the router checks their signatures.
import crypto from 'hypercore-crypto'
import FramedStream from 'framed-stream'
import b4a from 'b4a'

const TOPIC = crypto.hash(b4a.from('hyperbrowser/i2p-reseed'))
const MAX_RECORDS = 100
const MAX_RECORD = 4096 // a router record is ~1 KB
const MAX_NODES = 64
const FRAME_MAX = MAX_RECORDS * (MAX_RECORD * 4 / 3 + 128) + 8192
const LINGER_MS = 30000
const RECORD_NAME = /^routerInfo-[A-Za-z0-9~-]{44}\.dat$/
const NODE = /^[a-z2-7]{52}:\d{1,5}$/

/**
 * @typedef {{ name: string, data: string }} RouterRecord a netDb file: its name, its bytes in base64
 * @typedef {{ records: RouterRecord[], nodes: string[] }} Share
 */

/**
 * A peer's message, kept only if it is well formed (else null).
 * @param {unknown} m
 * @returns {Share | null}
 */
export function checkShare (m) {
  if (!m || typeof m !== 'object') return null
  const { records, nodes } = /** @type {Record<string, unknown>} */ (m)
  if (!Array.isArray(records) || !Array.isArray(nodes) || records.length > MAX_RECORDS || nodes.length > MAX_NODES) return null
  const ok = records.every((r) => r && typeof r.name === 'string' && RECORD_NAME.test(r.name) && typeof r.data === 'string' && r.data.length <= MAX_RECORD * 4 / 3 + 4 && /^[A-Za-z0-9+/=]*$/.test(r.data))
  if (!ok || !nodes.every((n) => typeof n === 'string' && NODE.test(n))) return null
  return { records: /** @type {RouterRecord[]} */ (records), nodes: /** @type {string[]} */ (nodes) }
}

/**
 * @param {{ bootstrap?: Array<{ host: string, port: number }>, emit: (event: string, data: object) => void }} opts
 *   emit: 'i2p.reseed' { peer, records, nodes } for each peer heard
 */
export function reseed ({ bootstrap, emit }) {
  /** @type {import('hyperswarm') | null} */
  let swarm = null
  /** @type {Share} */
  let share = { records: [], nodes: [] }
  let closed = false

  /** @param {import('hyperswarm').Connection} conn */
  function onConnection (conn) {
    conn.on('error', () => {})
    const framed = new FramedStream(conn)
    framed.on('error', () => {})
    const done = setTimeout(() => conn.destroy(), LINGER_MS)
    conn.on('close', () => clearTimeout(done))
    framed.write(b4a.from(JSON.stringify(share)))
    framed.once('data', (/** @type {Uint8Array} */ buf) => {
      let m = null
      if (buf.byteLength <= FRAME_MAX) try { m = checkShare(JSON.parse(b4a.toString(buf))) } catch {}
      if (m) emit('i2p.reseed', { peer: b4a.toString(conn.remotePublicKey, 'hex'), ...m })
      setTimeout(() => conn.destroy(), 1000) // ours had time to go
    })
  }

  return {
    /** What to hand peers from now on; joins the topic the first time. @param {Share} next */
    async set (next) {
      share = { records: next.records.slice(0, MAX_RECORDS), nodes: next.nodes.slice(0, MAX_NODES) }
      if (swarm || closed) return
      const Hyperswarm = (await import('hyperswarm')).default // never in an anonymous identity's engine
      if (closed) return
      swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
      swarm.on('connection', onConnection)
      swarm.join(TOPIC, { server: true, client: true })
    },
    async close () {
      closed = true
      if (swarm) await swarm.destroy().catch(() => {})
    }
  }
}
