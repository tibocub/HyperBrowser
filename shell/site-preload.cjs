// The page never names a site: the shell takes it from this view.
const { contextBridge, ipcRenderer } = require('electron')

const METHODS = ['put', 'get', 'edit', 'del', 'since', 'linked', 'count', 'sum', 'members', 'decisions', 'tags', 'relate',
  'unrelate', 'edges', 'tag', 'untag', 'getByTag', 'getRole', 'setRole', 'removeRole', 'defineRole', 'roles',
  'moderateAction', 'report', 'reports', 'createInvite', 'revokeInvite', 'createSubspace', 'subspaces',
  'redemptions', 'peers', 'status', 'isComplete', 'completeFrom', 'types', 'info', 'copies', 'rotateKey', 'secure', 'trimHistory']
const FILTERS = ['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice']

/** @typedef {{ sub: string | null, instance: string | null }} At The space a call is for. */

/** @type {Map<number, (data: unknown) => void>} */
const handlers = new Map()
/** @type {Map<number, unknown[]>} */
const early = new Map()
ipcRenderer.on('hyper-event', (e, { id, data }) => {
  const fn = handlers.get(id)
  if (fn) fn(data)
  else early.set(id, [...(early.get(id) || []), data])
})
// The first word of each real load, before the page can subscribe: the shell stops the last page's subscriptions.
// Its answer comes after anything they still sent here, and before any event of this page's own.
ipcRenderer.invoke('site', { op: 'page' }).then(() => early.clear(), () => {})

/** @param {object} msg @returns {Promise<any>} the call's answer, as sites/hyper.d.ts says per method */
async function invoke (msg) {
  const r = await ipcRenderer.invoke('site', msg)
  if (r.error) throw failure(r.error)
  return r.result
}

// An error as the page gets it: a plain { name, code, message }. An Error crossing the context bridge keeps its
// message only (Electron copies nothing else), so the page could never read `err.code`.
/** @param {{ code: string, message: string }} err @returns {Hyper.Failure} */
function failure ({ code, message }) {
  return { name: 'HyperError', code, message }
}

/** @param {object} msg @param {(data: any) => void} fn @returns {Hyper.Unsubscribe} */
function subscribe (msg, fn) {
  const started = invoke(msg).then((/** @type {{ id: number }} */ { id }) => {
    handlers.set(id, fn)
    for (const data of early.get(id) || []) fn(data)
    early.delete(id)
    return id
  })
  started.catch(() => {})
  return () => { started.then((id) => { handlers.delete(id); return invoke({ op: 'off', id }) }).catch(() => {}) }
}

/** @param {At} at @param {unknown[]} args @returns {Hyper.Query} */
function query (at, args) {
  /** @type {Array<[string, unknown[]]>} */
  const chain = []
  /** @type {any} */
  const q = {} // its filters are made by name from FILTERS
  for (const f of FILTERS) q[f] = (/** @type {unknown[]} */ ...a) => { chain.push([f, a]); return q }
  q.latest = (/** @type {unknown[]} */ ...a) => invoke({ op: 'call', ...at, method: 'query', args, chain: [...chain, ['latest', a]] })
  q.live = (/** @type {(page: Hyper.Page) => void} */ fn, /** @type {unknown} */ opts) => subscribe({ op: 'live', ...at, args, chain, opts }, (d) => fn({ items: d.items, complete: d.complete }))
  return q
}

/**
 * The API of one space; the site's own (sub and instance null) has HyperBrowser's services too.
 * @param {string | null} sub
 * @param {string | null} [instance]
 * @returns {Hyper.Site} the site's own; a sub-space's or an instance's has only what Hyper.Space or Hyper.Place has
 */
function api (sub, instance = null) {
  /** @type {At} */
  const at = { sub, instance }
  /** @type {any} */
  const o = {} // its methods are made by name from the lists above
  for (const m of METHODS) o[m] = (/** @type {unknown[]} */ ...args) => invoke({ op: 'call', ...at, method: m, args })
  o.query = (/** @type {unknown[]} */ ...args) => query(at, args)
  o.on = (/** @type {string} */ event, /** @type {(data: unknown) => void} */ fn) => subscribe({ op: 'on', ...at, event }, fn)
  if (sub === null) {
    o.subspace = (/** @type {unknown} */ key) => api(String(key), instance)
    o.mine = {
      all: () => invoke({ op: 'call', ...at, method: 'mine.all', args: [] }),
      set: (/** @type {string} */ name, /** @type {unknown} */ value) => invoke({ op: 'call', ...at, method: 'mine.set', args: [name, value ?? null] })
    }
  }
  if (sub === null && instance === null) {
    o.instances = {
      list: () => invoke({ op: 'call', ...at, method: 'instances.list', args: [] }),
      create: (/** @type {unknown} */ name, /** @type {unknown} */ opts) => invoke({ op: 'call', ...at, method: 'instances.create', args: [name, opts ?? {}] }),
      join: (/** @type {unknown} */ link) => invoke({ op: 'call', ...at, method: 'instances.join', args: [link] }),
      leave: (/** @type {unknown} */ key) => invoke({ op: 'call', ...at, method: 'instances.leave', args: [key] })
    }
    o.instance = (/** @type {unknown} */ key) => api(null, String(key))
    o.contacts = {}
    for (const m of ['me', 'setMe', 'list', 'request', 'accept', 'decline', 'remove', 'rename', 'link', 'add', 'circles', 'inviteToCircle']) {
      o.contacts[m] = (/** @type {unknown[]} */ ...args) => invoke({ op: 'call', ...at, method: 'contacts.' + m, args })
    }
    o.contacts.on = (/** @type {() => void} */ fn) => subscribe({ op: 'on', ...at, event: 'contacts' }, () => fn())
    // openFolder() takes no path: HyperBrowser asks the person to pick the folder.
    o.projects = {}
    for (const m of ['list', 'create', 'openFolder', 'openCopy', 'join', 'leave', 'files', 'mkdir', 'build', 'read', 'write', 'rename', 'remove', 'publish',
      'versions', 'rollBack', 'preview', 'resetPreview', 'closePreview', 'invite', 'inviteContact', 'members', 'removeMember', 'status']) {
      o.projects[m] = (/** @type {unknown[]} */ ...args) => invoke({ op: 'call', ...at, method: 'projects.' + m, args })
    }
    o.projects.on = (/** @type {(change: { project: string }) => void} */ fn) => subscribe({ op: 'on', ...at, event: 'projects' }, fn)
    // any site, through HyperBrowser: opening needs a click on the page; a request, the person's yes
    o.people = {
      chat: (/** @type {unknown} */ identity) => people('chat', identity),
      contact: (/** @type {unknown} */ identity) => people('contact', identity),
      request: (/** @type {unknown} */ identity, /** @type {unknown} */ name) => people('request', identity, name)
    }
    // A page can't read the person's notifications or their settings.
    o.notifications = {
      viewing: (/** @type {unknown} */ instance) => invoke({ op: 'viewing', instance: instance === null || instance === undefined ? null : String(instance) }),
      unread: () => invoke({ op: 'call', ...at, method: 'notifications.unread', args: [] }),
      on: (/** @type {(unread: unknown) => void} */ fn) => subscribe({ op: 'on', ...at, event: 'notifications' }, fn),
      follow: (/** @type {unknown} */ f) => invoke({ op: 'call', ...at, method: 'notifications.follow', args: [f] }),
      unfollow: (/** @type {unknown} */ id) => invoke({ op: 'call', ...at, method: 'notifications.unfollow', args: [String(id)] }),
      follows: () => invoke({ op: 'call', ...at, method: 'notifications.follows', args: [] })
    }
    o.circles = {
      join: async (/** @type {unknown} */ link, /** @type {unknown} */ name) => {
        const r = await ipcRenderer.invoke('circles', { op: 'join', link: String(link), name: name === undefined ? undefined : String(name), activated: navigator.userActivation.isActive })
        if (r.error) throw failure(r.error)
        return r.result
      }
    }
    o.apps = {
      installed: (/** @type {unknown} */ key) => apps('installed', key),
      install: (/** @type {unknown} */ key) => apps('install', key),
      open: (/** @type {unknown} */ key) => apps('open', key)
    }
  }
  return o
}

/** @param {string} op @param {unknown} identity @param {unknown} [name] */
async function people (op, identity, name) {
  const r = await ipcRenderer.invoke('people', { op, identity: String(identity), name: name === undefined ? undefined : String(name), activated: navigator.userActivation.isActive })
  if (r.error) throw failure(r.error)
  return r.result
}

/** @param {string} op @param {unknown} key */
async function apps (op, key) {
  const r = await ipcRenderer.invoke('apps', { op, key: String(key), activated: navigator.userActivation.isActive })
  if (r.error) throw failure(r.error)
  return r.result
}

contextBridge.exposeInMainWorld('hyper', api(null))
