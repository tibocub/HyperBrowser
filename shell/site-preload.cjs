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

function query (sub, args) {
  const chain = []
  const q = {}
  for (const f of FILTERS) q[f] = (...a) => { chain.push([f, a]); return q }
  q.latest = (...a) => invoke({ op: 'call', sub, method: 'query', args, chain: [...chain, ['latest', a]] })
  q.live = (fn, opts) => subscribe({ op: 'live', sub, args, chain, opts }, (d) => fn({ items: d.items, complete: d.complete }))
  return q
}

function api (sub) {
  const o = {}
  for (const m of METHODS) o[m] = (...args) => invoke({ op: 'call', sub, method: m, args })
  o.query = (...args) => query(sub, args)
  o.on = (event, fn) => subscribe({ op: 'on', sub, event }, fn)
  if (sub === null) {
    o.subspace = (key) => api(String(key))
    // the person's own data for this site, on their devices (spec 006)
    o.mine = {
      all: () => invoke({ op: 'call', sub, method: 'mine.all', args: [] }),
      set: (name, value) => invoke({ op: 'call', sub, method: 'mine.set', args: [name, value ?? null] })
    }
  }
  return o
}

contextBridge.exposeInMainWorld('hyper', api(null))
