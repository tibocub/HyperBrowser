// Notifications (spec 016): an app declares in site.json what to watch (engine/manifest.js); once the person
// said yes, its watches are copied to their settings (R2) and the engine watches the app's instances with no
// app code. What is new is found with space.since() cursors, a seq per log (hypergraph 021), never by dates:
// a message written offline and received late still notifies, and a clock far ahead silences nothing.
// This device keeps the cursors and the latest items in <engine dir>/notifications.json; settings (on all the
// person's devices) keep the answers, hide, mute and how far each place was read (R4).
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import enc from 'hypergraph/lib/encodings.js'

const PERMITS = 'hyperbrowser/permissions' // { [app]: { notifications: true | false } } (engine/index.js)
const APP = 'hyperbrowser/notify/app/' // + app: { title, watches, hide }
const MUTE = 'hyperbrowser/notify/mute/' // + place: true
const READ = 'hyperbrowser/notify/read/' // + place: { [log, 16 hex]: next unread seq }
const INSTANCES = (app) => 'hyperbrowser/app/' + app + '/instances'
const CONTACTS = 'hyperbrowser/contacts' // engine/contacts.js: incoming requests notify (R7)
const CONTACTS_APP = 'contacts' // HyperBrowser's own: allowed unless blocked, never asked
const ITEMS_MAX = 200
const READ_LOGS = 64
const BATCH = 500
const QUIET = 1000 // a place whose history is arriving is checked this often, until complete
const HELD_MAX = 24 // chats kept online all the time (R3: of hypergraph's 64 open, 32 announced)
const TURN_N = 2 // the other places: this many at a time, `turn` ms each
const CATCHUP = 10 // more new items at once than this: one summary, not a popup each (a space catching up)
const TEXT_MAX = 200
const NAME_MAX = 64

const noop = () => {}
const error = (code, message) => Object.assign(new Error(message), { code })
// Text from records is a stranger's: one line of plain text, cut to length.
const clean = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) // eslint-disable-line no-control-regex

// sfs: the engine's SwarmFS. dir: the engine's folder. emit(event, data). turn: ms a place not held is held in
// its turn, and the launch's catch-up window.
export function notifications ({ sfs, dir, emit, turn = 20000 }) {
  const FILE = path.join(dir, 'notifications.json')
  const me = sfs.hg.identity.publicKey
  let file = { cursors: {}, items: [] }
  const quiet = new Map() // place -> cursor: not complete here yet, its history isn't news (R6)
  const held = new Map() // place -> release()
  const timers = new Map() // place -> debounce
  let queue = Promise.resolve()
  let dirty = false
  let closed = false
  let launching = []
  let launchTimer = null
  let last = null // the unread counts last told
  let chat = null // the Chat app's key (apps.set): its places stay online first
  let ring = [] // places checked in turns
  let at = 0
  let turning = [] // the places held for the current turn
  let turnTimer = null
  let online = new Set() // the chats held all the time
  const pending = [] // cursors to save once what they passed is told

  const serial = (fn) => {
    const p = queue.then(() => closed ? null : fn())
    queue = p.catch(noop)
    return p
  }
  const settings = () => sfs.hg.settings()

  const allowed = (s, app) => app === CONTACTS_APP
    ? s[PERMITS]?.[app]?.notifications !== false
    : s[PERMITS]?.[app]?.notifications === true && !!s[APP + app]

  // Every place watched now: { app, place, watches }, of allowed apps, held here.
  function places (s) {
    const out = []
    for (const n of Object.keys(s)) {
      if (!n.startsWith(APP)) continue
      const app = n.slice(APP.length)
      const watches = s[n]?.watches
      if (app === CONTACTS_APP || !allowed(s, app) || !watches?.length) continue
      for (const place of Object.keys(s[INSTANCES(app)] || {})) {
        try { sfs.hg.space(place) } catch { continue } // left on another device: not here
        out.push({ app, place, watches })
      }
    }
    return out
  }

  // --- what's new in one place ---

  async function since (space, cursor, types) {
    try {
      return await space.since(cursor, { types, limit: BATCH })
    } catch (err) {
      if (err.code !== 'INVALID_TYPE') throw err // an instance not told of the app's newer types yet
      const r = await space.since(cursor, { limit: BATCH })
      return { ...r, records: r.records.filter((x) => types.includes(x.type)), full: r.records.length === BATCH }
    }
  }

  async function check ({ app, place, watches }, s) {
    const space = sfs.hg.space(place)
    const types = [...new Set(watches.map((w) => w.type))]
    let cursor = file.cursors[place] ?? quiet.get(place) ?? null
    if (cursor === null) { // a first look (a first yes, a place just joined): from now on
      cursor = (await space.since(null)).cursor
      await space.ready()
      if (space.isComplete()) setCursor(place, cursor)
      else quiet.set(place, cursor)
      if (quiet.has(place)) wake(place, QUIET)
      return []
    }
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
    const out = []
    if (s[MUTE + place] !== true) {
      for (const r of records) {
        if (r.author === me || file.items.some((x) => x.id === r.id)) continue // own records; a repeat after a crash
        const w = watches.find((w) => w.type === r.type && (!w.me || r[w.me] === me))
        if (w) out.push(await item(app, place, w, r, s))
      }
    }
    file.items = [...out, ...file.items].slice(0, ITEMS_MAX)
    if (out.length) dirty = true
    pending.push(() => setCursor(place, cursor)) // saved after the items are told (a crash repeats one, never loses one)
    return out
  }

  function setCursor (place, cursor) {
    if (JSON.stringify(file.cursors[place]) === JSON.stringify(cursor)) return
    file.cursors[place] = cursor
    dirty = true
  }

  // Unread items whose record went (deleted, hidden, a ban) leave the list.
  async function gone (space, place) {
    const s = await settings()
    const mine = file.items.filter((x) => x.place === place && !isRead(s, x))
    for (const x of mine) {
      const { record, deleted } = await space.get(x.id, { timeout: 1000 }).catch(() => ({ record: undefined }))
      if ((record === null && deleted) || record?.hidden) drop((y) => y === x)
    }
  }

  async function item (app, place, w, r, s) {
    const { log, seq } = enc.idParts(r.id)
    return {
      app,
      place,
      id: r.id,
      type: r.type,
      author: r.author,
      name: await nameOf(place, r.author, s),
      text: clean(w.says ?? r[w.text], TEXT_MAX), // shortcut: a record whose content was dropped here (budgets) has no text, the shell says "New message"
      open: w.open ? w.open.replace(/\{([^}]*)\}/g, (_, f) => encodeURIComponent(String(r[f] ?? ''))) : null,
      stamp: r.stamp,
      at: Date.now(),
      log: b4a.toString(log, 'hex').slice(0, 16),
      seq
    }
  }

  async function nameOf (place, author, s) {
    const known = s[CONTACTS]?.[author]?.name
    if (known) return clean(known, NAME_MAX)
    try {
      const { items } = await sfs.hg.space(place).query('profile').by(author).latest(1)
      return clean(items[0]?.name, NAME_MAX)
    } catch { return '' }
  }

  // --- friend requests (R7): settings, not records; the cursor is the incoming identities already told ---

  function requests (s) {
    const incoming = Object.entries(s[CONTACTS] || {}).filter(([, c]) => c?.state === 'incoming')
    const seen = file.cursors[CONTACTS_APP] || {}
    const out = []
    if (allowed(s, CONTACTS_APP)) {
      for (const [id, c] of incoming) {
        if (seen[id]) continue
        out.push({ app: CONTACTS_APP, place: CONTACTS_APP, id, type: 'request', author: id, name: clean(c.name, NAME_MAX), text: 'wants to be your friend', open: null, stamp: c.at || null, at: Date.now(), log: id.slice(0, 16), seq: 0 })
      }
    }
    const now = new Set(incoming.map(([id]) => id))
    drop((x) => x.app === CONTACTS_APP && !now.has(x.author)) // answered: the request is gone
    file.items = [...out, ...file.items].slice(0, ITEMS_MAX)
    if (out.length) dirty = true
    pending.push(() => setCursor(CONTACTS_APP, Object.fromEntries([...now].map((id) => [id, 1]))))
    return out
  }

  // --- one pass: the places named (all of them: null), told, then saved ---

  async function pass (only = null) {
    const s = await settings()
    const fresh = []
    for (const p of places(s)) {
      if (only && !only.includes(p.place)) continue
      try { fresh.push(...await check(p, s)) } catch {} // a space that can't be read now: next time
    }
    if (!only) fresh.push(...requests(s))
    await tell(fresh)
  }

  async function tell (fresh) {
    if (launchTimer && fresh.length) launching.push(...fresh) // the launch's catch-up: told at once, when it ends
    else if (fresh.length) emit('notify', { items: fresh.map((x) => view(x, null)), summary: fresh.length > CATCHUP ? { count: fresh.length } : null, unread: last = await unread() })
    else await changed()
    for (const fn of pending.splice(0)) fn()
    await save()
  }

  async function endLaunch () {
    launchTimer = null
    const all = launching.splice(0)
    if (all.length) emit('notify', { items: all.map((x) => view(x, null)), summary: all.length > 1 ? { count: all.length } : null, unread: last = await unread() })
  }

  // Unread counts changed (a read here or on another device, a block): told with no new items.
  async function changed () {
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

  function drop (fn) {
    const before = file.items.length
    file.items = file.items.filter((x) => !fn(x))
    if (file.items.length !== before) dirty = true
  }

  // --- read state (R4): per place, per log, the next unread seq ---

  const isRead = (s, x) => (s[READ + x.place]?.[x.log] ?? 0) > x.seq

  async function unread (s) {
    s = s || await settings()
    const out = { total: 0, byApp: {}, byPlace: {} }
    for (const x of file.items) {
      if (isRead(s, x) || !allowed(s, x.app)) continue
      out.total++
      out.byApp[x.app] = (out.byApp[x.app] || 0) + 1
      out.byPlace[x.place] = (out.byPlace[x.place] || 0) + 1
    }
    return out
  }

  function view (x, s) {
    const hide = s ? s[APP + x.app]?.hide === true : false
    return { app: x.app, place: x.place, id: x.id, type: x.type, author: x.author, name: x.name, text: hide ? null : x.text, open: x.open, stamp: x.stamp, at: x.at, read: s ? isRead(s, x) : false }
  }

  // --- holding places online, waking on their changes ---

  async function hold (p) {
    if (held.has(p.place)) return
    held.set(p.place, noop)
    const space = sfs.hg.space(p.place)
    const types = new Set(p.watches.map((w) => w.type))
    const onChange = ({ types: t }) => { if (t.some((x) => types.has(x))) wake(p.place) }
    try {
      const release = await space.hold()
      space.on('change', onChange)
      const stop = () => { space.off('change', onChange); release() }
      if (held.get(p.place) === noop) held.set(p.place, stop)
      else stop() // let go while it was opening
    } catch { held.delete(p.place) }
  }

  function unhold (place) {
    const stop = held.get(place)
    held.delete(place)
    if (stop) stop()
  }

  function wake (place, ms = 300) {
    if (closed) return
    clearTimeout(timers.get(place))
    timers.set(place, setTimeout(() => { timers.delete(place); serial(() => pass([place])).catch(noop) }, ms))
  }

  // The places to watch changed (a yes, a block, a join, a leave): chats held, up to HELD_MAX; the others take
  // turns (R3). The place a page shows is kept open by the page itself.
  async function sync () {
    const want = places(await settings())
    const chats = want.filter((p) => p.app === chat).slice(0, HELD_MAX)
    online = new Set(chats.map((p) => p.place))
    const keep = new Set([...online, ...turning])
    ring = want.filter((p) => !online.has(p.place))
    for (const place of [...held.keys()]) if (!keep.has(place)) unhold(place)
    for (const p of chats) await hold(p)
    await pass()
    if (!turnTimer && !closed) turnTimer = setTimeout(() => serial(rotate).catch(noop), 0)
  }

  // One turn: the places held for the last one checked and let go, the next ones held for `turn` ms (and woken
  // by their changes meanwhile). 50 places, 26 in turns: 13 turns, about 4.5 minutes a round.
  async function rotate () {
    const done = turning.splice(0)
    if (done.length) await pass(done)
    const stays = ring.length <= TURN_N ? new Set(ring.map((p) => p.place)) : new Set() // few enough: always held
    for (const place of done) if (!stays.has(place) && !online.has(place)) unhold(place)
    if (at >= ring.length) at = 0
    const next = ring.slice(at, at + TURN_N)
    at += TURN_N
    for (const p of next) { turning.push(p.place); await hold(p) }
    turnTimer = closed ? null : setTimeout(() => serial(rotate).catch(noop), turn)
  }

  let syncTimer = null
  const onSettings = () => {
    if (closed) return
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => serial(sync).catch(noop), 200)
  }

  // --- start ---

  const ready = (async () => {
    try {
      const f = JSON.parse(await fs.promises.readFile(FILE, 'utf-8'))
      if (f && typeof f.cursors === 'object' && Array.isArray(f.items)) file = { cursors: f.cursors || {}, items: f.items }
    } catch {}
    launchTimer = setTimeout(() => serial(endLaunch).catch(noop), turn)
    sfs.hg.on('settings', onSettings)
    await serial(sync)
  })()
  ready.catch(noop)

  // --- the engine's calls ---

  return {
    setChat (key) {
      if (key === chat) return
      chat = key
      onSettings()
    },

    async state () {
      await ready
      const s = await settings()
      const apps = [{ key: CONTACTS_APP, title: 'Contacts', allow: allowed(s, CONTACTS_APP), hide: s[APP + CONTACTS_APP]?.hide === true, places: [] }]
      for (const n of Object.keys(s)) {
        if (!n.startsWith(APP) || !s[n] || n === APP + CONTACTS_APP) continue
        const app = n.slice(APP.length)
        const list = []
        for (const place of Object.keys(s[INSTANCES(app)] || {})) {
          let name = null
          try { name = sfs.hg.space(place).name ?? null } catch { continue }
          list.push({ key: place, name, muted: s[MUTE + place] === true })
        }
        apps.push({ key: app, title: s[n].title, allow: allowed(s, app), hide: s[n].hide === true, places: list })
      }
      return { items: file.items.filter((x) => allowed(s, x.app)).map((x) => view(x, s)), unread: await unread(s), apps }
    },

    // The person's answer for `app` (site.permit, or the Configuration page): the watches copied at a yes (R2).
    async permit (app, manifest, allow) {
      await ready
      if (allow && manifest) await this.refresh(app, manifest, true)
      if (!allow) {
        await serial(async () => {
          const s = await settings()
          const mine = new Set(Object.keys(s[INSTANCES(app)] || {}))
          drop((x) => x.app === app)
          for (const place of mine) { delete file.cursors[place]; quiet.delete(place); unhold(place) }
          if (app === CONTACTS_APP) delete file.cursors[CONTACTS_APP]
          dirty = true
          await save()
          await changed()
        })
      }
    },

    // At each open of an allowed app: a new version may change its watches or title.
    async refresh (app, manifest, force = false) {
      const s = await settings()
      if (!force && s[PERMITS]?.[app]?.notifications !== true) return
      const watches = manifest.permissions.includes('notifications') ? manifest.notifications || [] : []
      const old = s[APP + app]
      const next = { title: manifest.title, watches, hide: old?.hide === true }
      if (JSON.stringify(old) !== JSON.stringify(next)) await sfs.hg.setSetting(APP + app, next)
    },

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

    async read ({ place }) {
      if (typeof place !== 'string' || !place) throw error('INVALID_PARAMS', 'notify.read needs { place }')
      await ready
      const mine = file.items.filter((x) => x.place === place) // newest first
      if (!mine.length) return true
      const s = await settings()
      const marks = { ...s[READ + place] }
      for (const x of mine) marks[x.log] = Math.max(marks[x.log] ?? 0, x.seq + 1)
      const recent = new Set(mine.map((x) => x.log))
      const keep = Object.keys(marks).sort((a, b) => recent.has(b) - recent.has(a)).slice(0, READ_LOGS)
      await sfs.hg.setSetting(READ + place, Object.fromEntries(keep.map((k) => [k, marks[k]])))
      await serial(changed)
      return true
    },

    // Leaving a place: its cursor, items, mute and read state go.
    async forget (place) {
      await serial(async () => {
        unhold(place)
        quiet.delete(place)
        delete file.cursors[place]
        drop((x) => x.place === place)
        dirty = true
        await save()
      })
      const s = await settings()
      if (MUTE + place in s && s[MUTE + place] !== null) await sfs.hg.setSetting(MUTE + place, null)
      if (READ + place in s && s[READ + place] !== null) await sfs.hg.setSetting(READ + place, null)
      await serial(changed)
    },

    // Uninstalling an app: its watches and everything of its places.
    async forgetApp (app) {
      const s = await settings()
      if (!s[APP + app]) return
      await sfs.hg.setSetting(APP + app, null)
      for (const place of Object.keys(s[INSTANCES(app)] || {})) await this.forget(place)
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
