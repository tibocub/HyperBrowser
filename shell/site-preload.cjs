// window.hyper, a dynamic site's whole API (specs/001-engine/contracts/site-api.md). A sandboxed preload:
// only ipcRenderer. The page never names a site: the shell takes it from this view.
const { contextBridge, ipcRenderer } = require('electron')

const METHODS = ['put', 'get', 'edit', 'del', 'linked', 'count', 'sum', 'members', 'decisions', 'tags', 'relate',
  'unrelate', 'edges', 'tag', 'untag', 'getByTag', 'getRole', 'setRole', 'removeRole', 'defineRole', 'roles',
  'moderateAction', 'report', 'reports', 'createInvite', 'revokeInvite', 'createSubspace', 'subspaces',
  'redemptions', 'peers', 'status', 'isComplete', 'completeFrom', 'types', 'info']
const FILTERS = ['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice']

const handlers = new Map() // subscription id -> fn
const early = new Map() // id -> data that came before its handler
ipcRenderer.on('hyper-event', (e, { id, data }) => {
  const fn = handlers.get(id)
  if (fn) fn(data)
  else early.set(id, [...(early.get(id) || []), data])
})

async function invoke (msg) {
  const r = await ipcRenderer.invoke('site', msg)
  if (r.error) throw failure(r.error)
  return r.result
}

// An error as the page gets it: a plain { name, code, message }. An Error crossing the context bridge keeps its
// message only (Electron copies nothing else), so the page could never read `err.code` (spec 013 found it).
function failure ({ code, message }) {
  return { name: 'HyperError', code, message }
}

// A live view or a listener: returns stop().
function subscribe (msg, fn) {
  const started = invoke(msg).then(({ id }) => {
    handlers.set(id, fn)
    for (const data of early.get(id) || []) fn(data)
    early.delete(id)
    return id
  })
  started.catch(() => {})
  return () => { started.then((id) => { handlers.delete(id); return invoke({ op: 'off', id }) }).catch(() => {}) }
}

function query (at, args) {
  const chain = []
  const q = {}
  for (const f of FILTERS) q[f] = (...a) => { chain.push([f, a]); return q }
  q.latest = (...a) => invoke({ op: 'call', ...at, method: 'query', args, chain: [...chain, ['latest', a]] })
  q.live = (fn, opts) => subscribe({ op: 'live', ...at, args, chain, opts }, (d) => fn({ items: d.items, complete: d.complete }))
  return q
}

// The site's own space (instance null), or one of the app's instances (spec 009); `sub`: one of its sub-spaces.
function api (sub, instance = null) {
  const at = { sub, instance }
  const o = {}
  for (const m of METHODS) o[m] = (...args) => invoke({ op: 'call', ...at, method: m, args })
  o.query = (...args) => query(at, args)
  o.on = (event, fn) => subscribe({ op: 'on', ...at, event }, fn)
  if (sub === null) {
    o.subspace = (key) => api(String(key), instance)
    // the person's own data for this site (spec 006), or for one instance of it (spec 009), on their devices
    o.mine = {
      all: () => invoke({ op: 'call', ...at, method: 'mine.all', args: [] }),
      set: (name, value) => invoke({ op: 'call', ...at, method: 'mine.set', args: [name, value ?? null] })
    }
  }
  if (sub === null && instance === null) {
    // the app's instances: communities of their own, owned by whoever made them (spec 009)
    o.instances = {
      list: () => invoke({ op: 'call', ...at, method: 'instances.list', args: [] }),
      create: (name, opts) => invoke({ op: 'call', ...at, method: 'instances.create', args: [name, opts ?? {}] }),
      join: (link) => invoke({ op: 'call', ...at, method: 'instances.join', args: [link] }),
      leave: (key) => invoke({ op: 'call', ...at, method: 'instances.leave', args: [key] })
    }
    o.instance = (key) => api(null, String(key))
    // the person's contacts (spec 013): only for a site whose site.json asks for "contacts", once allowed
    o.contacts = {}
    for (const m of ['me', 'setMe', 'list', 'request', 'accept', 'decline', 'remove', 'rename', 'link', 'add']) {
      o.contacts[m] = (...args) => invoke({ op: 'call', ...at, method: 'contacts.' + m, args })
    }
    o.contacts.on = (fn) => subscribe({ op: 'on', ...at, event: 'contacts' }, () => fn())
    // any site, through HyperBrowser (spec 013): opening needs a click on the page; a request, the person's yes
    o.people = {
      chat: (identity) => people('chat', identity),
      contact: (identity) => people('contact', identity),
      request: (identity, name) => people('request', identity, name)
    }
    // other sites, through HyperBrowser (spec 014): install and open need a click on the page; install, the person's yes
    o.apps = {
      installed: (key) => apps('installed', key),
      install: (key) => apps('install', key),
      open: (key) => apps('open', key)
    }
  }
  return o
}

async function people (op, identity, name) {
  const r = await ipcRenderer.invoke('people', { op, identity: String(identity), name: name === undefined ? undefined : String(name), activated: navigator.userActivation.isActive })
  if (r.error) throw failure(r.error)
  return r.result
}

async function apps (op, key) {
  const r = await ipcRenderer.invoke('apps', { op, key: String(key), activated: navigator.userActivation.isActive })
  if (r.error) throw failure(r.error)
  return r.result
}

contextBridge.exposeInMainWorld('hyper', api(null))
