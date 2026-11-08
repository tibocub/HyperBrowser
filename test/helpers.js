// Test helpers on Node and Bare: an engine started exactly as the worker does (start() on one end of a
// stream), on the test's own DHT (hypergraph/testing), and site folders.
import fs from 'fs'
import b4a from 'b4a'
import path from 'path'
import testing from 'hypergraph/testing'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'

export const { bootstrap, tmpDir, eventually, within, codeOf, sleep } = testing

// { rpc, dir, engine, events, next(event) }: init'ed unless { init: false }.
export async function engine (t, { init = true, dir = tmpDir(t, 'hb'), ...opts } = {}) {
  const [a, b] = pair()
  const events = []
  const waiters = []
  const listeners = new Set() // fn(event, data), for siteApi's live views
  const eng = start(a)
  const rpc = connect(b, {
    onEvent: (event, data) => {
      events.push({ event, data })
      for (const w of waiters.splice(0)) w({ event, data })
      for (const fn of listeners) fn(event, data)
    }
  })
  t.teardown(() => within(rpc.request('close').catch(() => {}), 15000)) // before the folders go (order 1000)
  if (init) await rpc.request('init', { dir, bootstrap: await bootstrap(t), ...opts })
  return { rpc, dir, engine: eng, events, listeners, next: () => new Promise((resolve) => waiters.push(resolve)) }
}

// A site's `window.hyper` as shell/site-preload.cjs makes it, on an engine of the tests (the site opened and
// allowed there): sites' own code (sites/forum/lib) runs on it unchanged. `instance`: hyper.instance(key) (spec 009).
const METHODS = ['put', 'get', 'edit', 'del', 'linked', 'count', 'sum', 'members', 'decisions', 'tags', 'relate',
  'unrelate', 'edges', 'tag', 'untag', 'getByTag', 'getRole', 'setRole', 'removeRole', 'defineRole', 'roles',
  'moderateAction', 'report', 'reports', 'createInvite', 'revokeInvite', 'createSubspace', 'subspaces',
  'redemptions', 'peers', 'status', 'isComplete', 'completeFrom', 'types', 'info']
const FILTERS = ['by', 'on', 'where', 'tag', 'since', 'until', 'moderated', 'fromDevice']

export function siteApi (e, key, instance = null) {
  const handlers = new Map()
  const early = new Map()
  e.listeners.add((event, data) => {
    if (event !== 'live' && event !== 'event') return
    const out = event === 'live' ? { items: data.items, complete: data.complete } : data.data
    if (handlers.has(data.id)) handlers.get(data.id)(out)
    else early.set(data.id, [...(early.get(data.id) || []), out])
  })
  const call = (method, args) => e.rpc.request('site.call', { key, instance, method, args })
  const subscribe = (method, params, fn) => {
    const started = e.rpc.request(method, { key, instance, ...params }).then(({ id }) => {
      handlers.set(id, fn)
      for (const d of early.get(id) || []) fn(d)
      early.delete(id)
      return id
    })
    started.catch(() => {})
    return () => { started.then((id) => { handlers.delete(id); return e.rpc.request('site.off', { id }) }).catch(() => {}) }
  }
  const api = {}
  for (const m of METHODS) api[m] = (...args) => call(m, args)
  api.query = (...args) => {
    const chain = []
    const q = {}
    for (const f of FILTERS) q[f] = (...a) => { chain.push([f, a]); return q }
    q.latest = (...a) => e.rpc.request('site.call', { key, instance, method: 'query', args, chain: [...chain, ['latest', a]] })
    q.live = (fn, opts) => subscribe('site.live', { args, chain, opts }, fn)
    return q
  }
  api.on = (event, fn) => subscribe('site.on', { event }, fn)
  api.mine = { all: () => call('mine.all', []), set: (name, value) => call('mine.set', [name, value ?? null]) }
  if (instance === null) {
    api.instances = {
      list: () => call('instances.list', []),
      create: (name, opts) => call('instances.create', [name, opts]),
      join: (link) => call('instances.join', [link]),
      leave: (k) => call('instances.leave', [k])
    }
    api.instance = (k) => siteApi(e, key, String(k))
    // spec 013: a site with the contacts permission
    api.contacts = {}
    for (const m of ['me', 'setMe', 'list', 'request', 'accept', 'decline', 'remove', 'rename', 'link', 'add']) api.contacts[m] = (...args) => call('contacts.' + m, args)
    api.contacts.on = (fn) => subscribe('site.on', { event: 'contacts' }, fn)
  }
  return api
}

// A folder with `files` ({ name: text }); site.json from `manifest` unless it is null.
export function siteFolder (t, { manifest = { title: 'Test site' }, files = { 'index.html': '<h1>hi</h1>' } } = {}) {
  const dir = tmpDir(t, 'site')
  if (manifest !== null) files = { 'site.json': typeof manifest === 'string' ? manifest : JSON.stringify(manifest), ...files }
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), text)
  }
  return dir
}

export const text = (bytes) => b4a.toString(bytes)
