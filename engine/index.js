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
const MINE = new Set(['mine.all', 'mine.set'])
const MINE_PREFIX = 'hyperbrowser/site/' // + key + '/' + name: a site's own settings
const FILTERS = new Set(['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice'])
const INFO = ['key', 'name', 'parent', 'private', 'typesVersion', 'history', 'helpers']
// A site no tab shows, not installed and not the person's own, is left this long after its last tab closes
// (specs/004-hosting): the same as hypergraph's grace for a closed space's topic, so a tab closed by
// mistake or a back-and-forth comes back without finding the site's peers again.
const GRACE = 5 * 60 * 1000

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
  const sites = new Map() // key -> { site, manifest, scope: Promise<Scope> | null, tabs }
  const leaving = new Map() // key -> timer: no tab shows it, left once the grace period is over
  const departing = new Map() // key -> the leave running
  let grace = GRACE
  let opening = 0
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
      case 'site.state': return state(p)
      case 'site.keep': return keep(p)
      case 'site.held': return held(p)
      case 'site.consent': return consent(p)
      case 'site.call': return call(p)
      case 'site.live': return live(p)
      case 'site.on': return listen(p)
      case 'site.off': return off(p)
      case 'site.close': return closeSite(keyOf(p))
      default: throw error('UNKNOWN_METHOD', 'unknown method ' + method)
    }
  }

  async function init ({ dir, bootstrap, heartbeat, appStorageMax, grace: g }) {
    if (sfs || starting) throw error('ALREADY', 'already initialised')
    if (typeof dir !== 'string' || !dir) throw error('INVALID_PARAMS', 'init needs { dir }')
    starting = SwarmFS.open(dir, { bootstrap, appStorageMax })
    starting.catch(() => { starting = null }) // a failed init may be sent again
    if (g !== undefined) grace = g
    sfs = await starting
    await sweep()
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
    if (link) {
      const key = sfs.hg.space(link.space).parent
      if (manifest.types) await (await sfs.site(key)).declareTypes(manifest.types) // types added since (additions only)
      return { key, created: false, manifest }
    }
    const site = await sfs.createSite(manifest.title, { types: manifest.types })
    if (manifest.public !== false) await site.makePublic()
    await site.publish(full)
    return { key: site.key, created: true, manifest }
  }

  async function open ({ key, timeout = 30000 }) {
    if (typeof key !== 'string') throw error('INVALID_PARAMS', 'site.open needs { key }')
    opening++
    try {
      return await openSite(key, timeout)
    } finally {
      opening--
    }
  }

  async function openSite (key, timeout) {
    stay(key)
    await Promise.all(departing.values()) // a site being left is joined again once it is gone
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
    stay(site.key)
    const known = sites.get(site.key)
    if (known) Object.assign(known, { manifest, tabs: known.tabs + 1 })
    else sites.set(site.key, { site, manifest, scope: null, tabs: 1 })
    return { key: site.key, manifest, dynamic: isDynamic(manifest) }
  }

  async function read ({ key, path: p, timeout }) {
    const s = opened(keyOf({ key }))
    const clean = p === '' || p === '/' ? s.manifest.entry : sitePath(p)
    if (!clean) throw error('NOT_FOUND', `no page ${p}`)
    return { bytes: await s.site.read(clean, { timeout }), path: clean }
  }

  // For the shell's toolbar: the site and its pages complete here, and the peers on the site's space.
  function state ({ key }) {
    const { site } = opened(keyOf({ key }))
    return { complete: site.space.isComplete() && site.pages.space.isComplete(), peers: site.space.peers().length }
  }

  // Install (true: kept whole here, never evicted, served; remembered) or back to the cache (SwarmFS F4).
  async function keep ({ key, keep, timeout }) {
    const { site } = opened(keyOf({ key }))
    if (typeof keep !== 'boolean') throw error('INVALID_PARAMS', 'site.keep needs { keep: true | false }')
    await site.keep(keep, { timeout })
    return { kept: keep }
  }

  // The bytes of the site on this device, and whether it is installed (SwarmFS F5). Reads every held
  // file record: the shell asks every few seconds, not more.
  async function held ({ key }) {
    const { site } = opened(keyOf({ key }))
    return { bytes: await site.held(), kept: await site.kept() }
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
    if (method !== 'info' && !MINE.has(method) && !CALLS.has(method)) throw error('UNKNOWN_METHOD', `a site may not call ${method}`)
    if (!Array.isArray(args)) throw error('INVALID_PARAMS', 'args is a list')
    const t = await target({ key, sub })
    if (MINE.has(method)) return mine(keyOf({ key }), method, args)
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

  // The person's own data for this site (spec 006 R2): one setting per name, on every device of the person,
  // never in the site's space. Another site's names are out of reach (the prefix is this site's key).
  async function mine (key, method, [name, value]) {
    const prefix = `${MINE_PREFIX}${key}/`
    if (method === 'mine.all') {
      const out = {}
      for (const [n, v] of Object.entries(await sfs.hg.settings())) if (n.startsWith(prefix) && v !== null) out[n.slice(prefix.length)] = v
      return out
    }
    if (typeof name !== 'string' || !name || name.length > 200) throw error('INVALID_PARAMS', 'mine.set needs a name of 1 to 200 characters')
    await sfs.hg.setSetting(prefix + name, value === undefined ? null : value)
    return true
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

  // One tab (or one site.open) done with the site; the last one starts the grace period.
  async function closeSite (key) {
    const s = sites.get(key)
    if (s && --s.tabs > 0) return true
    await release(key)
    sites.delete(key)
    if (s) leaveLater(key, s.site)
    return true
  }

  // --- hosting (specs/004-hosting): installed and own sites stay joined; the others only while shown ---

  async function hosted (site) {
    return (await site.kept()) || (await site.space.getRole(sfs.hg.identity.publicKey)) === 'owner'
  }

  function stay (key) {
    clearTimeout(leaving.get(key))
    leaving.delete(key)
  }

  function leaveLater (key, site) {
    stay(key)
    leaving.set(key, setTimeout(() => {
      leaving.delete(key)
      if (closing || sites.has(key)) return
      if (opening) return leaveLater(key, site) // a link being opened may be this site
      const left = hosted(site).then((h) => h || sfs.leave(key)).catch(() => {}).finally(() => departing.delete(key))
      departing.set(key, left)
    }, grace))
  }

  // At start: every site held here that isn't installed or the person's own is left (its cached files stay,
  // served again once it is opened). Not a site, or not readable at once: left alone.
  async function sweep () {
    for (const { key, parent } of sfs.hg.spaces()) {
      if (parent) continue
      const site = await sfs.site(key, { timeout: 0 }).catch(() => null)
      if (site && !(await hosted(site).catch(() => true))) await sfs.leave(key).catch(() => {})
    }
  }

  // --- lifecycle ---

  function shutdown (reason) {
    if (!closing) {
      closing = (async () => {
        clearInterval(timer)
        if (reason !== 'closed') rpc.emit('closing', { reason })
        for (const key of [...sites.keys()]) await release(key).catch(() => {})
        sites.clear()
        for (const key of [...leaving.keys()]) stay(key)
        await Promise.all(departing.values())
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
