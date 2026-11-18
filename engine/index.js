// The engine: one entry, start(ipc), over a duplex byte stream (specs/001-engine/contracts/protocol.md).
// Bare modules only, no Electron or Pear calls; its config arrives as the 'init' message. One SwarmFS,
// so one hypergraph: one identity, one swarm, every site. A site reaches its own space, through hg.scope(),
// and the instances made with it or joined through it (spec 009); the shell names the site, never the page.
import fs from 'fs'
import path from 'path'
import { SwarmFS } from 'swarmfs'
import { connect, VERSION } from './protocol.js'
import { parseManifest, readManifest, isDynamic, sitePath } from './manifest.js'
import { contacts } from './contacts.js'
import { notifications } from './notifications.js'
import { circles } from './circles.js'
import { projects } from './projects.js'
import hyperdns from 'hyperdns'

const ANSWERS = 'hyperbrowser/identity' // setting: { [site key]: true | false }, on every device of the person
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/ // z32 of 32 bytes
// Calls of hypergraph's site handle a page may make; addProtocol and memberConnections can't cross.
const CALLS = new Set(['put', 'get', 'edit', 'del', 'query', 'since', 'linked', 'count', 'sum', 'members', 'decisions', 'tags',
  'relate', 'unrelate', 'edges', 'tag', 'untag', 'getByTag', 'getRole', 'setRole', 'removeRole', 'defineRole', 'roles',
  'moderateAction', 'report', 'reports', 'createInvite', 'revokeInvite', 'createSubspace', 'subspaces', 'redemptions',
  'peers', 'status', 'isComplete', 'completeFrom', 'types', 'copies', 'rotateKey', 'secure', 'trimHistory'])
const MINE = new Set(['mine.all', 'mine.set'])
const INSTANCES = new Set(['instances.list', 'instances.create', 'instances.join', 'instances.leave'])
// spec 013: the person's contacts, for a site that declares the `contacts` permission and was allowed it
const CONTACTS = new Set(['contacts.me', 'contacts.setMe', 'contacts.list', 'contacts.request', 'contacts.accept',
  'contacts.decline', 'contacts.remove', 'contacts.rename', 'contacts.link', 'contacts.add', 'contacts.circles', 'contacts.inviteToCircle'])
// spec 017: the app's own unread counts and follows, for a site that declares the `notifications` permission
const NOTIFY = new Set(['notifications.unread', 'notifications.follow', 'notifications.unfollow', 'notifications.follows'])
// spec 024: the person's projects, for a site that declares the `projects` permission and was allowed it (projects.*)
const SINCE_MAX = 1000 // records of one since() call crossing to a page
const PERMITS = 'hyperbrowser/permissions' // setting: { [site key]: { contacts | notifications | projects: true | false } }
const APP_PREFIX = 'hyperbrowser/app/' // + key + '/instances': { [instance key]: true }, written by the engine only
const INSTANCES_MAX = 1000 // per app: the list is a setting every device of the person keeps
const INSTALLED = 'hyperbrowser/installed/' // + key: the site's title, or null once uninstalled (spec 012)
const MINE_PREFIX = 'hyperbrowser/site/' // + key + '/' + name: a site's own settings
// What a site may keep in the person's settings, which every device of theirs replicates (site code is untrusted).
// The forum's use: read state ~90 bytes per thread opened, pruned to the threads it shows (<= 500): ~45 KB.
const MINE_VALUE_MAX = 64 * 1024 // one value, as JSON
const MINE_SITE_MAX = 1024 * 1024 // all of a site's names and values, as JSON
const FILTERS = new Set(['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice'])
const INFO = ['key', 'name', 'parent', 'private', 'typesVersion', 'history', 'helpers', 'moved', 'movedTo', 'renewal'] // the last three: spec 023
// A site no tab shows, not installed and not the person's own, is left this long after its last tab closes
// (specs/004-hosting): the same as hypergraph's grace for a closed space's topic, so a tab closed by
// mistake or a back-and-forth comes back without finding the site's peers again.
const GRACE = 5 * 60 * 1000
// An instance's handle no subscription uses is closed this long after its last use (spec 017 R1): its space may then
// close (a forum switched away from), while a page coming back at once finds it still open.
const IDLE = 30 * 1000

const error = (code, message) => Object.assign(new Error(message), { code })

export function start (ipc) {
  let sfs = null
  let starting = null
  let timer = null
  let last = Date.now()
  let closing = null
  let nextSub = 1
  let answering = Promise.resolve()
  let keeping = Promise.resolve() // mine.set one at a time: two at once would each pass the cap
  let following = Promise.resolve() // spec 023: followMoves one at a time
  let syncing = null
  let people = null // the contacts (spec 013)
  let notes = null // the notifications (spec 016)
  let rings = null // the circles (spec 018): the shell's circles.* and holding.*
  let works = null // the projects (spec 024)
  const sites = new Map() // key -> { site, manifest, scope: Promise<Scope> | null, instances: Map<key, Promise<Scope>>, tabs }
  const leaving = new Map() // key -> timer: no tab shows it, left once the grace period is over
  const departing = new Map() // key -> the leave running
  let grace = GRACE
  let idle = IDLE
  const counters = new Set() // spec 017: the pages listening to their app's unread counts
  let opening = 0
  const subs = new Map() // id -> { key, stop }
  const bundled = new Set() // keys of the apps shipped inside HyperBrowser (spec 015): always joined, so served
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
      case 'site.permit': return permit(p)
      // spec 016: the shell's own calls (its counter, list and Configuration page); no page reaches them
      case 'notify.state': return notes.state()
      case 'notify.read': // app: the page's own (hyper.notifications.viewing): only that app's places
        if (p.app !== undefined && !(await listed(keyOf({ key: p.app })))[p.place]) throw error('NOT_ALLOWED', "not one of this app's places")
        return notes.read(p)
      case 'notify.set':
        if (p.allow !== undefined && typeof p.app === 'string') {
          if (typeof p.allow !== 'boolean') throw error('INVALID_PARAMS', 'allow is true or false')
          await writePermit(p.app, 'notifications', p.allow)
          await notes.permit(p.app, null, p.allow)
        }
        return notes.set({ ...p, allow: undefined })
      // spec 013: the shell's own calls (its "send a friend request?" dialog, "open a chat"), and the chat app
      case 'apps.set':
        people.setChat(p.chat ? keyOf({ key: p.chat }) : null)
        notes.setChat(p.chat || null) // spec 016: chats stay online first
        return true
      case 'contacts.me': return people.call('me', [])
      case 'contacts.setMe': return people.call('setMe', [{ name: p.name, findable: p.findable }]) // spec 020: the helper's name
      case 'contacts.get': return people.call('get', [p.identity])
      case 'contacts.request': return people.call('request', [p.identity, p.name])
      // spec 019: the circles window's Invite contacts… (pages keep site.call and its permission)
      case 'contacts.list': return people.call('list', [])
      case 'contacts.inviteToCircle': return people.call('inviteToCircle', [p.identity, p.circle])
      // the tray's status line (spec 010); handles: the instances' handles kept (spec 017 R1)
      case 'names.resolve': return resolveName(p) // spec 022: the shell's, never a page's (not in CALLS)
      case 'hosting': return { sites: sfs.hg.spaces().filter((s) => !s.parent).length, handles: [...sites.values()].reduce((n, s) => n + s.instances.size, 0) }
      case 'site.installed': return installed()
      case 'devices.list': return devices()
      case 'devices.add': return { code: (await sfs.hg.addDevice(secret(p))).code } // the new device: a 'devices' event
      case 'devices.remove':
        if (typeof p.publicKey !== 'string') throw error('INVALID_PARAMS', 'devices.remove needs { publicKey }')
        await sfs.hg.removeDevice(p.publicKey, secret(p))
        return true
      case 'devices.phrase': return { words: await sfs.hg.recoveryPhrase(p.password) }
      case 'devices.protect':
        if (typeof p.password !== 'string' || !p.password) throw error('INVALID_PARAMS', 'devices.protect needs { password }')
        await sfs.hg.protectRecoveryPhrase(p.password)
        return true
      default:
        if (method.startsWith('circles.') || method.startsWith('holding.')) return rings.call(method, p) // spec 018
        throw error('UNKNOWN_METHOD', 'unknown method ' + method)
    }
  }

  // joinCode: another device's code (spec 012): this empty folder becomes a device of that identity.
  // bundle: the official apps shipped inside HyperBrowser (spec 015), a folder made by scripts/build.js.
  // notifyTurn (tests): how long a watched place not kept online is held in its turn (spec 016 R3)
  // idle (tests): how long an unused instance's handle stays (spec 017 R1)
  // projects: the folder new projects go in (spec 024; default <dir>/projects)
  async function init ({ dir, bootstrap, heartbeat, appStorageMax, grace: g, joinCode, joinTimeout, deviceName, bundle, notifyTurn, idle: i, projects: root }) {
    if (sfs || starting) throw error('ALREADY', 'already initialised')
    if (typeof dir !== 'string' || !dir) throw error('INVALID_PARAMS', 'init needs { dir }')
    starting = SwarmFS.open(dir, { bootstrap, appStorageMax, joinCode, joinTimeout, deviceName })
    starting.catch(() => { starting = null }) // a failed init may be sent again
    if (g !== undefined) grace = g
    if (i !== undefined) idle = i
    sfs = await starting
    sfs.hg.on('devices', () => rpc.emit('devices', {}))
    sfs.hg.on('spaces', () => { followMoves().catch(() => {}) }) // spec 023: a place renewed on another device
    const list = typeof bundle === 'string' && bundle ? await readBundle(bundle) : null
    for (const a of list?.apps || []) bundled.add(a.key)
    await sweep()
    if (list) await unbundle(bundle, list, dir)
    syncing = sfs.sync().catch(() => {}) // the owner's published folders follow their edits; owned sites keep uploads
    people = contacts({ sfs, bootstrap, joinInstance, listInstance, leaveInstance, circles: (method, p) => rings.call(method, p) })
    notes = notifications({ sfs, dir, emit: (event, data) => rpc.emit(event, data), turn: notifyTurn, counts: () => { for (const fn of counters) fn() } })
    rings = circles({ sfs, dir, notes, emit: (event, data) => rpc.emit(event, data) })
    works = projects({
      sfs,
      dir,
      root: typeof root === 'string' && root ? root : path.join(dir, 'projects'),
      visit: visitSite,
      tell: (identity, text) => people.call('tell', [identity, text]),
      forget: async (key) => { await release(key); sites.delete(key) }
    })
    await works.start()
    if (heartbeat) {
      timer = setInterval(() => { if (Date.now() - last > 3 * heartbeat) shutdown('heartbeat') }, heartbeat)
    }
    return { identity: sfs.hg.identity.publicKey, version: VERSION }
  }

  // --- sites ---

  async function publish ({ folder, fresh = false }) {
    if (typeof folder !== 'string' || !folder) throw error('INVALID_PARAMS', 'site.publish needs { folder }')
    const full = path.resolve(folder)
    const manifest = await readManifest(full)
    // a folder published before is linked to its site's pages (SwarmFS keeps the links): same site, same key
    const link = (await sfs.links()).find((l) => l.path === full)
    if (link && fresh) { // a new site for this folder: the old one is left (its key stops working once nobody holds it)
      const old = sfs.hg.space(link.space).parent
      await sfs.unlink(full)
      await sfs.leave(old)
    } else if (link) {
      const key = sfs.hg.space(link.space).parent
      const site = await sfs.site(key)
      // an invite-only site never turns public by itself: public can't be undone, and its records would be read
      if (manifest.public !== false && !site.isPublic) throw error('PRIVATE_SITE', `this folder's site (${key}) is invite-only and site.json doesn't say "public": false; publish with --new for a fresh public site`)
      if (manifest.types) await site.declareTypes(manifest.types) // types added since (additions only)
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
    else site = await visitSite(key, timeout)
    const draft = works.draft(site.key) // spec 024: a project's preview, its pages read from the project (026: and its built pages)
    if (draft) {
      const manifest = await works.draftManifest(site.key)
      if (manifest.types) await site.declareTypes(manifest.types).catch(() => {}) // types added since (additions only)
      const known = sites.get(site.key)
      if (known) Object.assign(known, { manifest, tabs: known.tabs + 1 })
      else sites.set(site.key, { site, manifest, scope: null, instances: new Map(), idle: new Map(), tabs: 1, draft: site.key })
      return { key: site.key, manifest, dynamic: isDynamic(manifest), draft: true }
    }
    if (site.app) { // an app's instance (spec 009): its app opens on it, and the app may reach it from now on
      await listInstance(site.app, site.key, true)
      return { ...(await openSite(site.app, timeout)), instance: site.key }
    }
    const manifest = parseManifest(await site.read('site.json', { timeout }).catch((err) => {
      throw err.code === 'NOT_FOUND' ? error('NO_MANIFEST', 'this site has no site.json') : err
    }))
    stay(site.key)
    notes.refresh(site.key, manifest).catch(() => {}) // an allowed app's watches follow its new versions (spec 016 R2)
    const known = sites.get(site.key)
    if (known) Object.assign(known, { manifest, tabs: known.tabs + 1 })
    else sites.set(site.key, { site, manifest, scope: null, instances: new Map(), idle: new Map(), tabs: 1 })
    return { key: site.key, manifest, dynamic: isDynamic(manifest), ...(await askNotify(site.key, manifest)) }
  }

  // A site by its key: held here, or visited (a public site's link is its key).
  async function visitSite (key, timeout = 30000) {
    if (!KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
    let held = true
    try { sfs.hg.space(key) } catch { held = false }
    return held ? sfs.site(key, { timeout }) : sfs.visit('hg:' + key, { timeout })
  }

  // spec 016: "let it notify you?" comes right after the identity question: { notify: 'ask' } once that one is a
  // yes, for an app declaring watches, until the person answers.
  async function askNotify (key, manifest) {
    if (!manifest.permissions.includes('notifications') || !manifest.notifications?.length) return {}
    const s = await sfs.hg.settings()
    return s[ANSWERS]?.[key] === true && typeof s[PERMITS]?.[key]?.notifications !== 'boolean' ? { notify: 'ask' } : {}
  }

  async function read ({ key, path: p, timeout }) {
    const s = opened(keyOf({ key }))
    const clean = p === '' || p === '/' ? s.manifest.entry : sitePath(p)
    if (!clean) throw error('NOT_FOUND', `no page ${p}`)
    if (s.draft) return { bytes: await works.readDraft(s.draft, clean), path: clean }
    return { bytes: await s.site.read(clean, { timeout }), path: clean }
  }

  // For the shell's toolbar: the site and its pages complete here, and the peers on the site's space.
  function state ({ key }) {
    const { site } = opened(keyOf({ key }))
    return { complete: site.space.isComplete() && site.pages.space.isComplete(), peers: site.space.peers().length }
  }

  // Install (true: kept whole here, never evicted, served; remembered) or back to the cache (SwarmFS F4).
  async function keep ({ key, keep, timeout }) {
    const { site, manifest } = opened(keyOf({ key }))
    if (typeof keep !== 'boolean') throw error('INVALID_PARAMS', 'site.keep needs { keep: true | false }')
    await site.keep(keep, { timeout }) // SwarmFS remembers it for this device; the setting, for every device
    await sfs.hg.setSetting(INSTALLED + key, keep ? manifest.title : null)
    if (!keep) await notes.forgetApp(key) // uninstalled: its watches and notifications go (spec 016)
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

  // The person's answer to "let this site see and manage your contacts?" (spec 013) or "let it notify you?"
  // (spec 016), for a site declaring it.
  async function permit ({ key, permission, allow }) {
    key = keyOf({ key })
    if (!['contacts', 'notifications', 'projects'].includes(permission) || typeof allow !== 'boolean') throw error('INVALID_PARAMS', "site.permit needs { permission: 'contacts' | 'notifications' | 'projects', allow: true | false }")
    const { manifest } = opened(key)
    if (!manifest.permissions.includes(permission)) throw error('NOT_ALLOWED', "this site's site.json doesn't ask for " + permission)
    if (permission === 'notifications' && !manifest.notifications?.length) throw error('NOT_ALLOWED', "this site's site.json watches nothing")
    await writePermit(key, permission, allow)
    if (permission === 'notifications') await notes.permit(key, manifest, allow)
    if (!allow) for (const [id, x] of subs) if (x.key === key && x.contacts) off({ id })
    return true
  }

  function writePermit (key, permission, allow) {
    const write = answering.then(async () => {
      const all = (await sfs.hg.settings())[PERMITS] || {}
      await sfs.hg.setSetting(PERMITS, { ...all, [key]: { ...all[key], [permission]: allow } })
    })
    answering = write.catch(() => {})
    return write
  }

  async function permitted (key, permission = 'contacts') {
    await target({ key }) // a dynamic site the person let use their identity
    if (!opened(key).manifest.permissions.includes(permission)) throw error('NOT_ALLOWED', "this site's site.json doesn't ask for " + permission)
    const answer = ((await sfs.hg.settings())[PERMITS] || {})[key]?.[permission]
    if (answer === false) throw error('NOT_ALLOWED', 'the person said no to this site using their ' + permission)
    if (answer !== true) throw error('NEEDS_PERMISSION', 'ask the person first (site.permit)')
  }

  async function target ({ key, sub, instance }) {
    const s = opened(keyOf({ key }))
    if (!isDynamic(s.manifest)) throw error('NOT_ALLOWED', 'a static site has no API')
    const answer = s.draft ? true : ((await sfs.hg.settings())[ANSWERS] || {})[key] // a preview: its space is a throwaway
    if (answer === false) throw error('NOT_ALLOWED', 'the person said no to this site using their identity')
    if (answer !== true) throw error('NEEDS_CONSENT', 'ask the person first (site.consent)')
    if (!s.scope) {
      s.scope = sfs.hg.scope(key, { identity: 'main' })
      s.scope.catch(() => { s.scope = null })
    }
    const scope = instance === undefined || instance === null ? await s.scope : await instanceScope(s, key, instance)
    return sub === undefined || sub === null ? scope : scope.subspace(sub)
  }

  // --- instances (spec 009): spaces of their own, owned by their creator, running an app's code ---

  async function listed (app) {
    return (await sfs.hg.settings())[APP_PREFIX + app + '/instances'] || {}
  }

  // One read-and-write of an app's list at a time (as the consent answers).
  function listInstance (app, key, on) {
    const write = answering.then(async () => {
      const list = await listed(app)
      if (!on) delete list[key]
      else if (!list[key] && Object.keys(list).length >= INSTANCES_MAX) throw error('TOO_BIG', `an app keeps at most ${INSTANCES_MAX} instances`)
      else list[key] = true
      await sfs.hg.setSetting(APP_PREFIX + app + '/instances', list)
    })
    answering = write.catch(() => {})
    return write
  }

  // The handle on one of the app's instances: listed for this app, and the instance itself names this app.
  async function instanceScope (s, app, key) {
    keyOf({ key })
    const old = key
    key = current(key) // spec 023: a renewed place's new key
    if (old !== key && !(await listed(app))[key] && (await listed(app))[old]) await listInstance(app, key, true)
    clearTimeout(s.idle.get(key)) // in use: not closed under this call
    try {
      return await useInstance(s, app, key)
    } finally {
      idleLater(s, app, key)
    }
  }

  async function useInstance (s, app, key) {
    const list = await listed(app)
    const now = current(key) // spec 023: renewed: the new place, listed under either key
    if (!list[key] && !list[now]) throw error('NOT_ALLOWED', "not one of this app's instances: create or join it first")
    key = now
    if (!s.instances.has(key)) {
      const opening = (async () => {
        const site = await sfs.site(key)
        if (site.app !== app) throw error('NOT_ALLOWED', 'that instance runs another app')
        return { site, scope: await sfs.hg.scope(key, { identity: 'main' }), types: null }
      })()
      s.instances.set(key, opening)
      opening.catch(() => s.instances.delete(key))
    }
    const i = await s.instances.get(key)
    if (s.manifest.types && i.types !== s.manifest.types) { // the app's types, and those a new version added: owner, admins only
      i.types = s.manifest.types
      await i.site.declareTypes(i.types).catch(() => {})
    }
    return i.scope
  }

  // The handle is closed `idle` ms after its last use, unless a subscription uses it (its off() starts this again).
  // shortcut: a single call running longer than `idle` on an instance may see its handle closed (CLOSED); count the
  // calls in flight if that ever shows up.
  function idleLater (s, app, key) {
    clearTimeout(s.idle.get(key))
    s.idle.set(key, setTimeout(() => {
      s.idle.delete(key)
      if ([...subs.values()].some((x) => x.key === app && x.instance === key)) return
      const i = s.instances.get(key)
      s.instances.delete(key)
      if (i) i.then((x) => x.scope.close(), () => {})
    }, idle))
  }

  async function instances (s, app, method, [a, b]) {
    if (method === 'instances.list') {
      const out = []
      for (const key of Object.keys(await listed(app))) {
        let space
        try { space = sfs.hg.space(key) } catch { continue } // left on another device: not held here
        out.push({ key, name: space.name ?? null, role: await space.getRole(sfs.hg.identity.publicKey), public: !!space.isPublic })
      }
      return out
    }
    if (method === 'instances.create') {
      if (typeof a !== 'string' || !a.trim() || a.length > 200) throw error('INVALID_PARAMS', "an instance's name is 1 to 200 characters")
      const pub = b?.public ?? false
      const priv = b?.private ?? false // spec 013: read by its members only (a chat)
      if (typeof pub !== 'boolean' || typeof priv !== 'boolean' || (pub && priv)) throw error('INVALID_PARAMS', 'public or private: true or false, not both')
      if (Object.keys(await listed(app)).length >= INSTANCES_MAX) throw error('TOO_BIG', `an app keeps at most ${INSTANCES_MAX} instances`)
      const site = await sfs.createSite(a.trim(), { app, types: s.manifest.types, private: priv })
      if (pub) await site.makePublic()
      await listInstance(app, site.key, true)
      return { key: site.key, name: a.trim() }
    }
    if (method === 'instances.join') {
      const site = await joinInstance(app, a)
      return { key: site.key, name: site.space.name ?? null }
    }
    return leaveInstance(app, a)
  }

  // Into one of `app`'s instances with its link (also a contact's request, spec 013): the site, listed for the app.
  async function joinInstance (app, link) {
    if (typeof link !== 'string' || !link.startsWith('hg:')) throw error('INVALID_PARAMS', "join takes an instance's link (hg:...)")
    const before = new Set(sfs.hg.spaces().map((x) => x.key))
    let site = null
    let failed = null
    try {
      site = await sfs.visit(link)
    } catch (err) {
      failed = err // NOT_FOUND: a space that isn't a site, refused below
    }
    // spec 018: a circle's invite is joined through HyperBrowser only: a page's join of one is left at once (its one
    // use is spent: hypergraph can't tell a circle's link before redeeming it)
    const circle = sfs.hg.spaces().find((x) => !before.has(x.key) && !x.parent && isCircle(x.key))
    if (failed && failed.code !== 'NOT_FOUND' && !circle) throw failed
    if (circle || !site || site.app !== app) {
      for (const x of sfs.hg.spaces()) if (!before.has(x.key) && !x.parent) await sfs.leave(x.key).catch(() => {}) // joined for nothing
      throw error('NOT_ALLOWED', "that link is not to one of this app's instances")
    }
    await listInstance(app, site.key, true)
    return site
  }

  function isCircle (key) {
    try { return sfs.hg.space(key).circle } catch { return false } // not open: not read as one
  }

  // Off the list first, so nothing reaches it while it goes.
  async function leaveInstance (app, key) {
    keyOf({ key })
    if (!(await listed(app))[key]) throw error('NOT_ALLOWED', "not one of this app's instances")
    await listInstance(app, key, false)
    await notes.forget(key) // spec 016: its cursor, notifications, mute and read state
    for (const [id, x] of subs) if (x.instance === key) off({ id })
    clearTimeout(sites.get(app)?.idle.get(key))
    const scope = sites.get(app)?.instances.get(key)
    sites.get(app)?.instances.delete(key)
    if (scope) await scope.then((i) => i.scope.close(), () => {})
    await sfs.leave(key)
    const names = `${MINE_PREFIX}${app}/@${key}/` // its mine names: out of the app's cap
    for (const n of Object.keys(await sfs.hg.settings())) if (n.startsWith(names)) await sfs.hg.setSetting(n, null)
    return true
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

  async function call ({ key, sub, instance, method, args = [], chain }) {
    const project = typeof method === 'string' && method.startsWith('projects.')
    if (method !== 'info' && !project && !MINE.has(method) && !INSTANCES.has(method) && !CONTACTS.has(method) && !NOTIFY.has(method) && !CALLS.has(method)) throw error('UNKNOWN_METHOD', `a site may not call ${method}`)
    if (!Array.isArray(args)) throw error('INVALID_PARAMS', 'args is a list')
    if (project) {
      await permitted(key, 'projects')
      return plain(await works.call(method.slice('projects.'.length), args))
    }
    if (MINE.has(method)) {
      await target({ key, instance }) // an instance's: checked as any call on it
      return mine(key, method, args, instance)
    }
    if (CONTACTS.has(method)) {
      await permitted(key)
      return people.call(method.slice('contacts.'.length), args)
    }
    if (INSTANCES.has(method)) { // the app's own, whatever instance the page names
      await target({ key })
      return instances(opened(key), key, method, args)
    }
    if (NOTIFY.has(method)) return notify(key, method, args)
    if (method === 'since') args = sinceArgs(args)
    const t = await target({ key, sub, instance })
    if (method === 'info') {
      const out = { identity: t.identity.publicKey }
      for (const name of INFO) out[name] = t[name] ?? null
      out.app = instance ? key : null
      return plain(out)
    }
    if (method === 'query') {
      const steps = Array.isArray(chain) ? chain : []
      const end = steps.at(-1)
      if (!end || end[0] !== 'latest') throw error('INVALID_PARAMS', 'a query ends with latest')
      return plain(await query(t, args, steps.slice(0, -1)).latest(...(end[1] || [])))
    }
    await t.ready() // sync getters (subspaces, status, types) need the space's decisions
    if (method === 'copies') return sfs.hg.copiesOf((args[0] === undefined || args[0] === null ? t : await ownSpace(key, t, args[0])).key) // spec 018
    if (method === 'rotateKey') return plain(await sfs.hg.space(t.key).rotateKey()) // the handle has none; t passed the guard
    if (method === 'secure') return secure(t, args[0]) // spec 023, likewise; hypergraph lets owners and admins only
    if (method === 'trimHistory') {
      const before = args[0]?.before
      if (typeof before !== 'number' || Number.isNaN(before)) throw error('INVALID_PARAMS', 'trimHistory({ before }): a time in ms')
      return plain(await sfs.hg.space(t.key).trimHistory({ before }))
    }
    return plain(await t[method](...args))
  }

  // spec 023 (hypergraph 027): "Secure this place": a new key now, then the place renewed (`forget`: its history
  // before now deleted). The app's list follows (followMoves); the page gets the new key.
  async function secure (t, opts = {}) {
    if (opts === null || typeof opts !== 'object' || (opts.forget !== undefined && typeof opts.forget !== 'boolean')) throw error('INVALID_PARAMS', 'secure({ forget }): forget is true or false')
    const fresh = await sfs.hg.space(t.key).secure({ forget: !!opts.forget })
    await followMoves()
    return { key: fresh.key }
  }

  // A place renewed (here or on another device of the person): every app's list names its new key, and a page
  // still on the old key reaches the new place (useInstance).
  function current (key) {
    try { return sfs.hg.space(key).key } catch { return key }
  }

  // One run at a time: two at once would each see the other's half-written list.
  function followMoves () {
    following = following.then(followOnce, followOnce)
    return following
  }

  async function followOnce () {
    if (!sfs) return
    const settings = await sfs.hg.settings()
    for (const [name, list] of Object.entries(settings)) {
      if (!name.startsWith(APP_PREFIX) || !name.endsWith('/instances') || !list) continue
      const app = name.slice(APP_PREFIX.length, -'/instances'.length)
      for (const key of Object.keys(list)) {
        const now = current(key)
        if (now === key) continue
        await listInstance(app, now, true) // the new one first: a call meanwhile finds either
        await listInstance(app, key, false)
      }
    }
  }

  // spec 018: a key the page names for copies(key): the handle's own space, one of its sub-spaces, or (on the site's
  // own handle) one of the app's instances. Anything else: NOT_ALLOWED.
  async function ownSpace (key, t, k) {
    keyOf({ key: k })
    if (k === t.key) return t
    if (t.key === key && (await listed(key))[k]) return target({ key, instance: k })
    try { return t.subspace(k) } catch { throw error('NOT_ALLOWED', "not this site's space, one of its sub-spaces or instances") }
  }

  // The person's own data for this site (spec 006 R2): one setting per name, on every device of the person,
  // never in the site's space. Another site's names are out of reach (the prefix is this site's key). Each of
  // an app's instances has its own names (spec 009: '@<instance>/' + name), under the app's one cap.
  async function mine (key, method, [name, value], instance) {
    const site = `${MINE_PREFIX}${key}/`
    const prefix = instance ? `${site}@${instance}/` : site
    if (method === 'mine.all') {
      const out = {}
      for (const [n, v] of Object.entries(await sfs.hg.settings())) {
        if (n.startsWith(prefix) && v !== null && (instance || n[prefix.length] !== '@')) out[n.slice(prefix.length)] = v
      }
      return out
    }
    if (typeof name !== 'string' || !name || name.length > 200) throw error('INVALID_PARAMS', 'mine.set needs a name of 1 to 200 characters')
    if (!instance && name[0] === '@') throw error('INVALID_PARAMS', "a name doesn't start with @ (an instance's names do)")
    if (value === undefined) value = null
    const size = JSON.stringify(value).length
    if (size > MINE_VALUE_MAX) throw error('TOO_BIG', `a value is at most ${MINE_VALUE_MAX} bytes as JSON (this one: ${size})`)
    const write = keeping.then(async () => {
      if (value !== null) {
        let total = prefix.length - site.length + name.length + size
        for (const [n, v] of Object.entries(await sfs.hg.settings())) {
          if (n.startsWith(site) && n !== prefix + name && v !== null) total += n.length - site.length + JSON.stringify(v).length
        }
        if (total > MINE_SITE_MAX) throw error('TOO_BIG', `a site keeps at most ${MINE_SITE_MAX} bytes here: remove some names first`)
      }
      await sfs.hg.setSetting(prefix + name, value)
    })
    keeping = write.catch(() => {})
    await write
    return true
  }

  // spec 017: the app's own places only, whatever instance the page names (the list is the engine's).
  async function notify (key, method, [a]) {
    await target({ key })
    const { manifest } = opened(key)
    if (!manifest.permissions.includes('notifications')) throw error('NOT_ALLOWED', "this site's site.json doesn't ask for notifications")
    const places = Object.keys(await listed(key))
    if (method === 'notifications.unread') return notes.unreadOf(places)
    if (method === 'notifications.follows') return notes.follows(key)
    if (method === 'notifications.unfollow') return notes.unfollow(key, a)
    return notes.follow(key, manifest.types, places, a)
  }

  // since(cursor, { types, limit }): at most SINCE_MAX records a call; the page calls again with the cursor.
  function sinceArgs ([cursor, o]) {
    if (o !== undefined && (o === null || typeof o !== 'object' || Array.isArray(o))) throw error('INVALID_PARAMS', 'since(cursor, { types, limit })')
    const limit = o?.limit ?? SINCE_MAX
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SINCE_MAX) throw error('INVALID_PARAMS', `limit is 1 to ${SINCE_MAX}`)
    return [cursor ?? null, { ...o, limit }]
  }

  async function live ({ key, sub, instance, args = [], chain = [], opts }) {
    const t = await target({ key, sub, instance })
    const q = query(t, args, chain)
    const id = nextSub++
    const stop = q.live((r) => rpc.emit('live', { id, items: plain(r.items), complete: r.complete }), opts)
    subs.set(id, { key, instance, stop })
    return { id }
  }

  async function listen ({ key, sub, instance, event }) {
    if (event === 'contacts') { // spec 013: the list may have changed (any setting did: the site reads again)
      await permitted(key)
      const id = nextSub++
      const fn = () => rpc.emit('event', { id, data: null })
      sfs.hg.on('settings', fn)
      subs.set(id, { key, contacts: true, stop: () => sfs.hg.off('settings', fn) })
      return { id }
    }
    if (event === 'projects') { // spec 025: { project }: a project's files changed (saved, or a co-author's edit arrived)
      await permitted(key, 'projects')
      const id = nextSub++
      const stop = works.onChange((data) => { if (subs.has(id)) rpc.emit('event', { id, data }) })
      subs.set(id, { key, stop })
      return { id }
    }
    if (event === 'copies') { // spec 018: this handle's copies, told when they change (hypergraph's 'copies' on hg)
      const t = await target({ key, sub, instance })
      const id = nextSub++
      let last = JSON.stringify(sfs.hg.copiesOf(t.key))
      const fn = () => {
        const now = sfs.hg.copiesOf(t.key)
        if (JSON.stringify(now) !== last && subs.has(id)) rpc.emit('event', { id, data: now })
        last = JSON.stringify(now)
      }
      sfs.hg.on('copies', fn)
      subs.set(id, { key, instance, stop: () => sfs.hg.off('copies', fn) })
      return { id }
    }
    if (event === 'notifications') { // spec 017: the app's own counts, told when they change
      const id = nextSub++
      let last = JSON.stringify(await notify(key, 'notifications.unread', []))
      const fn = () => notify(key, 'notifications.unread', []).then((u) => {
        const now = JSON.stringify(u)
        if (now !== last && subs.has(id)) rpc.emit('event', { id, data: u })
        last = now
      }, () => {})
      counters.add(fn)
      subs.set(id, { key, stop: () => counters.delete(fn) })
      return { id }
    }
    const t = await target({ key, sub, instance })
    const id = nextSub++
    const fn = (data) => rpc.emit('event', { id, data: plain(data) })
    t.on(event, fn) // NOT_ALLOWED for events a site may not hear
    subs.set(id, { key, instance, stop: () => t.off(event, fn) })
    return { id }
  }

  function off ({ id }) {
    const s = subs.get(id)
    if (s) {
      subs.delete(id)
      s.stop()
      const site = s.instance && sites.get(s.key)
      if (site) idleLater(site, s.key, s.instance) // its handle, once no page uses it (spec 017 R1)
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
    if (s) {
      for (const t of s.idle.values()) clearTimeout(t)
      s.idle.clear()
      const open = [...s.instances.values()]
      s.instances.clear()
      for (const scope of open) await scope.then((i) => i.scope.close(), () => {})
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

  // An app's instance stays joined too (spec 009 Q7: an invite-only forum isn't lost when its tab closes); it is
  // online while used (hypergraph opens spaces while used). Only instances.leave drops one. A bundled app (spec 015)
  // too: every HyperBrowser serves the apps it shipped with, installed or not.
  // spec 024: an admin's too (a project's co-author publishes it).
  async function hosted (site) {
    return !!site.app || bundled.has(site.key) || (await site.kept()) || ['owner', 'admin'].includes(await site.space.getRole(sfs.hg.identity.publicKey))
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
  // served again once it is opened). Not a site, or not readable at once: left alone. A site installed here
  // before 012 goes on the person's list (once: an uninstall on another device is a null, left as is).
  async function sweep () {
    const settings = await sfs.hg.settings()
    for (const { key, parent, name } of sfs.hg.spaces()) {
      if (parent) continue
      const site = await sfs.site(key, { timeout: 0 }).catch(() => null)
      if (site && !(await hosted(site).catch(() => true))) await sfs.leave(key).catch(() => {})
      else if (site && !((INSTALLED + key) in settings) && await site.kept().catch(() => false)) await sfs.hg.setSetting(INSTALLED + key, name ?? '')
    }
  }

  // --- names (spec 022) ---

  // name@authority → { key, authority }: the site its records point to (a key, hyper://<key> or an hg: link), first
  // by HyperDNS's order (type, then value). Joins the authority read-only the first time it is reached by its link.
  // Errors: HyperDNS's codes (UNKNOWN_AUTHORITY, AMBIGUOUS_AUTHORITY, UNKNOWN_NAME, UNAVAILABLE), NOT_A_SITE.
  async function resolveName ({ address, timeout }) {
    if (typeof address !== 'string' || !address.includes('@')) throw error('INVALID_PARAMS', 'names.resolve needs { address: name@authority }')
    let found
    try {
      found = await hyperdns.resolveAddress(address, { hg: sfs.hg, timeout })
    } catch (err) {
      if (err.message === 'Invalid address format') throw error('INVALID_PARAMS', 'not name@authority: ' + address)
      throw err
    }
    for (const { value } of found.records) {
      const key = value.replace(/^hyper:\/\//i, '')
      if (KEY.test(key) || /^hg:\S+$/.test(key)) return { key, authority: found.authority }
    }
    throw error('NOT_A_SITE', address + ' points to no site (no key among its records)')
  }

  // --- bundled apps (spec 015) ---

  // bundle.json { id, apps: [{ id, key }] }, or null: a build without apps.
  async function readBundle (bundle) {
    try {
      const list = JSON.parse(await fs.promises.readFile(path.join(bundle, 'bundle.json'), 'utf-8'))
      return typeof list?.id === 'string' && Array.isArray(list.apps) ? { id: list.id, apps: list.apps.filter((a) => typeof a?.key === 'string' && KEY.test(a.key)) } : null
    } catch {
      return null
    }
  }

  // The bundle's apps imported as visits of them (SwarmFS packs: their own signed data, checked as replicated):
  // once per bundle, and again for one not held here. A newer version held here stays (hypergraph never takes a
  // core back); later ones come from peers. The shell then installs the preset apps as before. A failed app is
  // logged and tried again at the next start; the start goes on (its peers may serve it).
  async function unbundle (bundle, list, dir) {
    const marker = path.join(dir, 'bundled.json') // this engine folder's: the bundle it imported
    let done = null
    try { done = JSON.parse(await fs.promises.readFile(marker, 'utf-8')).id } catch {}
    const held = (key) => { try { sfs.hg.space(key); return true } catch { return false } }
    const todo = list.apps.filter((a) => done !== list.id || !held(a.key))
    let failed = false
    for (const a of todo) {
      try {
        await sfs.importSites(path.join(bundle, a.key), { timeout: 10000 }) // copied in process: seconds at most
      } catch (err) {
        failed = true
        console.error(`bundled app ${a.id} (${a.key}) not imported: ${err.code || 'ERROR'} ${err.message}`)
      }
    }
    if (todo.length && !failed) await fs.promises.writeFile(marker, JSON.stringify({ id: list.id }))
  }

  // --- devices (spec 012): one identity on several devices ---

  // The phrase's password, or the phrase typed (once forgotten here): what adding or removing a device needs.
  const secret = ({ password, recoveryPhrase }) => ({ password, recoveryPhrase })

  async function devices () {
    const list = await sfs.hg.devices()
    let phrase = 'plain'
    try {
      if (await sfs.hg.recoveryPhrase() === null) phrase = 'forgotten'
    } catch { phrase = 'protected' }
    const owns = []
    for (const s of sfs.hg.spaces()) {
      if (!s.parent && (await sfs.hg.space(s.key).getRole(sfs.hg.identity.publicKey).catch(() => null)) === 'owner') owns.push({ key: s.key, name: s.name ?? '' })
    }
    // shortcut: "removed" = this device left out of a list that has others (hypergraph drops removed devices
    // from devices()); a device that just joined and holds no list yet reads as not removed.
    const removed = list.length > 0 && !list.some((d) => d.current)
    return { identity: sfs.hg.identity.publicKey, devices: list, removed, phrase, owns }
  }

  // Sites installed on any device of the person (spec 012): the shell's desktop installs them here too.
  async function installed () {
    const out = { sites: [], uninstalled: [] }
    for (const [n, title] of Object.entries(await sfs.hg.settings())) {
      if (!n.startsWith(INSTALLED)) continue
      if (title === null) out.uninstalled.push(n.slice(INSTALLED.length))
      else out.sites.push({ key: n.slice(INSTALLED.length), title })
    }
    return out
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
        if (rings) rings.close()
        if (works) works.close()
        if (notes) await notes.close()
        if (people) await people.close()
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
