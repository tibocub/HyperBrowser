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
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code })
  return r.result
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
  if (sub === null) o.subspace = (key) => api(String(key), instance)
  if (sub === null && instance === null) {
    // the person's own data for this site, on their devices (spec 006)
    o.mine = {
      all: () => invoke({ op: 'call', ...at, method: 'mine.all', args: [] }),
      set: (name, value) => invoke({ op: 'call', ...at, method: 'mine.set', args: [name, value ?? null] })
    }
    // the app's instances: communities of their own, owned by whoever made them (spec 009)
    o.instances = {
      list: () => invoke({ op: 'call', ...at, method: 'instances.list', args: [] }),
      create: (name, opts) => invoke({ op: 'call', ...at, method: 'instances.create', args: [name, opts ?? {}] }),
      join: (link) => invoke({ op: 'call', ...at, method: 'instances.join', args: [link] }),
      leave: (key) => invoke({ op: 'call', ...at, method: 'instances.leave', args: [key] })
    }
    o.instance = (key) => api(null, String(key))
  }
  return o
}

contextBridge.exposeInMainWorld('hyper', api(null))
