// New items are found with space.since() cursors, never by dates:
// a message written offline and received late still notifies, and a clock far ahead silences nothing.
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import enc from 'hypergraph/lib/encodings.js'
import crypto from 'hypercore-crypto'
import { watch } from './manifest.js'

/**
 * @typedef {import('./types.js').HgRecord} HgRecord
 * @typedef {import('./types.js').Space} Space
 * @typedef {import('./types.js').Watch} Watch
 * @typedef {import('./types.js').CodedError} CodedError
 * @typedef {Record<string, any>} Settings The person's settings (hg.settings()), JSON by name.
 * @typedef {{ [log: string]: number }} Cursor A since() cursor.
 * @typedef {Watch & { id: string, place: string, popup: boolean }} Follow A page's follow, kept in the settings.
 * @typedef {Watch & { id?: string }} AnyWatch One of the app's watches, or a follow (it has an id).
 * @typedef {{ app: string, place: string, watches: AnyWatch[] }} Place
 * @typedef {object} Item A notification, as notifications.json keeps it.
 * @property {string} app
 * @property {string} place
 * @property {string} id the record's
 * @property {string} type
 * @property {string} author
 * @property {string} name
 * @property {string} text
 * @property {string | null} open
 * @property {number | null} stamp
 * @property {number} at
 * @property {string} log the record's log, for read marks
 * @property {number} seq
 * @property {string} [follow] the follow it came from
 * @property {boolean} [popup]
 * @typedef {{ total: number, byApp: Record<string, number>, byPlace: Record<string, number> }} Unread
 */

const PERMITS = 'hyperbrowser/permissions'
const APP = 'hyperbrowser/notify/app/'
const MUTE = 'hyperbrowser/notify/mute/'
const READ = 'hyperbrowser/notify/read/'
/** @param {string} app */
const INSTANCES = (app) => 'hyperbrowser/app/' + app + '/instances'
const FOLLOW = 'hyperbrowser/notify/follow/'
const FOLLOWS_MAX = 100
const CONTACTS = 'hyperbrowser/contacts'
const CONTACTS_APP = 'contacts' // HyperBrowser's own: allowed unless blocked, never asked
const HB_APP = 'hyperbrowser' // HyperBrowser's own news (a circles' share full), never blocked
const ITEMS_MAX = 200
const READ_LOGS = 64
const BATCH = 500
const QUIET = 1000
const HELD_MAX = 24 // chats kept online all the time (of hypergraph's 64 open spaces, 32 announced)
const TURN_N = 2
const CATCHUP = 10 // more new items at once than this: one summary, not a popup each (a space catching up)
const TEXT_MAX = 200
const NAME_MAX = 64

const noop = () => {}
/** @param {string} code @param {string} message */
const error = (code, message) => Object.assign(new Error(message), { code })
/**
 * Text from records is a stranger's: one line of plain text, cut to length.
 * @param {unknown} v
 * @param {number} n
 */
const clean = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) // eslint-disable-line no-control-regex

/** @param {Watch} w @param {HgRecord} r @param {string} me */
const matches = (w, r, me) => /** @type {string[]} */ ([]).concat(w.type).includes(r.type) && (!w.me || r[w.me] === me) && (!w.by || r.author === w.by) &&
  Object.entries(w.where || {}).every(([f, v]) => r[f] === v)
/** @param {Watch[]} watches */
const typesOf = (watches) => [...new Set(watches.flatMap((w) => /** @type {string[]} */ ([]).concat(w.type)))]

/**
 * The person's notifications: the watches of the apps they allowed, over the places those apps hold.
 * @param {object} opts
 * @param {import('./types.js').SwarmFS} opts.sfs
 * @param {string} opts.dir the engine folder (notifications.json: this device's cursors and items)
 * @param {import('./types.js').Emit} opts.emit
 * @param {number} [opts.turn] ms per turn of the places not held all the time
 * @param {() => void} [opts.counts] told when unread counts may have changed
 */
export function notifications ({ sfs, dir, emit, turn = 20000, counts = noop }) {
  const FILE = path.join(dir, 'notifications.json')
  const me = sfs.hg.identity.publicKey
  /** @type {{ cursors: Record<string, Cursor>, items: Item[], dots: Record<string, true> }} */
  let file = { cursors: {}, items: [], dots: {} }
  /** @type {Map<string, Cursor>} */
  const quiet = new Map() // place -> cursor: not complete here yet, its history isn't news
  /** @type {Map<string, () => void>} */
  const held = new Map()
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map()
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()
  let dirty = false
  let closed = false
  /** @type {Item[]} */
  let launching = []
  /** @type {ReturnType<typeof setTimeout> | null} */
  let launchTimer = null
  /** @type {Unread | null} */
  let last = null
  /** @type {string | null} */
  let chat = null
  /** @type {Place[]} */
  let ring = []
  let at = 0
  /** @type {string[]} */
  let turning = []
  /** @type {ReturnType<typeof setTimeout> | null} */
  let turnTimer = null
  /** @type {Set<string>} */
  let online = new Set()
  /** @type {Array<() => void>} */
  const pending = []
  /** @type {Map<string, Set<string>>} */
  const watching = new Map()
  /** @type {Promise<unknown>} */
  let writing = Promise.resolve() // follows: one read-and-write at a time

  /**
   * @template T
   * @param {() => T | Promise<T>} fn
   * @returns {Promise<T | null>}
   */
  const serial = (fn) => {
    const p = queue.then(() => closed ? null : fn())
    queue = p.catch(noop)
    return p
  }
  const settings = () => sfs.hg.settings()

  /** @param {Settings} s @param {string} app */
  const allowed = (s, app) => app === HB_APP || (app === CONTACTS_APP
    ? s[PERMITS]?.[app]?.notifications !== false
    : s[PERMITS]?.[app]?.notifications === true && !!s[APP + app])

  /** @param {Settings} s */
  function places (s) {
    /** @type {Place[]} */
    const out = []
    for (const n of Object.keys(s)) {
      if (!n.startsWith(APP)) continue
      const app = n.slice(APP.length)
      if (app === CONTACTS_APP || !allowed(s, app)) continue
      /** @type {Follow[]} */
      const follows = s[FOLLOW + app] || []
      for (const place of Object.keys(s[INSTANCES(app)] || {})) {
        /** @type {AnyWatch[]} */
        const watches = [...(s[n]?.watches || []), ...follows.filter((f) => f.place === place)]
        if (!watches.length) continue
        try { sfs.hg.space(place) } catch { continue }
        out.push({ app, place, watches })
      }
    }
    return out
  }

  /**
   * @param {Space} space
   * @param {Cursor} cursor
   * @param {string[]} types
   * @returns {Promise<{ records: HgRecord[], cursor: Cursor, full?: boolean }>}
   */
  async function since (space, cursor, types) {
    try {
      return await space.since(cursor, { types, limit: BATCH })
    } catch (err) {
      if (/** @type {CodedError} */ (err).code !== 'INVALID_TYPE') throw err // an instance not told of the app's newer types yet
      const r = await space.since(cursor, { limit: BATCH })
      return { ...r, records: r.records.filter((x) => types.includes(x.type)), full: r.records.length === BATCH }
    }
  }

  /** @param {Place} p @param {Settings} s */
  async function check ({ app, place, watches }, s) {
    const space = sfs.hg.space(place)
    const types = typesOf(watches)
    let cursor = file.cursors[place] ?? quiet.get(place) ?? null
    if (cursor === null) { // a first look (a first yes, a place just joined): from now on
      cursor = (await space.since(null)).cursor
      await space.ready()
      if (space.isComplete()) setCursor(place, cursor)
      else quiet.set(place, cursor)
      if (quiet.has(place)) wake(place, QUIET)
      return []
    }
    /** @type {HgRecord[]} */
    const records = []
    for (;;) {
      const r = await since(space, cursor, types)
      records.push(...r.records)
      cursor = r.cursor
      if (!(r.full ?? r.records.length === BATCH)) break
    }
    if (quiet.has(place)) { // its history is arriving: silent until complete once
      await space.ready()
      if (space.isComplete()) {
        quiet.delete(place)
        setCursor(place, cursor)
      } else {
        quiet.set(place, cursor)
        wake(place, QUIET) // soon again: what arrives once it is complete is news
      }
      return []
    }
    await gone(space, place)
    /** @type {Item[]} */
    const out = []
    let dot = false
    if (s[MUTE + place] !== true) {
      for (const r of records) {
        if (r.author === me || file.items.some((x) => x.id === r.id)) continue // own records; a repeat after a crash
        const w = watches.find((w) => !w.show && matches(w, r, me)) // the app's own watches first: a mention counts
        if (w) out.push(await item(app, place, w, r, s))
        if (w?.id || (!w && watches.some((w) => w.show === 'dot' && matches(w, r, me)))) dot = true // a follow: a dot, not a number
      }
    }
    if (dot && !file.dots[place]) {
      file.dots[place] = true
      dirty = true
    }
    file.items = [...out, ...file.items].slice(0, ITEMS_MAX)
    if (out.length) dirty = true
    pending.push(() => setCursor(place, cursor)) // saved after the items are told (a crash repeats one, never loses one)
    return out
  }

  /** @param {string} place @param {Cursor} cursor */
  function setCursor (place, cursor) {
    if (JSON.stringify(file.cursors[place]) === JSON.stringify(cursor)) return
    file.cursors[place] = cursor
    dirty = true
  }

  /** @param {Space} space @param {string} place */
  async function gone (space, place) {
    const s = await settings()
    const mine = file.items.filter((x) => x.place === place && !isRead(s, x))
    for (const x of mine) {
      /** @type {{ record?: HgRecord | null, deleted?: unknown }} */
      const { record, deleted } = await space.get(x.id, { timeout: 1000 }).catch(() => ({ record: undefined }))
      if ((record === null && deleted) || record?.hidden) drop((y) => y === x)
    }
  }

  /**
   * @param {string} app
   * @param {string} place
   * @param {AnyWatch} w
   * @param {HgRecord} r
   * @param {Settings} s
   * @returns {Promise<Item>}
   */
  async function item (app, place, w, r, s) {
    const { log, seq } = enc.idParts(r.id)
    return {
      app,
      place,
      id: r.id,
      type: r.type,
      author: r.author,
      name: await nameOf(place, r.author, s),
      text: clean(w.says ?? r[/** @type {string} */ (w.text)], TEXT_MAX), // shortcut: a record whose content was dropped here (budgets) has no text, the shell says "New message"
      open: w.open ? w.open.replace(/\{([^}]*)\}/g, (_, f) => encodeURIComponent(String((f === 'id' ? r.id : r[f]) ?? ''))) : null,
      stamp: r.stamp,
      at: Date.now(),
      log: b4a.toString(log, 'hex').slice(0, 16),
      seq,
      ...(w.id ? { follow: w.id, popup: w.popup === true } : {})
    }
  }

  /** @param {string} place @param {string} author @param {Settings} s */
  async function nameOf (place, author, s) {
    const known = s[CONTACTS]?.[author]?.name
    if (known) return clean(known, NAME_MAX)
    try {
      const { items } = await sfs.hg.space(place).query('profile').by(author).latest(1)
      return clean(items[0]?.name, NAME_MAX)
    } catch { return '' }
  }

  /** @param {Settings} s */
  function requests (s) {
    /** @type {Array<[string, import('./contacts.js').Contact]>} */
    const incoming = Object.entries(s[CONTACTS] || {}).filter(([, c]) => c?.state === 'incoming')
    const seen = file.cursors[CONTACTS_APP] || {}
    /** @type {Item[]} */
    const out = []
    if (allowed(s, CONTACTS_APP)) {
      for (const [id, c] of incoming) {
        if (seen[id]) continue
        out.push({ app: CONTACTS_APP, place: CONTACTS_APP, id, type: 'request', author: id, name: clean(c.name, NAME_MAX), text: 'wants to be your friend', open: null, stamp: c.at || null, at: Date.now(), log: id.slice(0, 16), seq: 0 })
      }
    }
    const now = new Set(incoming.map(([id]) => id))
    drop((x) => x.app === CONTACTS_APP && !now.has(x.author))
    file.items = [...out, ...file.items].slice(0, ITEMS_MAX)
    if (out.length) dirty = true
    lastContacts = JSON.stringify(s[CONTACTS] ?? null)
    pending.push(() => setCursor(CONTACTS_APP, Object.fromEntries([...now].map((id) => [id, 1]))))
    return out
  }

  // A closed space can't have news (records arrive only while it is open), and since() would open it: only the
  // places held (chats, the turn's) or open anyway (a page shows it, hypergraph's recent ones) are checked.
  /** @param {string[] | null} [only] */
  async function pass (only = null) {
    const s = await settings()
    /** @type {Item[]} */
    const fresh = []
    const open = new Set(sfs.hg.spaces().filter((x) => x.opened).map((x) => x.key))
    for (const p of places(s)) {
      if ((only && !only.includes(p.place)) || !(held.has(p.place) || open.has(p.place))) continue
      try { fresh.push(...await check(p, s)) } catch {}
    }
    if (!only) fresh.push(...requests(s))
    await tell(fresh)
  }

  /** @param {Item[]} list */
  const loud = (list) => list.filter((x) => !x.follow || x.popup).length

  /** @param {Item[]} fresh */
  async function tell (fresh) {
    if (launchTimer && fresh.length) launching.push(...fresh)
    else if (fresh.length) {
      emit('notify', { items: fresh.map((x) => view(x, null)), summary: loud(fresh) > CATCHUP ? { count: loud(fresh) } : null, unread: last = await unread() })
      counts()
    } else await changed()
    for (const fn of pending.splice(0)) fn()
    await save()
  }

  async function endLaunch () {
    launchTimer = null
    const all = launching.splice(0)
    if (all.length) emit('notify', { items: all.map((x) => view(x, null)), summary: loud(all) > 1 ? { count: loud(all) } : null, unread: last = await unread() })
  }

  async function changed () {
    counts() // a dot may have changed with no count
    const u = await unread()
    if (JSON.stringify(u) === JSON.stringify(last)) return
    last = u
    emit('notify', { items: [], summary: null, unread: u })
  }

  async function save () {
    if (!dirty) return
    dirty = false
    const tmp = FILE + '.tmp'
    await fs.promises.writeFile(tmp, JSON.stringify(file))
    await fs.promises.rename(tmp, FILE) // atomic: a crash leaves the old file or the new one
  }

  /** @param {(x: Item) => boolean} fn */
  function drop (fn) {
    const before = file.items.length
    file.items = file.items.filter((x) => !fn(x))
    if (file.items.length !== before) dirty = true
  }

  /** @param {Settings} s @param {Item} x */
  const isRead = (s, x) => (s[READ + x.place]?.[x.log] ?? 0) > x.seq

  /** @param {Settings} [s] */
  async function unread (s) {
    s = s || await settings()
    /** @type {Unread} */
    const out = { total: 0, byApp: {}, byPlace: {} }
    for (const x of file.items) {
      if (x.follow || isRead(s, x) || !allowed(s, x.app)) continue
      out.total++
      out.byApp[x.app] = (out.byApp[x.app] || 0) + 1
      out.byPlace[x.place] = (out.byPlace[x.place] || 0) + 1
    }
    return out
  }

  /** @param {Item} x @param {Settings | null} s */
  function view (x, s) {
    const hide = s ? s[APP + x.app]?.hide === true : false
    return { app: x.app, place: x.place, id: x.id, type: x.type, author: x.author, name: x.name, text: hide ? null : x.text, open: x.open, stamp: x.stamp, at: x.at, read: s ? isRead(s, x) : false, popup: !x.follow || x.popup }
  }

  /** @param {Place} p */
  async function hold (p) {
    if (held.has(p.place)) return
    held.set(p.place, noop)
    const space = sfs.hg.space(p.place)
    /** @param {{ types: string[] }} change */
    const onChange = ({ types: t }) => { if (t.some((x) => watching.get(p.place)?.has(x))) wake(p.place) }
    try {
      const release = await space.hold()
      space.on('change', onChange)
      const stop = () => { space.off('change', onChange); release() }
      if (held.get(p.place) === noop) held.set(p.place, stop)
      else stop() // let go while it was opening
    } catch { held.delete(p.place) }
  }

  /** @param {string} place */
  function unhold (place) {
    const stop = held.get(place)
    held.delete(place)
    if (stop) stop()
  }

  /** @param {string} place */
  function wake (place, ms = 300) {
    if (closed) return
    clearTimeout(timers.get(place))
    timers.set(place, setTimeout(() => { timers.delete(place); serial(() => pass([place])).catch(noop) }, ms))
  }

  // The place a page shows is kept open by the page itself.
  async function sync () {
    const want = places(await settings())
    watching.clear()
    for (const p of want) watching.set(p.place, new Set(typesOf(p.watches)))
    const chats = want.filter((p) => p.app === chat).slice(0, HELD_MAX)
    online = new Set(chats.map((p) => p.place))
    const keep = new Set([...online, ...turning])
    ring = want.filter((p) => !online.has(p.place))
    for (const place of [...held.keys()]) if (!keep.has(place)) unhold(place)
    for (const p of chats) await hold(p)
    await pass()
    if (!turnTimer && !closed) turnTimer = setTimeout(() => serial(rotate).catch(noop), 0)
  }

  // 50 places, 26 in turns: 13 turns, about 4.5 minutes a round.
  async function rotate () {
    const done = turning.splice(0)
    if (done.length) await pass(done)
    const stays = ring.length <= TURN_N ? new Set(ring.map((p) => p.place)) : new Set()
    for (const place of done) if (!stays.has(place) && !online.has(place)) unhold(place)
    if (at >= ring.length) at = 0
    const next = ring.slice(at, at + TURN_N)
    at += TURN_N
    for (const p of next) { turning.push(p.place); await hold(p) }
    if (next.length) await pass(next.map((p) => p.place)) // held now: a first look starts here, not at the turn's end
    turnTimer = closed ? null : setTimeout(() => serial(rotate).catch(noop), turn)
  }

  // Every setting fires 'settings' (a forum's read state too): look again only when what decides the places changed.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let syncTimer = null
  /** @type {string | null} */
  let lastDigest = null
  /** @type {string | null} */
  let lastContacts = null
  /** @param {string} n */
  const decides = (n) => n === PERMITS || n.startsWith(APP) || n.startsWith(MUTE) || n.startsWith(FOLLOW) || /^hyperbrowser\/app\/[^/]+\/instances$/.test(n)
  async function react () {
    const s = await settings()
    const digest = JSON.stringify(Object.keys(s).filter(decides).sort().map((n) => [n, s[n]]))
    if (digest !== lastDigest) {
      lastDigest = digest
      return sync()
    }
    if (JSON.stringify(s[CONTACTS] ?? null) !== lastContacts) return tell(requests(s))
    return changed()
  }
  const onSettings = () => {
    if (closed) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => serial(react).catch(noop), 200)
  }

  // One read-and-write at a time: two follows at once would each drop the other's.
  /** @param {string} app @param {(list: Follow[]) => Follow[]} fn */
  function setFollows (app, fn) {
    const p = writing.then(async () => {
      const list = fn((await settings())[FOLLOW + app] || [])
      await sfs.hg.setSetting(FOLLOW + app, list.length ? list : null)
    })
    writing = p.catch(noop)
    return p
  }

  const ready = (async () => {
    try {
      const f = JSON.parse(await fs.promises.readFile(FILE, 'utf-8'))
      if (f && typeof f.cursors === 'object' && Array.isArray(f.items)) file = { cursors: f.cursors || {}, items: f.items, dots: f.dots || {} }
    } catch {}
    launchTimer = setTimeout(() => serial(endLaunch).catch(noop), turn)
    sfs.hg.on('settings', onSettings)
    await serial(react)
  })()
  ready.catch(noop)

  return {
    /** @param {string | null} key */
    setChat (key) {
      if (key === chat) return
      chat = key
      lastDigest = null
      onSettings()
    },

    async state () {
      await ready
      const s = await settings()
      /** @type {Array<{ key: string, title: string, allow: boolean, hide: boolean, places: Array<{ key: string, name: string | null, muted: boolean }> }>} */
      const apps = [{ key: CONTACTS_APP, title: 'Contacts', allow: allowed(s, CONTACTS_APP), hide: s[APP + CONTACTS_APP]?.hide === true, places: [] }]
      for (const n of Object.keys(s)) {
        if (!n.startsWith(APP) || !s[n] || n === APP + CONTACTS_APP) continue
        const app = n.slice(APP.length)
        /** @type {Array<{ key: string, name: string | null, muted: boolean }>} */
        const list = []
        for (const place of Object.keys(s[INSTANCES(app)] || {})) {
          /** @type {string | null} */
          let name = null
          try { name = sfs.hg.space(place).name ?? null } catch { continue }
          list.push({ key: place, name, muted: s[MUTE + place] === true })
        }
        apps.push({ key: app, title: s[n].title, allow: allowed(s, app), hide: s[n].hide === true, places: list })
      }
      return { items: file.items.filter((x) => allowed(s, x.app)).map((x) => view(x, s)), unread: await unread(s), apps }
    },

    /**
     * @param {string} app
     * @param {import('./types.js').Manifest | null} manifest null: no manifest at hand (a "no" needs none)
     * @param {boolean} allow
     */
    async permit (app, manifest, allow) {
      await ready
      if (allow && manifest) await this.refresh(app, manifest, true)
      if (!allow) {
        await serial(async () => {
          const s = await settings()
          const mine = new Set(Object.keys(s[INSTANCES(app)] || {}))
          drop((x) => x.app === app)
          for (const place of mine) { delete file.cursors[place]; delete file.dots[place]; quiet.delete(place); unhold(place) }
          if (app === CONTACTS_APP) delete file.cursors[CONTACTS_APP]
          dirty = true
          await save()
          await changed()
        })
      }
    },

    /** @param {string} app @param {import('./types.js').Manifest} manifest */
    async refresh (app, manifest, force = false) {
      const s = await settings()
      if (!force && s[PERMITS]?.[app]?.notifications !== true) return
      const watches = manifest.permissions.includes('notifications') ? manifest.notifications || [] : []
      const old = s[APP + app]
      const next = { title: manifest.title, watches, hide: old?.hide === true }
      if (JSON.stringify(old) !== JSON.stringify(next)) await sfs.hg.setSetting(APP + app, next)
    },

    /** @param {import('./types.js').Params} p */
    async set ({ app, allow, hide, place, mute }) {
      if (typeof place === 'string') {
        if (typeof mute !== 'boolean') throw error('INVALID_PARAMS', 'notify.set needs { place, mute: true | false }')
        await sfs.hg.setSetting(MUTE + place, mute || null)
        return true
      }
      if (typeof app !== 'string' || (allow !== undefined && typeof allow !== 'boolean') || (hide !== undefined && typeof hide !== 'boolean')) {
        throw error('INVALID_PARAMS', 'notify.set needs { app, allow?, hide? } or { place, mute }')
      }
      if (hide !== undefined) {
        const cur = (await settings())[APP + app] || (app === CONTACTS_APP ? { title: 'Contacts', watches: [] } : null)
        if (!cur) throw error('NOT_FOUND', 'this app has no notifications')
        await sfs.hg.setSetting(APP + app, { ...cur, hide })
      }
      return true
    },

    /** @param {import('./types.js').Params} p */
    async read ({ place }) {
      if (typeof place !== 'string' || !place) throw error('INVALID_PARAMS', 'notify.read needs { place }')
      await ready
      const mine = file.items.filter((x) => x.place === place)
      if (mine.length) {
        const s = await settings()
        /** @type {Record<string, number>} */
        const marks = { ...s[READ + place] }
        for (const x of mine) marks[x.log] = Math.max(marks[x.log] ?? 0, x.seq + 1)
        const recent = new Set(mine.map((x) => x.log))
        const keep = Object.keys(marks).sort((a, b) => Number(recent.has(b)) - Number(recent.has(a))).slice(0, READ_LOGS)
        await sfs.hg.setSetting(READ + place, Object.fromEntries(keep.map((k) => [k, marks[k]])))
      } else if (!file.dots[place]) return true
      await serial(async () => {
        if (file.dots[place]) { // viewed: its dot goes (on this device: dots are this device's, like cursors)
          delete file.dots[place]
          dirty = true
          await save()
        }
        await changed()
      })
      return true
    },

    /** @param {string} place */
    async forget (place) {
      await serial(async () => {
        unhold(place)
        quiet.delete(place)
        delete file.cursors[place]
        delete file.dots[place]
        drop((x) => x.place === place)
        dirty = true
        await save()
      })
      const s = await settings()
      if (MUTE + place in s && s[MUTE + place] !== null) await sfs.hg.setSetting(MUTE + place, null)
      if (READ + place in s && s[READ + place] !== null) await sfs.hg.setSetting(READ + place, null)
      for (const n of Object.keys(s)) if (n.startsWith(FOLLOW) && s[n]?.some((/** @type {Follow} */ f) => f.place === place)) await setFollows(n.slice(FOLLOW.length), (l) => l.filter((f) => f.place !== place))
      await serial(changed)
    },

    /** @param {string} app */
    async forgetApp (app) {
      const s = await settings()
      if (!s[APP + app]) return
      await sfs.hg.setSetting(APP + app, null)
      if (s[FOLLOW + app]) await sfs.hg.setSetting(FOLLOW + app, null)
      for (const place of Object.keys(s[INSTANCES(app)] || {})) await this.forget(place)
    },

    // `places` is the engine's list of the app's instances, never the page's.

    /** @param {string[]} places */
    async unreadOf (places) {
      await ready
      const s = await settings()
      /** @type {Record<string, { count: number, dot: boolean }>} */
      const out = {}
      for (const p of places) out[p] = { count: 0, dot: !!file.dots[p] }
      for (const x of file.items) if (Object.hasOwn(out, x.place) && !x.follow && !isRead(s, x) && allowed(s, x.app)) out[x.place].count++
      return out
    },

    /**
     * @param {string} app
     * @param {import('./types.js').TypeDeclarations | undefined} types the app's
     * @param {string[]} places the app's instances
     * @param {unknown} spec a page's: checked here
     */
    async follow (app, types, places, spec) {
      watch(spec, types, true)
      const place = /** @type {string} */ (spec.place) // watch() checked it
      if (!places.includes(place)) throw error('NOT_ALLOWED', "not one of this app's instances")
      /** @type {Follow} */
      const f = { ...spec, place, id: b4a.toString(crypto.randomBytes(8), 'hex'), popup: spec.popup === true }
      await setFollows(app, (list) => {
        if (list.length >= FOLLOWS_MAX) throw error('TOO_BIG', `an app keeps at most ${FOLLOWS_MAX} follows`)
        return [...list, f]
      })
      return { id: f.id }
    },

    /** @param {string} app @param {unknown} id */
    async unfollow (app, id) {
      if (typeof id !== 'string') throw error('INVALID_PARAMS', "unfollow takes a follow's id")
      await setFollows(app, (list) => list.filter((f) => f.id !== id))
      return true
    },

    /** @param {string} app @returns {Promise<Follow[]>} */
    async follows (app) {
      return (await settings())[FOLLOW + app] || []
    },

    /** @param {{ id: string, text: string }} notice */
    async hyperbrowser ({ id, text }) {
      await ready
      /** @type {Item} */
      const x = { app: HB_APP, place: HB_APP, id, type: 'notice', author: me, name: 'HyperBrowser', text: clean(text, TEXT_MAX), open: null, stamp: null, at: Date.now(), log: HB_APP, seq: Date.now() }
      await serial(async () => {
        file.items = [x, ...file.items].slice(0, ITEMS_MAX)
        dirty = true
        await tell([x])
      })
    },

    async close () {
      closed = true
      sfs.hg.off('settings', onSettings)
      clearTimeout(syncTimer)
      clearTimeout(launchTimer)
      clearTimeout(turnTimer)
      for (const t of timers.values()) clearTimeout(t)
      for (const place of [...held.keys()]) unhold(place)
      await queue
      await save().catch(noop)
    }
  }
}
