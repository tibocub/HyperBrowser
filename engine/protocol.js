// The engine's message protocol (specs/001-engine/contracts/protocol.md): one JSON message per frame
// (framed-stream: a length prefix), every message stamped with the protocol version.
//   request: { v, id, method, params }   reply: { v, id, result } or { v, id, error: { code, message } }
//   event:   { v, event, data }
// Bytes travel as { $bytes: base64 }. Pure JS on Node and Bare: the shell, the engine and later
// react-native-bare-kit use this same file.
import FramedStream from 'framed-stream'
import b4a from 'b4a'
import { Duplex } from 'streamx'

export const VERSION = 1

const error = (code, message) => Object.assign(new Error(message), { code })

// onmessage: called for every message of this version (the engine's heartbeat counts them).
export function connect (stream, { handle = null, onEvent = null, onmessage = null, onclose = null } = {}) {
  const framed = new FramedStream(stream)
  const waiting = new Map()
  let next = 1

  framed.on('data', async (buf) => {
    let m
    try { m = JSON.parse(b4a.toString(buf)) } catch { return }
    if (!m || typeof m !== 'object') return
    if (m.v !== VERSION) {
      if (m.method) send({ id: m.id, error: { code: 'BAD_VERSION', message: `protocol ${VERSION} only, got ${m.v}` } })
      return
    }
    if (onmessage) onmessage()
    if (typeof m.method === 'string') {
      try {
        if (!handle) throw error('NOT_SUPPORTED', 'no requests here')
        const result = await handle(m.method, fromWire(m.params) || {})
        send({ id: m.id, result: result ?? null })
      } catch (err) {
        send({ id: m.id, error: { code: err.code || 'ERROR', message: err.message } })
      }
    } else if (typeof m.event === 'string') {
      if (onEvent) onEvent(m.event, fromWire(m.data))
    } else if (waiting.has(m.id)) {
      const w = waiting.get(m.id)
      waiting.delete(m.id)
      if (m.error) w.reject(error(m.error.code, m.error.message))
      else w.resolve(fromWire(m.result))
    }
  })
  framed.on('close', () => {
    for (const w of waiting.values()) w.reject(error('CLOSED', 'engine stream closed'))
    waiting.clear()
    if (onclose) onclose()
  })
  framed.on('error', () => {})

  function send (m) {
    if (!framed.destroyed) framed.write(b4a.from(JSON.stringify({ v: VERSION, ...toWire(m) })))
  }

  return {
    request (method, params = {}) {
      if (framed.destroyed) return Promise.reject(error('CLOSED', 'engine stream closed'))
      const id = next++
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        send({ id, method, params })
      })
    },
    emit (event, data) { send({ event, data }) },
    end () { framed.end() },
    destroy () { framed.destroy() },
    get destroyed () { return framed.destroyed }
  }
}

export function toWire (value) {
  if (value instanceof Uint8Array) return { $bytes: b4a.toString(value, 'base64') }
  if (Array.isArray(value)) return value.map(toWire)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) out[k] = toWire(value[k])
    return out
  }
  return value
}

export function fromWire (value) {
  if (Array.isArray(value)) return value.map(fromWire)
  if (value && typeof value === 'object') {
    if (typeof value.$bytes === 'string' && Object.keys(value).length === 1) return b4a.from(value.$bytes, 'base64')
    const out = {}
    for (const k of Object.keys(value)) out[k] = fromWire(value[k])
    return out
  }
  return value
}

// Two connected duplex streams: the CLI and the tests run start() on one end, exactly as the worker does.
export function pair () {
  const a = new Duplex({ write (data, cb) { b.push(data); cb() }, final (cb) { b.push(null); cb() }, predestroy () { b.destroy() } })
  const b = new Duplex({ write (data, cb) { a.push(data); cb() }, final (cb) { a.push(null); cb() }, predestroy () { a.destroy() } })
  return [a, b]
}
