// The shell names the site for every call, never the page: a site reaches only its own space and its app's instances.
import fs from 'fs'
import path from 'path'
import { SwarmFS } from 'swarmfs'
import { connect, VERSION } from './protocol.js'
import { parseManifest, readManifest, isDynamic, sitePath } from './manifest.js'
import { contacts } from './contacts.js'
import { reseed } from './reseed.js'
import { notifications } from './notifications.js'
import { circles } from './circles.js'
import { projects } from './projects.js'
import hyperdns from 'hyperdns'
import phrase from 'hypergraph/lib/phrase.js'

/** @typedef {{ id: string, apps: Array<{ key: string, id?: string }> }} Bundle The apps the build bundled (bundle.json). */

const ANSWERS = 'hyperbrowser/identity'
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
// addProtocol and memberConnections can't cross to a page.
const CALLS = new Set(['put', 'get', 'edit', 'del', 'query', 'since', 'linked', 'count', 'sum', 'members', 'decisions', 'tags',
  'relate', 'unrelate', 'edges', 'tag', 'untag', 'getByTag', 'getRole', 'setRole', 'removeRole', 'defineRole', 'roles',
  'moderateAction', 'report', 'reports', 'createInvite', 'revokeInvite', 'createSubspace', 'subspaces', 'redemptions',
  'peers', 'status', 'isComplete', 'completeFrom', 'types', 'copies', 'rotateKey', 'secure', 'trimHistory', 'setHistory', 'setDisappearing'])
const MINE = new Set(['mine.all', 'mine.set'])
const INSTANCES = new Set(['instances.list', 'instances.create', 'instances.join', 'instances.leave'])
const CONTACTS = new Set(['contacts.me', 'contacts.setMe', 'contacts.list', 'contacts.request', 'contacts.accept',
  'contacts.decline', 'contacts.remove', 'contacts.rename', 'contacts.link', 'contacts.add', 'contacts.circles', 'contacts.inviteToCircle'])
const NOTIFY = new Set(['notifications.unread', 'notifications.follow', 'notifications.unfollow', 'notifications.follows'])
const SINCE_MAX = 1000
const PERMITS = 'hyperbrowser/permissions'
const APP_PREFIX = 'hyperbrowser/app/'
const INSTANCES_MAX = 1000
const INSTALLED = 'hyperbrowser/installed/'
const MINE_PREFIX = 'hyperbrowser/site/'
// Capped: every device of the person replicates it, and site code is untrusted. The forum uses ~45 KB.
const MINE_VALUE_MAX = 64 * 1024
const MINE_SITE_MAX = 1024 * 1024
const FILTERS = new Set(['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice'])
const INFO = ['key', 'name', 'parent', 'private', 'typesVersion', 'history', 'disappearing', 'helpers', 'moved', 'movedTo', 'renewal']
// hypergraph's grace for a closed topic: a tab closed by mistake comes back without finding peers again.
const GRACE = 5 * 60 * 1000
// Long enough that a page coming back at once finds the handle still open.
const IDLE = 30 * 1000

/**
 * @typedef {import('./types.js').Site} Site
 * @typedef {import('./types.js').SiteHandle} SiteHandle
 * @typedef {import('./types.js').Manifest} Manifest
 * @typedef {import('./types.js').Params} Params
 * @typedef {import('./types.js').CodedError} CodedError
 * @typedef {import('./types.js').TypeDeclarations} TypeDeclarations
 * @typedef {{ site: Site, scope: SiteHandle, types: TypeDeclarations | null }} Instance An app's instance, open.
 * @typedef {object} Opened A site open in at least one tab.
 * @property {Site} site
 * @property {Manifest} manifest
 * @property {Promise<SiteHandle> | null} scope the site's own space, as the person
 * @property {Map<string, Promise<Instance>>} instances
 * @property {Map<string, ReturnType<typeof setTimeout>>} idle an instance's handle closes when its timer ends
 * @property {number} tabs
 * @property {string} [draft] an IDE preview: its pages are the project's
 * @typedef {{ key: string, instance?: string | null, contacts?: true, stop: () => void }} Sub A page's subscription.
 * @typedef {{ key: unknown, sub?: unknown, instance?: unknown }} At The space a page's call is for.
 */

/** @param {string} code @param {string} message */
const error = (code, message) => Object.assign(new Error(message), { code })

/**
 * The engine: requests from the shell over `ipc`, answered by method.
 * @param {unknown} ipc a duplex stream to the shell (Bare.IPC, or a pair() end)
 */
export function start (ipc) {
  // null until init, set back to null at the end: handle() refuses every call before init
  let sfs = /** @type {SwarmFS} */ (/** @type {unknown} */ (null))
  /** @type {Promise<SwarmFS> | null} */
  let starting = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null
  let last = Date.now()
  /** @type {Promise<void> | null} */
  let closing = null
  let nextSub = 1
  /** @type {Promise<unknown>} */
  let answering = Promise.resolve()
  /** @type {Promise<unknown>} */
  let keeping = Promise.resolve() // mine.set one at a time: two at once would each pass the cap
  /** @type {Promise<unknown>} */
  let following = Promise.resolve() // followMoves one at a time
  /** @type {Promise<void> | null} */
  let syncing = null
  // set by init, before any call that uses them (as sfs)
  let people = /** @type {ReturnType<typeof contacts>} */ (/** @type {unknown} */ (null))
  /** @type {ReturnType<typeof reseed> | null} a regular identity's: router records and I2P DHT nodes with peers */
  let seeding = null
  let notes = /** @type {ReturnType<typeof notifications>} */ (/** @type {unknown} */ (null))
  let rings = /** @type {ReturnType<typeof circles>} */ (/** @type {unknown} */ (null))
  let works = /** @type {ReturnType<typeof projects>} */ (/** @type {unknown} */ (null))
  /** @type {Map<string, Opened>} */
  const sites = new Map()
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const leaving = new Map()
  /** @type {Map<string, Promise<unknown>>} */
  const departing = new Map()
  let grace = GRACE
  let idle = IDLE
  /** @type {Set<() => void>} */
  const counters = new Set()
  let opening = 0
  /** @type {Map<number, Sub>} */
  const subs = new Map()
  /** @type {Set<string>} */
  const bundled = new Set()
  /** @type {(reason: string) => void} */
  let closed
  /** @type {Promise<string>} */
  const done = new Promise((resolve) => { closed = resolve })

  const rpc = connect(ipc, { handle, onmessage: () => { last = Date.now() }, onclose: () => shutdown('closed') })

  /** @param {string} method @param {Params} p */
  async function handle (method, p) {
    if (method === 'init') return init(p)
    if (method === 'ping') return true
    if (method === 'close') {
      await shutdown('close')
      return true
    }
    // another identity's, closed, before deleting it: the shell names its folder
    if (method === 'phrase.read') {
      if (typeof p.dir !== 'string' || !p.dir) throw error('INVALID_PARAMS', 'phrase.read needs { dir }')
      return { words: phrase.open(p.dir, p.password) }
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
      case 'apps.set':
        people.setChat(p.chat ? keyOf({ key: p.chat }) : null)
        notes.setChat(p.chat || null)
        return true
      case 'contacts.me': return people.call('me', [])
      case 'contacts.setMe': return people.call('setMe', [{ name: p.name, findable: p.findable }])
      case 'contacts.get': return people.call('get', [p.identity])
      case 'contacts.request': return people.call('request', [p.identity, p.name])
      case 'contacts.list': return people.call('list', [])
      case 'contacts.inviteToCircle': return people.call('inviteToCircle', [p.identity, p.circle])
      case 'names.resolve': return resolveName(p) // the shell's, never a page's (not in CALLS)
      case 'i2p.nodes': return { nodes: sfs.hg.i2pNodes() } // the shell's: this identity's start next time
      case 'photos.add': return addPhotos(p) // the shell's: photos a linked folder left out (anonymous identities)
      case 'i2p.share': // the shell's: what a regular identity hands its peers (router records, I2P DHT nodes)
        if (!seeding) return { shared: false }
        await seeding.set({ records: Array.isArray(p.records) ? p.records : [], nodes: [...(Array.isArray(p.nodes) ? p.nodes : []), ...sfs.hg.i2pNodes()] })
        return { shared: true }
      case 'hosting': return { sites: sfs.hg.spaces().filter((s) => !s.parent).length, handles: [...sites.values()].reduce((/** @type {number} */ n, s) => n + s.instances.size, 0) }
      case 'site.installed': return installed()
      case 'devices.list': return devices()
      case 'devices.add': return { code: (await sfs.hg.addDevice(secret(p))).code }
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
        if (method.startsWith('circles.') || method.startsWith('holding.')) return rings.call(method, p)
        throw error('UNKNOWN_METHOD', 'unknown method ' + method)
    }
  }

  /** @param {Params} p */
  async function init ({ dir, bootstrap, heartbeat, appStorageMax, minFree, grace: g, joinCode, joinTimeout, mnemonic, deviceName, bundle, notifyTurn, idle: i, projects: root, transport, sam }) {
    if (sfs || starting) throw error('ALREADY', 'already initialised')
    if (typeof dir !== 'string' || !dir) throw error('INVALID_PARAMS', 'init needs { dir }')
    if (minFree !== undefined && (typeof minFree !== 'number' || !(minFree >= 0))) throw error('INVALID_PARAMS', 'minFree is a number of bytes')
    // minFree: bytes SwarmFS leaves free when fetching (its default: max(5 GB, 5 % of the disk)); tests set 0
    // transport: 'dual' for a regular identity, 'i2p' for an anonymous one (the shell's); open() waits for I2P then
    starting = SwarmFS.open(dir, { bootstrap, appStorageMax, minFree, joinCode, joinTimeout, mnemonic, deviceName, transport, sam, ontransport: (/** @type {object} */ e) => rpc.emit('transport', e) }) // also later: the router stopped, came back
    starting.catch(() => { starting = null }) // a failed init may be sent again
    if (g !== undefined) grace = g
    if (i !== undefined) idle = i
    sfs = await starting
    sfs.hg.on('devices', () => rpc.emit('devices', {}))
    sfs.on('sync', (/** @type {import('swarmfs').SyncEvent} */ e) => {
      if (e.action === 'skipped' && e.reason === 'photo') rpc.emit('photos.skipped', { space: e.space, path: e.path })
      else if (e.action === 'fetching') rpc.emit('fetching', { name: e.path, size: e.size })
    })
    sfs.hg.on('spaces', () => { followMoves().catch(() => {}) })
    const list = typeof bundle === 'string' && bundle ? await readBundle(bundle) : null
    for (const a of list?.apps || []) bundled.add(a.key)
    await sweep()
    if (list) await unbundle(bundle, list, dir)
    syncing = sfs.sync().catch(() => {}) // the owner's published folders follow their edits; owned sites keep uploads
    if (transport === 'dual') seeding = reseed({ bootstrap, emit: (event, data) => rpc.emit(event, data) })
    people = contacts({ sfs, bootstrap, sam: transport === 'i2p' ? sam : null, joinInstance, listInstance, leaveInstance, circles: (method, p) => rings.call(method, p) })
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

  /** @param {Params} p */
  async function publish ({ folder, fresh = false }) {
    if (typeof folder !== 'string' || !folder) throw error('INVALID_PARAMS', 'site.publish needs { folder }')
    const full = path.resolve(folder)
    const manifest = await readManifest(full)
    // a folder published before is linked to its site's pages (SwarmFS keeps the links): same site, same key
    const link = (await sfs.links()).find((l) => l.path === full)
    if (link && fresh) { // a new site for this folder: the old one is left (its key stops working once nobody holds it)
      const old = /** @type {string} */ (sfs.hg.space(link.space).parent) // a site's pages: a sub-space of the site
      await sfs.unlink(full)
      await sfs.leave(old)
    } else if (link) {
      const key = /** @type {string} */ (sfs.hg.space(link.space).parent)
      const site = await sfs.site(key)
      // an invite-only site never turns public by itself: public can't be undone, and its records would be read
      if (manifest.public !== false && !site.isPublic) throw error('PRIVATE_SITE', `this folder's site (${key}) is invite-only and site.json doesn't say "public": false; publish with --new for a fresh public site`)
      if (manifest.types) await site.declareTypes(manifest.types)
      return { key, created: false, manifest }
    }
    const site = await sfs.createSite(manifest.title, { types: manifest.types })
    if (manifest.public !== false) await site.makePublic()
    await site.publish(full)
    return { key: site.key, created: true, manifest }
  }

  /** @param {Params} p */
  async function open ({ key, timeout = 30000 }) {
    if (typeof key !== 'string') throw error('INVALID_PARAMS', 'site.open needs { key }')
    opening++
    try {
      return await openSite(key, timeout)
    } finally {
      opening--
    }
  }

  /**
   * @param {string} key a site's key, or an hg: link
   * @param {number} timeout
   * @returns {Promise<{ key: string, manifest: Manifest, dynamic: boolean, draft?: true, instance?: string, notify?: 'ask' }>}
   */
  async function openSite (key, timeout) {
    stay(key)
    await Promise.all(departing.values()) // a site being left is joined again once it is gone
    let site
    if (key.startsWith('hg:')) site = await sfs.visit(key, { timeout })
    else site = await visitSite(key, timeout)
    const draft = works.draft(site.key)
    if (draft) {
      const manifest = await works.draftManifest(site.key)
      if (manifest.types) await site.declareTypes(manifest.types).catch(() => {})
      const known = sites.get(site.key)
      if (known) Object.assign(known, { manifest, tabs: known.tabs + 1 })
      else sites.set(site.key, { site, manifest, scope: null, instances: new Map(), idle: new Map(), tabs: 1, draft: site.key })
      return { key: site.key, manifest, dynamic: isDynamic(manifest), draft: true }
    }
    if (site.app) {
      await listInstance(site.app, site.key, true)
      return { ...(await openSite(site.app, timeout)), instance: site.key }
    }
    const manifest = parseManifest(await site.read('site.json', { timeout }).catch((/** @type {CodedError} */ err) => {
      throw err.code === 'NOT_FOUND' ? error('NO_MANIFEST', 'this site has no site.json') : err
    }))
    stay(site.key)
    notes.refresh(site.key, manifest).catch(() => {})
    const known = sites.get(site.key)
    if (known) Object.assign(known, { manifest, tabs: known.tabs + 1 })
    else sites.set(site.key, { site, manifest, scope: null, instances: new Map(), idle: new Map(), tabs: 1 })
    return { key: site.key, manifest, dynamic: isDynamic(manifest), ...(await askNotify(site.key, manifest)) }
  }

  /** @param {string} key @returns {Promise<Site>} */
  async function visitSite (key, timeout = 30000) {
    if (!KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
    let held = true
    try { sfs.hg.space(key) } catch { held = false }
    return held ? sfs.site(key, { timeout }) : sfs.visit('hg:' + key, { timeout })
  }

  /** @param {string} key @param {Manifest} manifest @returns {Promise<{ notify?: 'ask' }>} */
  async function askNotify (key, manifest) {
    if (!manifest.permissions.includes('notifications') || !manifest.notifications?.length) return {}
    const s = await sfs.hg.settings()
    return s[ANSWERS]?.[key] === true && typeof s[PERMITS]?.[key]?.notifications !== 'boolean' ? { notify: 'ask' } : {}
  }

  /** @param {Params} params */
  async function read ({ key, path: p, timeout }) {
    const s = opened(keyOf({ key }))
    const clean = p === '' || p === '/' ? s.manifest.entry : sitePath(p)
    if (!clean) throw error('NOT_FOUND', `no page ${p}`)
    if (s.draft) return { bytes: await works.readDraft(s.draft, clean), path: clean }
    return { bytes: await s.site.read(clean, { timeout }), path: clean }
  }

  /** @param {Params} p */
  async function addPhotos ({ space, paths }) {
    if (typeof space !== 'string' || !Array.isArray(paths) || !paths.every((x) => typeof x === 'string')) throw error('INVALID_PARAMS', 'photos.add needs { space, paths }')
    const drive = sfs.space(space)
    let added = 0
    for (const file of paths) { await drive.addPhoto(file); added++ }
    return { added }
  }

  /** @param {Params} p */
  function state ({ key }) {
    const { site } = opened(keyOf({ key }))
    return { complete: site.space.isComplete() && site.pages.space.isComplete(), peers: site.space.peers().length }
  }

  /** @param {Params} p */
  async function keep ({ key, keep, timeout }) {
    const { site, manifest } = opened(keyOf({ key }))
    if (typeof keep !== 'boolean') throw error('INVALID_PARAMS', 'site.keep needs { keep: true | false }')
    await site.keep(keep, { timeout }) // SwarmFS remembers it for this device; the setting, for every device
    await sfs.hg.setSetting(INSTALLED + key, keep ? manifest.title : null)
    if (!keep) await notes.forgetApp(key)
    return { kept: keep }
  }

  // Reads every held file record: the shell asks every few seconds, not more.
  /** @param {Params} p */
  async function held ({ key }) {
    const { site } = opened(keyOf({ key }))
    return { bytes: await site.held(), kept: await site.kept() }
  }

  /** @param {{ key?: unknown }} p @returns {string} */
  function keyOf ({ key }) {
    if (typeof key !== 'string') throw error('INVALID_PARAMS', 'needs { key }')
    if (!KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
    return key
  }

  /** @param {string} key */
  function opened (key) {
    const s = sites.get(key)
    if (!s) throw error('NOT_FOUND', 'open the site first (site.open)')
    return s
  }

  /** @param {Params} p */
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

  /** @param {Params} p */
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

  /** @param {string} key @param {string} permission @param {boolean} allow */
  function writePermit (key, permission, allow) {
    const write = answering.then(async () => {
      const all = (await sfs.hg.settings())[PERMITS] || {}
      await sfs.hg.setSetting(PERMITS, { ...all, [key]: { ...all[key], [permission]: allow } })
    })
    answering = write.catch(() => {})
    return write
  }

  /** @param {string} key */
  async function permitted (key, permission = 'contacts') {
    await target({ key })
    if (!opened(key).manifest.permissions.includes(permission)) throw error('NOT_ALLOWED', "this site's site.json doesn't ask for " + permission)
    const answer = ((await sfs.hg.settings())[PERMITS] || {})[key]?.[permission]
    if (answer === false) throw error('NOT_ALLOWED', 'the person said no to this site using their ' + permission)
    if (answer !== true) throw error('NEEDS_PERMISSION', 'ask the person first (site.permit)')
  }

  /** @param {At} at @returns {Promise<SiteHandle>} */
  async function target ({ key, sub, instance }) {
    const s = opened(keyOf({ key }))
    if (!isDynamic(s.manifest)) throw error('NOT_ALLOWED', 'a static site has no API')
    const answer = s.draft ? true : ((await sfs.hg.settings())[ANSWERS] || {})[/** @type {string} */ (key)] // a preview: its space is a throwaway
    if (answer === false) throw error('NOT_ALLOWED', 'the person said no to this site using their identity')
    if (answer !== true) throw error('NEEDS_CONSENT', 'ask the person first (site.consent)')
    if (!s.scope) {
      s.scope = sfs.hg.scope(/** @type {string} */ (key), { identity: 'main' })
      s.scope.catch(() => { s.scope = null })
    }
    const scope = instance === undefined || instance === null ? await s.scope : await instanceScope(s, /** @type {string} */ (key), /** @type {string} */ (instance))
    // a sub-space's scope has the space's methods too (hypergraph's type says Scope only)
    return sub === undefined || sub === null ? scope : /** @type {SiteHandle} */ (scope.subspace(/** @type {string} */ (sub)))
  }

  /** @param {string} app @returns {Promise<Record<string, true>>} */
  async function listed (app) {
    return (await sfs.hg.settings())[APP_PREFIX + app + '/instances'] || {}
  }

  // One read-and-write of an app's list at a time (as the consent answers).
  /** @param {string} app @param {string} key @param {boolean} on @returns {Promise<void>} */
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

  /** @param {Opened} s @param {string} app @param {string} key a page's: keyOf() checks it */
  async function instanceScope (s, app, key) {
    keyOf({ key })
    const old = key
    key = current(key)
    if (old !== key && !(await listed(app))[key] && (await listed(app))[old]) await listInstance(app, key, true)
    clearTimeout(s.idle.get(key)) // in use: not closed under this call
    try {
      return await useInstance(s, app, key)
    } finally {
      idleLater(s, app, key)
    }
  }

  /** @param {Opened} s @param {string} app @param {string} key */
  async function useInstance (s, app, key) {
    const list = await listed(app)
    const now = current(key) // renewed: the new place, listed under either key
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
    const i = await /** @type {Promise<Instance>} */ (s.instances.get(key))
    if (s.manifest.types && i.types !== s.manifest.types) { // the app's types, and those a new version added: owner, admins only
      i.types = s.manifest.types
      await i.site.declareTypes(i.types).catch(() => {})
    }
    return i.scope
  }

  // shortcut: a single call running longer than `idle` on an instance may see its handle closed (CLOSED); count the
  // calls in flight if that ever shows up.
  /** @param {Opened} s @param {string} app @param {string} key */
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

  /** @param {Opened} s @param {string} app @param {string} method @param {any[]} args a page's: checked here */
  async function instances (s, app, method, [a, b]) {
    if (method === 'instances.list') {
      /** @type {Array<{ key: string, name: string | null, role: string | null, public: boolean }>} */
      const out = []
      for (const key of Object.keys(await listed(app))) {
        let space
        try { space = sfs.hg.space(key) } catch { continue }
        out.push({ key, name: space.name ?? null, role: await space.getRole(sfs.hg.identity.publicKey), public: !!space.isPublic })
      }
      return out
    }
    if (method === 'instances.create') {
      if (typeof a !== 'string' || !a.trim() || a.length > 200) throw error('INVALID_PARAMS', "an instance's name is 1 to 200 characters")
      const pub = b?.public ?? false
      const priv = b?.private ?? false
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

  /** @param {string} app @param {unknown} link @returns {Promise<Site>} */
  async function joinInstance (app, link) {
    if (typeof link !== 'string' || !link.startsWith('hg:')) throw error('INVALID_PARAMS', "join takes an instance's link (hg:...)")
    const before = new Set(sfs.hg.spaces().map((x) => x.key))
    /** @type {Site | null} */
    let site = null
    /** @type {CodedError | null} */
    let failed = null
    try {
      site = await sfs.visit(link)
    } catch (err) {
      failed = /** @type {CodedError} */ (err) // NOT_FOUND: a space that isn't a site, refused below
    }
    // a circle's invite is joined through HyperBrowser only: a page's join of one is left at once (its one
    // use is spent: hypergraph can't tell a circle's link before redeeming it)
    const circle = sfs.hg.spaces().find((x) => !before.has(x.key) && !x.parent && isCircle(x.key))
    if (failed && failed.code !== 'NOT_FOUND' && !circle) throw failed
    if (circle || !site || site.app !== app) {
      for (const x of sfs.hg.spaces()) if (!before.has(x.key) && !x.parent) await sfs.leave(x.key).catch(() => {})
      throw error('NOT_ALLOWED', "that link is not to one of this app's instances")
    }
    await listInstance(app, site.key, true)
    return site
  }

  /** @param {string} key */
  function isCircle (key) {
    try { return sfs.hg.space(key).circle } catch { return false }
  }

  // Off the list first, so nothing reaches it while it goes.
  /** @param {string} app @param {string} key a page's: keyOf() checks it */
  async function leaveInstance (app, key) {
    keyOf({ key })
    if (!(await listed(app))[key]) throw error('NOT_ALLOWED', "not one of this app's instances")
    await listInstance(app, key, false)
    await notes.forget(key)
    for (const [id, x] of subs) if (x.instance === key) off({ id })
    clearTimeout(sites.get(app)?.idle.get(key))
    const scope = sites.get(app)?.instances.get(key)
    sites.get(app)?.instances.delete(key)
    if (scope) await scope.then((i) => i.scope.close(), () => {})
    await sfs.leave(key)
    const names = `${MINE_PREFIX}${app}/@${key}/`
    for (const n of Object.keys(await sfs.hg.settings())) if (n.startsWith(names)) await sfs.hg.setSetting(n, null)
    return true
  }

  /**
   * @param {SiteHandle} t
   * @param {unknown} args a page's
   * @param {unknown} [chain] a page's filters, each [name, args]
   */
  function query (t, args, chain = []) {
    if (!Array.isArray(args) || !Array.isArray(chain)) throw error('INVALID_PARAMS', 'args and chain are lists')
    /** @type {any} */
    let q = t.query(.../** @type {[string]} */ (args)) // a Query, its filters called by name (checked against FILTERS)
    for (const step of chain) {
      if (!Array.isArray(step) || !FILTERS.has(step[0])) throw error('INVALID_PARAMS', 'a query step is one of ' + [...FILTERS].join(', '))
      q = q[step[0]](...(step[1] || []))
    }
    return q
  }

  /** @param {Params} p */
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
      /** @type {Record<string, unknown>} */
      const out = { identity: t.identity.publicKey }
      for (const name of INFO) out[name] = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (t))[name] ?? null
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
    if (method === 'copies') return sfs.hg.copiesOf((args[0] === undefined || args[0] === null ? t : await ownSpace(key, t, args[0])).key)
    if (method === 'rotateKey') return plain(await sfs.hg.space(t.key).rotateKey()) // the handle has none; t passed the guard
    if (method === 'secure') return secure(t, args[0]) // hypergraph lets owners and admins only
    if (method === 'setHistory') { // who may decide: checked by hypergraph
      if (args[0] !== 'visible' && args[0] !== 'hidden') throw error('INVALID_PARAMS', "setHistory('visible' | 'hidden')")
      return plain(await sfs.hg.space(t.key).setHistory(args[0]))
    }
    if (method === 'setDisappearing') {
      const ms = args[0] ?? null
      if (ms !== null && (!Number.isSafeInteger(ms) || ms < 60000)) throw error('INVALID_PARAMS', 'setDisappearing(ms): at least 60000, or null: off')
      return plain(await sfs.hg.space(t.key).setDisappearing(ms))
    }
    if (method === 'trimHistory') {
      const before = args[0]?.before
      if (typeof before !== 'number' || Number.isNaN(before)) throw error('INVALID_PARAMS', 'trimHistory({ before }): a time in ms')
      return plain(await sfs.hg.space(t.key).trimHistory({ before }))
    }
    return plain(await /** @type {any} */ (t)[method](...args)) // a method of CALLS, called by name with the page's args
  }

  /** @param {SiteHandle} t @param {any} [opts] a page's: checked here */
  async function secure (t, opts = {}) {
    if (opts === null || typeof opts !== 'object' || (opts.forget !== undefined && typeof opts.forget !== 'boolean')) throw error('INVALID_PARAMS', 'secure({ forget }): forget is true or false')
    const fresh = await sfs.hg.space(t.key).secure({ forget: !!opts.forget })
    await followMoves()
    return { key: fresh.key }
  }

  /** @param {string} key */
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

  /** @param {string} key @param {SiteHandle} t @param {unknown} k @returns {Promise<SiteHandle>} */
  async function ownSpace (key, t, k) {
    keyOf({ key: k })
    if (k === t.key) return t
    if (t.key === key && (await listed(key))[/** @type {string} */ (k)]) return target({ key, instance: k })
    try { return /** @type {SiteHandle} */ (t.subspace(/** @type {string} */ (k))) } catch { throw error('NOT_ALLOWED', "not this site's space, one of its sub-spaces or instances") }
  }

  // Never in the site's space; the key prefix keeps other sites' names out of reach.
  /** @param {string} key @param {string} method @param {any[]} args a page's: checked here @param {unknown} instance */
  async function mine (key, method, [name, value], instance) {
    const site = `${MINE_PREFIX}${key}/`
    const prefix = instance ? `${site}@${instance}/` : site
    if (method === 'mine.all') {
      /** @type {Record<string, unknown>} */
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

  // the app's own places only, whatever instance the page names (the list is the engine's).
  /** @param {string} key @param {string} method @param {any[]} args a page's */
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

  /** @param {any[]} args a page's: checked here */
  function sinceArgs ([cursor, o]) {
    if (o !== undefined && (o === null || typeof o !== 'object' || Array.isArray(o))) throw error('INVALID_PARAMS', 'since(cursor, { types, limit })')
    const limit = o?.limit ?? SINCE_MAX
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > SINCE_MAX) throw error('INVALID_PARAMS', `limit is 1 to ${SINCE_MAX}`)
    return [cursor ?? null, { ...o, limit }]
  }

  /** @param {Params} p */
  async function live ({ key, sub, instance, args = [], chain = [], opts }) {
    const t = await target({ key, sub, instance })
    const q = query(t, args, chain)
    const id = nextSub++
    const stop = q.live((/** @type {import('./types.js').Page} */ r) => rpc.emit('live', { id, items: plain(r.items), complete: r.complete }), opts)
    subs.set(id, { key, instance, stop })
    return { id }
  }

  /** @param {Params} p */
  async function listen ({ key, sub, instance, event }) {
    if (event === 'contacts') { // the list may have changed (any setting did: the site reads again)
      await permitted(key)
      const id = nextSub++
      const fn = () => rpc.emit('event', { id, data: null })
      sfs.hg.on('settings', fn)
      subs.set(id, { key, contacts: true, stop: () => sfs.hg.off('settings', fn) })
      return { id }
    }
    if (event === 'projects') {
      await permitted(key, 'projects')
      const id = nextSub++
      const stop = works.onChange((data) => { if (subs.has(id)) rpc.emit('event', { id, data }) })
      subs.set(id, { key, stop })
      return { id }
    }
    if (event === 'copies') {
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
    if (event === 'notifications') {
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
    /** @param {unknown} data */
    const fn = (data) => rpc.emit('event', { id, data: plain(data) })
    t.on(event, fn)
    subs.set(id, { key, instance, stop: () => t.off(event, fn) })
    return { id }
  }

  /** @param {Params} p */
  function off ({ id }) {
    const s = subs.get(id)
    if (s) {
      subs.delete(id)
      s.stop()
      const site = s.instance && sites.get(s.key)
      if (site) idleLater(site, s.key, /** @type {string} */ (s.instance))
    }
    return true
  }

  /** @param {string} key */
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

  /** @param {string} key */
  async function closeSite (key) {
    const s = sites.get(key)
    if (s && --s.tabs > 0) return true
    await release(key)
    sites.delete(key)
    if (s) leaveLater(key, s.site)
    return true
  }

  // An instance stays joined after its tab closes, or an invite-only forum would be lost.
  /** @param {Site} site */
  async function hosted (site) {
    return !!site.app || bundled.has(site.key) || (await site.kept()) || /** @type {Array<string | null>} */ (['owner', 'admin']).includes(await site.space.getRole(sfs.hg.identity.publicKey))
  }

  /** @param {string} key */
  function stay (key) {
    clearTimeout(leaving.get(key))
    leaving.delete(key)
  }

  /** @param {string} key @param {Site} site */
  function leaveLater (key, site) {
    stay(key)
    leaving.set(key, setTimeout(() => {
      leaving.delete(key)
      if (closing || sites.has(key)) return
      if (opening) return leaveLater(key, site) // a link being opened may be this site
      const left = hosted(site).then(/** @returns {unknown} */ (h) => h || sfs.leave(key)).catch(() => {}).finally(() => departing.delete(key))
      departing.set(key, left)
    }, grace))
  }

  // Older versions never left visited sites: leave them now (their cached files stay).
  async function sweep () {
    const settings = await sfs.hg.settings()
    for (const { key, parent, name } of sfs.hg.spaces()) {
      if (parent) continue
      const site = await sfs.site(key, { timeout: 0 }).catch(() => null)
      if (site && !(await hosted(site).catch(() => true))) await sfs.leave(key).catch(() => {})
      else if (site && !((INSTALLED + key) in settings) && await site.kept().catch(() => false)) await sfs.hg.setSetting(INSTALLED + key, name ?? '')
    }
  }

  /** @param {Params} p */
  async function resolveName ({ address, timeout }) {
    if (typeof address !== 'string' || !address.includes('@')) throw error('INVALID_PARAMS', 'names.resolve needs { address: name@authority }')
    let found
    try {
      found = await hyperdns.resolveAddress(address, { hg: sfs.hg, timeout })
    } catch (err) {
      if (/** @type {Error} */ (err).message === 'Invalid address format') throw error('INVALID_PARAMS', 'not name@authority: ' + address)
      throw err
    }
    for (const { value } of found.records) {
      const key = value.replace(/^hyper:\/\//i, '')
      if (KEY.test(key) || /^hg:\S+$/.test(key)) return { key, authority: found.authority }
    }
    throw error('NOT_A_SITE', address + ' points to no site (no key among its records)')
  }

  /** @param {string} bundle @returns {Promise<Bundle | null>} */
  async function readBundle (bundle) {
    try {
      const list = JSON.parse(await fs.promises.readFile(path.join(bundle, 'bundle.json'), 'utf-8'))
      return typeof list?.id === 'string' && Array.isArray(list.apps) ? { id: list.id, apps: list.apps.filter((/** @type {any} */ a) => typeof a?.key === 'string' && KEY.test(a.key)) } : null
    } catch {
      return null
    }
  }

  // A newer version held here stays (hypergraph never takes a core back); a failed app is retried next start.
  /** @param {string} bundle @param {Bundle} list @param {string} dir */
  async function unbundle (bundle, list, dir) {
    const marker = path.join(dir, 'bundled.json')
    /** @type {string | null} */
    let done = null
    try { done = JSON.parse(await fs.promises.readFile(marker, 'utf-8')).id } catch {}
    /** @param {string} key */
    const held = (key) => { try { sfs.hg.space(key); return true } catch { return false } }
    const todo = list.apps.filter((a) => done !== list.id || !held(a.key))
    let failed = false
    for (const a of todo) {
      try {
        await sfs.importSites(path.join(bundle, a.key), { timeout: 10000 })
      } catch (e) {
        failed = true
        const err = /** @type {CodedError} */ (e)
        console.error(`bundled app ${a.id} (${a.key}) not imported: ${err.code || 'ERROR'} ${err.message}`)
      }
    }
    if (todo.length && !failed) await fs.promises.writeFile(marker, JSON.stringify({ id: list.id }))
  }

  /** @param {Params} p */
  const secret = ({ password, recoveryPhrase }) => ({ password, recoveryPhrase })

  async function devices () {
    const list = await sfs.hg.devices()
    let phrase = 'plain'
    try {
      if (await sfs.hg.recoveryPhrase() === null) phrase = 'forgotten'
    } catch { phrase = 'protected' }
    /** @type {Array<{ key: string, name: string }>} */
    const owns = []
    for (const s of sfs.hg.spaces()) {
      if (!s.parent && (await sfs.hg.space(s.key).getRole(sfs.hg.identity.publicKey).catch(() => null)) === 'owner') owns.push({ key: s.key, name: s.name ?? '' })
    }
    // shortcut: "removed" = this device left out of a list that has others (hypergraph drops removed devices
    // from devices()); a device that just joined and holds no list yet reads as not removed.
    const removed = list.length > 0 && !list.some((d) => d.current)
    return { identity: sfs.hg.identity.publicKey, devices: list, removed, phrase, owns }
  }

  async function installed () {
    /** @type {{ sites: Array<{ key: string, title: string }>, uninstalled: string[] }} */
    const out = { sites: [], uninstalled: [] }
    for (const [n, title] of Object.entries(await sfs.hg.settings())) {
      if (!n.startsWith(INSTALLED)) continue
      if (title === null) out.uninstalled.push(n.slice(INSTALLED.length))
      else out.sites.push({ key: n.slice(INSTALLED.length), title })
    }
    return out
  }

  /** @param {string} reason */
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
        if (seeding) await seeding.close()
        if (opening) await opening.then((s) => s.close(), () => {})
        sfs = /** @type {SwarmFS} */ (/** @type {unknown} */ (null))
        setTimeout(() => rpc.end(), 0) // after the reply to 'close'
        closed(reason)
      })()
    }
    return closing
  }

  // Told without its stack: that stays in the log.
  /** @param {unknown} err anything: a throw can be of any value */
  function escaped (err) {
    const e = { message: String(/** @type {CodedError | undefined} */ (err)?.message ?? err), code: /** @type {CodedError | undefined} */ (err)?.code ?? null, method: /** @type {CodedError | undefined} */ (err)?.method ?? null }
    try { rpc.emit('engine.error', e) } catch {} // the channel may be closing: telling must never throw back into guard
    return e
  }

  return { closed: done, escaped }
}

/**
 * Logged and told, and the engine keeps running (else Bare aborts the process). Never in tests: failures stay loud.
 * @param {ReturnType<typeof start>} engine
 * @param {{ on (event: 'uncaughtException' | 'unhandledRejection', fn: (err: unknown) => void): unknown }} target process, or Bare
 * @param {{ stack?: boolean }} [opts]
 */
export function guard (engine, target, { stack = true } = {}) {
  /** @param {unknown} err */
  const on = (err) => {
    const { message, code, method } = engine.escaped(err)
    console.error(`escaped error${code ? ' ' + code : ''}${method ? ' in ' + method : ''}: ${stack && /** @type {Error | undefined} */ (err)?.stack ? /** @type {Error} */ (err).stack : message}`)
  }
  target.on('uncaughtException', on)
  target.on('unhandledRejection', on)
}

/**
 * A value as a page gets it: plain JSON and bytes; an object of a class (a Space) is its key and name.
 * @param {unknown} value
 * @returns {unknown}
 */
function plain (value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map(plain)
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    return typeof /** @type {{ key?: unknown }} */ (value).key === 'string' ? { key: /** @type {{ key: string }} */ (value).key, name: /** @type {{ name?: unknown }} */ (value).name ?? null } : null
  }
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const k of Object.keys(value)) if (typeof /** @type {Record<string, unknown>} */ (value)[k] !== 'function') out[k] = plain(/** @type {Record<string, unknown>} */ (value)[k])
  return out
}
