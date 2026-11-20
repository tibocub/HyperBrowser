import fs from 'fs'
import path from 'path'
import { GB } from './circles.js'

const SPARE = 2 * GB
const DEFAULT_MAX = 100 * GB
const MIN = 0.1 * GB
const TICK = 60000
const HOUR = 3600000
const OPEN = 30000

/** @typedef {import('./helper-config.js').HelperConfig} HelperConfig */
/** @typedef {Error & { code?: string }} CodedError */
/** @typedef {{ app: string, title: string, bytes: number }} Kept */

/** @param {number} b */
const gb = (b) => Math.floor(b / GB * 10) / 10
// shortcut: hypergraph says "nobody answered" only in INVITE_INVALID's message; a code of its own would be cleaner
/** @param {CodedError} err */
const unanswered = (err) => err.code === 'INVITE_INVALID' && /answered within/.test(err.message)

/**
 * The always-on helper's passes: its name, its share of disk, the circles it joins, the apps it keeps.
 * @param {object} opts
 * @param {import('./protocol.js').Rpc} opts.rpc its engine
 * @param {string} opts.dir the engine folder
 * @param {string} opts.preset shell/preset.json: the official apps
 * @param {(line: string) => void} [opts.log]
 * @param {number} [opts.tick]
 * @param {number} [opts.summary]
 */
export function helper ({ rpc, dir, preset, log = console.log, tick = TICK, summary = HOUR }) {
  const FILE = path.join(dir, 'helper.json')
  /** @type {{ links: Record<string, 'joined' | 'refused'>, share: number | null, kept: Record<string, Kept> }} */
  let state = { links: {}, share: null, kept: {} }
  try { state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf-8')) } } catch {}
  const save = () => fs.promises.writeFile(FILE, JSON.stringify(state, null, 2))
  /** @type {HelperConfig} */
  let config // set by apply() before any pass
  /** @type {Promise<unknown>} */
  let running = Promise.resolve()
  let closed = false
  const told = new Set()
  /** @param {string} id @param {string} line */
  const once = (id, line) => { if (!told.has(id)) { told.add(id); log(line) } }
  /** @param {CodedError} err */
  const fail = (err) => log(`error: ${err.code || 'ERROR'} ${err.message}`)
  const pass = () => (running = running.then(/** @returns {unknown} */ () => closed || run()).catch(fail))
  /** @type {Promise<void> | null} */
  let fetching = null // the apps' pass, beside the others: an app nobody serves yet waits OPEN, joins don't
  const fetch = () => (fetching ||= apps().catch(fail).finally(() => { fetching = null }))
  const timer = setInterval(() => { if (config) pass() }, tick)
  const hourly = setInterval(() => { running = running.then(report).catch(() => {}) }, summary)

  async function run () {
    await name()
    await share()
    await joins()
    fetch()
  }

  async function name () {
    if ((await rpc.request('contacts.me')).name === config.name) return
    await rpc.request('contacts.setMe', { name: config.name })
    log(`name: ${config.name}`)
  }

  async function share () {
    const h = await rpc.request('holding.get')
    if (!config.share && !state.share) {
      state.share = Math.min(DEFAULT_MAX, Math.floor(h.free / 2))
      await save()
    }
    const want = config.share ? Math.round(config.share * GB) : /** @type {number} */ (state.share)
    const room = Math.floor(h.free + h.used - SPARE)
    const bytes = Math.min(want, room)
    if (bytes < MIN) return once('room', `share: no room on this disk (${gb(h.free)} GB free); holding stays ${h.on ? 'on' : 'off'}`)
    if (h.on && Math.abs(h.bytes - bytes) < MIN) return // when capped, free space drifts a few MB between passes
    await rpc.request('holding.set', { on: true, bytes })
    log(bytes < want ? `share: ${gb(bytes)} GB (capped: ${gb(want)} GB asked, the disk keeps 2 GB free)` : `share: ${gb(bytes)} GB`)
  }

  async function joins () {
    for (const link of config.join) {
      if (state.links[link]) continue
      try {
        const r = await rpc.request('circles.join', { link })
        state.links[link] = 'joined'
        log(`joined "${r.name}"`)
      } catch (e) {
        const err = /** @type {CodedError} */ (e)
        if (unanswered(err)) { once('join' + link, `join: nobody answered yet (${link.slice(0, 16)}...); trying again every minute`); continue }
        state.links[link] = 'refused'
        log(`refused: ${err.message} (${link.slice(0, 16)}...)`)
      }
      await save()
    }
  }

  function wanted () {
    const keys = new Set(config.seed)
    if (config.apps === 'official') {
      try {
        for (const p of JSON.parse(fs.readFileSync(preset, 'utf-8'))) if (p.key) keys.add(p.key)
      } catch (err) { once('preset', `apps: can't read ${preset} (${/** @type {Error} */ (err).message})`) }
    }
    return keys
  }

  async function apps () {
    const want = wanted()
    await Promise.all([...want].map(async (key) => {
      try {
        const r = await rpc.request('site.open', { key, timeout: state.kept[key] ? 0 : OPEN })
        try {
          const was = state.kept[key]
          if (!was) await rpc.request('site.keep', { key: r.key, keep: true, timeout: OPEN })
          const { bytes } = await rpc.request('site.held', { key: r.key })
          // shortcut: a new version is seen as a new size; a same-size edit isn't logged (no version in site.json)
          if (!was) log(`keeping ${r.manifest.title} (${key})`)
          else if (was.bytes !== bytes) log(`${r.manifest.title}: new version (${Math.round(bytes / 1024)} KB)`)
          state.kept[key] = { app: r.key, title: r.manifest.title, bytes }
        } finally {
          await rpc.request('site.close', { key: r.key })
        }
        told.delete('app' + key)
      } catch (err) {
        once('app' + key, `app ${key}: not reached yet (${/** @type {CodedError} */ (err).code || 'ERROR'}); trying again every minute`)
      }
    }))
    for (const [key, k] of Object.entries(state.kept)) {
      if (want.has(key)) continue
      // shortcut: an instance's app handed back; the instance itself stays joined (instances.leave is the app's)
      await rpc.request('site.open', { key, timeout: 0 }).then((r) => rpc.request('site.keep', { key: r.key, keep: false }).finally(() => rpc.request('site.close', { key: r.key }))).catch(() => {})
      delete state.kept[key]
      log(`no longer keeping ${k.title} (${key})`)
    }
    await save()
  }

  async function report () {
    const circles = await rpc.request('circles.list')
    const h = await rpc.request('holding.get')
    const apps = Object.values(state.kept).map((k) => `${k.title} ${Math.round(k.bytes / 1024)} KB`).join(', ') || 'none'
    log(`summary: ${circles.length} circle(s), ${circles.reduce((/** @type {number} */ n, /** @type {{ members: number }} */ c) => n + c.members, 0)} member(s); holding ${gb(h.used)} of ${gb(h.bytes)} GB; apps: ${apps}`)
  }

  return {
    /** @param {HelperConfig} next */
    apply (next) {
      config = next
      return pass().then(() => fetching)
    },
    report: () => (running = running.then(report)),
    close () {
      closed = true
      clearInterval(timer)
      clearInterval(hourly)
      return Promise.all([running, fetching])
    }
  }
}
