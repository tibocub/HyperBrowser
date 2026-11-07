// The engine: one entry, start(ipc), over a duplex byte stream (specs/001-engine/contracts/protocol.md).
// Bare modules only, no Electron or Pear calls; its config arrives as the 'init' message. One SwarmFS,
// so one hypergraph: one identity, one swarm, every site. A site reaches its own space only, through
// hg.scope(); the shell names the site, never the page.
import fs from 'fs'
import path from 'path'
import { SwarmFS } from 'swarmfs'
import { connect, VERSION } from './protocol.js'
import { parseManifest, isDynamic, sitePath } from './manifest.js'

const ANSWERS = 'hyperbrowser/identity' // setting: { [site key]: true | false }, on every device of the person
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/ // z32 of 32 bytes
// Calls of hypergraph's site handle a page may make; addProtocol and memberConnections can't cross.
const CALLS = new Set(['put', 'get', 'edit', 'del', 'query', 'linked', 'count', 'sum', 'members', 'decisions', 'tags',
  'relate', 'unrelate', 'edges', 'tag', 'untag', 'getByTag', 'getRole', 'setRole', 'removeRole', 'defineRole', 'roles',
  'moderateAction', 'report', 'reports', 'createInvite', 'revokeInvite', 'createSubspace', 'subspaces', 'redemptions',
  'peers', 'status', 'isComplete', 'completeFrom', 'types'])
const FILTERS = new Set(['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice'])
const INFO = ['key', 'name', 'parent', 'private', 'typesVersion', 'history', 'helpers']

const error = (code, message) => Object.assign(new Error(message), { code })

export function start (ipc) {
  let sfs = null
  let starting = null
  let timer = null
  let last = Date.now()
  let closing = null
  let nextSub = 1
  let answering = Promise.resolve()
  let syncing = null
  const sites = new Map() // key -> { site, manifest, scope: Promise<Scope> | null }
  const subs = new Map() // id -> { key, stop }
  let closed
  const done = new Promise((resolve) => { closed = resolve })

  const rpc = connect(ipc, { handle, onmessage: () => { last = Date.now() }, onclose: () => shutdown('closed') })

  async function handle (method, p) {
    if (method === 'init') return init(p)
    if (method === 'ping') return true
    if (method === 'close') {
      await shutdown('close')
      return true
    }
    if (!sfs) throw error('NOT_READY', 'send init first')
    switch (method) {
      case 'site.publish': return publish(p)
      case 'site.open': return open(p)
      case 'site.read': return read(p)
      case 'site.consent': return consent(p)
      case 'site.call': return call(p)
      case 'site.live': return live(p)
      case 'site.on': return listen(p)
      case 'site.off': return off(p)
      case 'site.close': return closeSite(keyOf(p))
      default: throw error('UNKNOWN_METHOD', 'unknown method ' + method)
    }
  }

  async function init ({ dir, bootstrap, heartbeat, appStorageMax }) {
    if (sfs || starting) throw error('ALREADY', 'already initialised')
    if (typeof dir !== 'string' || !dir) throw error('INVALID_PARAMS', 'init needs { dir }')
    starting = SwarmFS.open(dir, { bootstrap, appStorageMax })
    starting.catch(() => { starting = null }) // a failed init may be sent again
    sfs = await starting
    syncing = sfs.sync().catch(() => {}) // the owner's published folders follow their edits; owned sites keep uploads
    if (heartbeat) {
      timer = setInterval(() => { if (Date.now() - last > 3 * heartbeat) shutdown('heartbeat') }, heartbeat)
    }
    return { identity: sfs.hg.identity.publicKey, version: VERSION }
  }

  // --- sites ---

  async function publish ({ folder }) {
    if (typeof folder !== 'string' || !folder) throw error('INVALID_PARAMS', 'site.publish needs { folder }')
    const full = path.resolve(folder)
    let text
    try { text = await fs.promises.readFile(path.join(full, 'site.json'), 'utf-8') } catch { throw error('NO_MANIFEST', `no site.json in ${full}`) }
    const manifest = parseManifest(text)
    for (const p of [manifest.entry, manifest.icon].filter(Boolean)) {
      try { await fs.promises.stat(path.join(full, ...p.split('/'))) } catch { throw error('INVALID_MANIFEST', `site.json names ${p}, which isn't in the folder`) }
    }
    // a folder published before is linked to its site's pages (SwarmFS keeps the links): same site, same key
    const link = (await sfs.links()).find((l) => l.path === full)
    if (link) return { key: sfs.hg.space(link.space).parent, created: false, manifest }
    const site = await sfs.createSite(manifest.title)
    await site.makePublic()
    await site.publish(full)
    return { key: site.key, created: true, manifest }
  }

  async function open ({ key, timeout = 30000 }) {
    if (typeof key !== 'string') throw error('INVALID_PARAMS', 'site.open needs { key }')
    let site
    if (key.startsWith('hg:')) site = await sfs.visit(key, { timeout }) // an invite or a public link
    else {
      if (!KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
      let held = true
      try { sfs.hg.space(key) } catch { held = false }
      site = held ? await sfs.site(key, { timeout }) : await sfs.visit('hg:' + key, { timeout }) // a public site's link is its key
    }
    const manifest = parseManifest(await site.read('site.json', { timeout }).catch((err) => {
      throw err.code === 'NOT_FOUND' ? error('NO_MANIFEST', 'this site has no site.json') : err
    }))
    const known = sites.get(site.key)
    if (known) known.manifest = manifest
    else sites.set(site.key, { site, manifest, scope: null })
    return { key: site.key, manifest, dynamic: isDynamic(manifest) }
  }

  async function read ({ key, path: p, timeout }) {
    const s = opened(keyOf({ key }))
    const clean = p === '' || p === '/' ? s.manifest.entry : sitePath(p)
    if (!clean) throw error('NOT_FOUND', `no page ${p}`)
    return { bytes: await s.site.read(clean, { timeout }), path: clean }
  }

  function keyOf ({ key }) {
    if (typeof key !== 'string') throw error('INVALID_PARAMS', 'needs { key }')
    if (!KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
    return key
  }

  function opened (key) {
    const s = sites.get(key)
    if (!s) throw error('NOT_FOUND', 'open the site first (site.open)')
    return s
  }

  // --- the site API: hypergraph's site handle, after the person said yes ---

  async function consent ({ key, allow }) {
    key = keyOf({ key })
    if (typeof allow !== 'boolean') throw error('INVALID_PARAMS', 'site.consent needs { allow: true | false }')
    // one read-and-write at a time: two answers at once would each drop the other's
    const write = answering.then(async () => {
      const answers = (await sfs.hg.settings())[ANSWERS] || {}
      await sfs.hg.setSetting(ANSWERS, { ...answers, [key]: allow })
    })
    answering = write.catch(() => {})
    await write
    if (!allow) await release(key)
    return true
  }

  async function target ({ key, sub }) {
    const s = opened(keyOf({ key }))
    if (!isDynamic(s.manifest)) throw error('NOT_ALLOWED', 'a static site has no API')
    const answer = ((await sfs.hg.settings())[ANSWERS] || {})[key]
    if (answer === false) throw error('NOT_ALLOWED', 'the person said no to this site using their identity')
    if (answer !== true) throw error('NEEDS_CONSENT', 'ask the person first (site.consent)')
    if (!s.scope) {
      s.scope = sfs.hg.scope(key, { identity: 'main' })
      s.scope.catch(() => { s.scope = null })
    }
    const scope = await s.scope
    return sub === undefined || sub === null ? scope : scope.subspace(sub)
  }

  function query (t, args, chain = []) {
    if (!Array.isArray(args) || !Array.isArray(chain)) throw error('INVALID_PARAMS', 'args and chain are lists')
    let q = t.query(...args)
    for (const step of chain) {
      if (!Array.isArray(step) || !FILTERS.has(step[0])) throw error('INVALID_PARAMS', 'a query step is one of ' + [...FILTERS].join(', '))
      q = q[step[0]](...(step[1] || []))
    }
    return q
  }

  async function call ({ key, sub, method, args = [], chain }) {
    if (method !== 'info' && !CALLS.has(method)) throw error('UNKNOWN_METHOD', `a site may not call ${method}`)
    if (!Array.isArray(args)) throw error('INVALID_PARAMS', 'args is a list')
    const t = await target({ key, sub })
    if (method === 'info') {
      const out = { identity: t.identity.publicKey }
      for (const name of INFO) out[name] = t[name] ?? null
      return plain(out)
    }
    if (method === 'query') {
      const steps = Array.isArray(chain) ? chain : []
      const end = steps.at(-1)
      if (!end || end[0] !== 'latest') throw error('INVALID_PARAMS', 'a query ends with latest')
      return plain(await query(t, args, steps.slice(0, -1)).latest(...(end[1] || [])))
    }
    await t.ready() // sync getters (subspaces, status, types) need the space's decisions
    return plain(await t[method](...args))
  }

  async function live ({ key, sub, args = [], chain = [], opts }) {
    const t = await target({ key, sub })
    const q = query(t, args, chain)
    const id = nextSub++
    const stop = q.live((r) => rpc.emit('live', { id, items: plain(r.items), complete: r.complete }), opts)
    subs.set(id, { key, stop })
    return { id }
  }

  async function listen ({ key, sub, event }) {
    const t = await target({ key, sub })
    const id = nextSub++
    const fn = (data) => rpc.emit('event', { id, data: plain(data) })
    t.on(event, fn) // NOT_ALLOWED for events a site may not hear
    subs.set(id, { key, stop: () => t.off(event, fn) })
    return { id }
  }

  function off ({ id }) {
    const s = subs.get(id)
    if (s) {
      subs.delete(id)
      s.stop()
    }
    return true
  }

  async function release (key) {
    for (const [id, s] of subs) if (s.key === key) off({ id })
    const s = sites.get(key)
    if (s?.scope) {
      const scope = s.scope
      s.scope = null
      await scope.then((h) => h.close(), () => {})
    }
  }

  async function closeSite (key) {
    await release(key)
    sites.delete(key)
    return true
  }

  // --- lifecycle ---

  function shutdown (reason) {
    if (!closing) {
      closing = (async () => {
        clearInterval(timer)
        if (reason !== 'closed') rpc.emit('closing', { reason })
        for (const key of [...sites.keys()]) await closeSite(key).catch(() => {})
        const opening = starting
        starting = null
        await syncing // a close() before sync() has started leaks its interval (requests-to-swarmfs F3)
        if (opening) await opening.then((s) => s.close(), () => {})
        sfs = null
        setTimeout(() => rpc.end(), 0) // after the reply to 'close'
        closed(reason)
      })()
    }
    return closing
  }

  return { closed: done }
}

// What crosses the boundary: plain data. A Space (createSubspace's result) becomes { key, name };
// any other object of a class, null.
function plain (value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map(plain)
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    return typeof value.key === 'string' ? { key: value.key, name: value.name ?? null } : null
  }
  const out = {}
  for (const k of Object.keys(value)) if (typeof value[k] !== 'function') out[k] = plain(value[k])
  return out
}
