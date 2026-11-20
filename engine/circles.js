// Shell-only calls: no page reaches circles.* or holding.*.
import fs from 'fs'
import path from 'path'

export const GB = 1e9 // hypergraph's 1 GB share is 1e9 bytes
const LIST = 'hyperbrowser/circles' // { [circle key]: true }: hg.spaces() can't tell which spaces are circles until they are open
const CONTACTS = 'hyperbrowser/contacts'
const NAME_TYPE = 'circle-name' // a rename: the latest one by the owner or an admin (hypergraph has no rename)
/** @type {import('./types.js').TypeDeclarations} */
const TYPES = { [NAME_TYPE]: { fields: { name: 'string' } } }
const WEEK = 7 * 24 * 3600 * 1000
const MAX = 50 // hypergraph refuses the 51st (CIRCLE_FULL)
const MIN_SHARE = 0.1 * GB
const SPARE = 2 * GB
const RECORDS = 1000 // hg/holder records read, newest first (as hypergraph does)
const CHECK = 30000 // share full: hypergraph tells no event for it
/** @type {Set<string | null>} */
const DECIDERS = new Set(['owner', 'admin'])

/**
 * @typedef {import('./types.js').Space} Space
 * @typedef {import('./types.js').HgRecord} HgRecord
 * @typedef {import('./types.js').Params} Params
 * @typedef {{ key: string, name: string, members: number, holders: number, total: number | null, role: string | null }} Circle
 */

/** @param {string} code @param {string} message */
const error = (code, message) => Object.assign(new Error(message), { code })
const noop = () => {}
/** @param {unknown} n @returns {n is string} */
const validName = (n) => typeof n === 'string' && n.trim().length > 0 && n.length <= 64 && !/[\x00-\x1f\x7f]/.test(n) // eslint-disable-line no-control-regex

// The newest record of each device since the person's newest `left`, as hypergraph's lib/holding.js reads them.
/** @param {HgRecord[]} records */
export function holdsFrom (records) {
  const out = new Set()
  const cut = new Set()
  const seen = new Set()
  for (const r of records) {
    if (cut.has(r.author)) continue
    if (r.left) { cut.add(r.author); continue }
    if (seen.has(r.device)) continue
    seen.add(r.device)
    if (r.on) out.add(r.author)
  }
  return out
}

// Only current owners and admins count: a removed admin's rename stops counting.
/**
 * @param {HgRecord[]} records
 * @param {Set<string>} deciders
 * @param {string} made the name it was made with
 * @returns {string}
 */
export function pickName (records, deciders, made) {
  const r = records.find((x) => validName(x.name) && deciders.has(x.author))
  return r ? /** @type {string} */ (r.name) : made
}

/**
 * @param {{ full: boolean }} last
 * @param {{ on: boolean, used: number, bytes: number }} holding
 */
export function shareFull ({ full }, { on, used, bytes }) {
  if (!on) return { full: false, tell: false }
  if (used >= bytes) return { full: true, tell: !full }
  return { full: full && used >= 0.9 * bytes, tell: false }
}

/**
 * The shell's circles.* and holding.* calls.
 * @param {object} opts
 * @param {import('./types.js').SwarmFS} opts.sfs
 * @param {string} opts.dir
 * @param {{ hyperbrowser (n: { id: string, text: string }): Promise<unknown> }} opts.notes
 * @param {import('./types.js').Emit} opts.emit
 */
export function circles ({ sfs, dir, notes, emit }) {
  const hg = sfs.hg
  const FILE = path.join(dir, 'circles.json')
  let local = { set: false, full: false }
  try { local = { ...local, ...JSON.parse(fs.readFileSync(FILE, 'utf-8')) } } catch {}
  /** @type {Promise<unknown>} */
  let writing = Promise.resolve()
  let closed = false
  /** @type {Map<string, () => void>} */
  const watched = new Map()
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null

  const saveLocal = () => fs.promises.writeFile(FILE, JSON.stringify(local)).catch(noop)
  const changed = () => {
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(() => emit('circles', {}), 300)
  }
  hg.on('settings', changed)
  hg.on('copies', changed)
  const check = setInterval(() => full().catch(noop), CHECK)
  check.unref?.()

  /** @returns {Promise<Record<string, true>>} */
  const listed = async () => (await hg.settings())[LIST] || {}
  /** @param {string} key @param {boolean} on */
  function setListed (key, on) {
    const write = writing.then(async () => {
      const l = await listed()
      if (on) l[key] = true
      else delete l[key]
      await hg.setSetting(LIST, l)
    })
    writing = write.catch(noop)
    return write
  }

  /** @param {unknown} key */
  async function circle (key) {
    if (typeof key !== 'string' || !(await listed())[key]) throw error('NOT_FOUND', 'not one of your circles')
    let s
    try { s = hg.space(key) } catch { throw error('NOT_FOUND', 'this circle is not on this computer') }
    await s.ready()
    if (!s.circle) throw error('NOT_FOUND', 'not a circle')
    watch(s)
    return s
  }

  /** @param {Space} s */
  function watch (s) {
    if (watched.has(s.key)) return
    s.on('status', changed)
    s.on('members', changed)
    watched.set(s.key, () => { s.off('status', changed); s.off('members', changed) })
  }

  const me = () => hg.identity.publicKey
  /** @param {Space} s */
  const roleOf = (s) => s.getRole(me())
  /** @param {Space} s @param {string} what */
  async function decider (s, what) {
    if (!DECIDERS.has(await roleOf(s))) throw error('NOT_ALLOWED', 'only the owner and admins ' + what)
  }

  /** @param {Space} s */
  async function nameOf (s) {
    try {
      const deciders = new Set((await s.members()).filter((m) => DECIDERS.has(m.role)).map((m) => m.identity))
      return pickName((await s.query(NAME_TYPE).latest(20)).items, deciders, s.name ?? '')
    } catch { return s.name ?? '' } // a circle made before its types: no rename yet
  }

  async function free () {
    const { bavail, bsize } = await fs.promises.statfs(dir)
    return bavail * bsize
  }

  async function holding () {
    return { ...hg.holding(), free: await free() }
  }

  /** @param {Params} p */
  async function setHolding ({ on, bytes }) {
    if (typeof on !== 'boolean') throw error('INVALID_PARAMS', 'holding.set needs { on: true | false }')
    if (bytes !== undefined) {
      if (!Number.isSafeInteger(bytes) || bytes < MIN_SHARE) throw error('INVALID_PARAMS', 'At least 0.1 GB')
      const h = await holding()
      const room = h.free + h.used - SPARE
      if (bytes > room) throw error('TOO_BIG', `Only ${Math.max(0, Math.floor(room / GB * 10) / 10)} GB free on this disk`)
    }
    await hg.setHolding({ on, bytes })
    local.set = true
    await saveLocal()
    await full()
    changed()
    return holding()
  }

  async function firstCircle () {
    if (local.set || hg.holding().on) return
    const bytes = hg.holding().bytes
    if (bytes > (await free()) - SPARE) return
    await hg.setHolding({ on: true, bytes })
    local.set = true
    await saveLocal()
  }

  async function full () {
    if (closed) return
    const next = shareFull(local, hg.holding())
    if (next.full !== local.full) {
      local.full = next.full
      await saveLocal()
    }
    if (next.tell) await notes.hyperbrowser({ id: 'share-full-' + Date.now(), text: 'Your share for your circles is full: the oldest copies you keep are dropped first. Give more room in Configuration.' })
  }

  async function list () {
    /** @type {Circle[]} */
    const out = []
    for (const key of Object.keys(await listed())) {
      let s
      try { s = await circle(key) } catch { continue } // left on another device, not here yet
      const st = s.status()
      out.push({ key, name: await nameOf(s), members: /** @type {number} */ (st.members), holders: /** @type {number} */ (st.holders), total: st.total ?? null, role: await roleOf(s) })
    }
    return out
  }

  /** @param {Params} p */
  async function create ({ name }) {
    if (!validName(name)) throw error('INVALID_PARAMS', "a circle's name is 1 to 64 characters")
    const s = await hg.createCircle({ name: name.trim() })
    await s.declareTypes(TYPES)
    await setListed(s.key, true)
    await firstCircle()
    changed()
    return { key: s.key, name: name.trim(), holding: await holding() }
  }

  /** @param {Params} p */
  async function join ({ link }) {
    if (typeof link !== 'string' || !link.startsWith('hg:')) throw error('INVALID_PARAMS', 'an invite link (hg:...)')
    const before = new Set(hg.spaces().map((x) => x.key))
    const s = await hg.redeemInvite(link)
    await s.ready()
    if (!s.circle) {
      if (!before.has(s.key)) await sfs.leave(s.key).catch(noop)
      throw error('NOT_ALLOWED', 'this link is not an invite to a circle')
    }
    await setListed(s.key, true)
    await firstCircle()
    changed()
    return { key: s.key, name: await nameOf(s), holding: await holding() }
  }

  /** @param {Params} p */
  async function members ({ key }) {
    const s = await circle(key)
    const contacts = (await hg.settings())[CONTACTS] || {}
    /** @type {HgRecord[]} */
    let records = []
    try { records = (await s.query('hg/holder').latest(RECORDS)).items } catch {}
    const holds = holdsFrom(records)
    if (hg.holding().on) holds.add(me())
    // a circle's members also have share and used (hypergraph's type leaves them out)
    return /** @type {Array<Awaited<ReturnType<Space['members']>>[number] & { share?: number | null, used?: number | null }>} */ (await s.members()).filter((m) => m.role && !m.removed && !m.banned).map((m) => ({
      identity: m.identity,
      name: contacts[m.identity]?.name || '', // the shell shows a short key for someone not a contact
      role: m.role,
      you: !!m.you,
      holds: holds.has(m.identity),
      share: m.share ?? null,
      used: m.used ?? null
    }))
  }

  /** @param {Params} p */
  async function invite ({ key }) {
    const s = await circle(key)
    await decider(s, 'invite people to a circle')
    if (/** @type {number} */ (s.status().members) >= MAX) throw error('CIRCLE_FULL', `This circle is full (${MAX})`)
    const expires = Date.now() + WEEK
    return { link: await s.createInvite({ role: 'member', uses: 1, expires }), expires }
  }

  /** @param {Params} p */
  async function rename ({ key, name }) {
    if (!validName(name)) throw error('INVALID_PARAMS', "a circle's name is 1 to 64 characters")
    const s = await circle(key)
    await decider(s, 'rename a circle')
    await s.put(NAME_TYPE, { name: name.trim() })
    changed()
    return true
  }

  /** @param {Params} p */
  async function setRole ({ key, identity, role }) {
    if (role !== 'admin' && role !== 'member') throw error('INVALID_PARAMS', 'admin or member')
    const s = await circle(key)
    await s.setRole(identity, role)
    changed()
    return true
  }

  /** @param {Params} p */
  async function remove ({ key, identity }) {
    const s = await circle(key)
    await s.removeRole(identity)
    changed()
    return true
  }

  /** @param {Params} p */
  async function leave ({ key }) {
    await circle(key)
    watched.get(key)?.()
    watched.delete(key)
    await sfs.leave(key)
    await setListed(key, false)
    changed()
    return true
  }

  /** @param {string} method @param {Params} [p] */
  async function call (method, p = {}) {
    switch (method) {
      case 'circles.list': return list()
      case 'circles.create': return create(p)
      case 'circles.join': return join(p)
      case 'circles.members': return members(p)
      case 'circles.invite': return invite(p)
      case 'circles.rename': return rename(p)
      case 'circles.setRole': return setRole(p)
      case 'circles.remove': return remove(p)
      case 'circles.leave': return leave(p)
      case 'holding.get': return holding()
      case 'holding.set': return setHolding(p)
      default: throw error('UNKNOWN_METHOD', 'unknown method ' + method)
    }
  }

  function close () {
    closed = true
    clearInterval(check)
    clearTimeout(timer)
    hg.off('settings', changed)
    hg.off('copies', changed)
    for (const stop of watched.values()) stop()
    watched.clear()
  }

  return { call, close }
}
