// Only this file bridges a site to the engine, and it names the site from the view, never the page.
import { app, BaseWindow, ipcMain, protocol, dialog, Menu, webContents, nativeTheme, Notification, session } from 'electron'
import fs from 'fs'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import PearRuntime from 'pear-runtime'
import { connect, pair } from '../engine/protocol.js'
import { createSiteView, resolveNoNames } from './views.js'
import { startFrame } from './frame.js'
import { identities } from './identities.js'

/**
 * @typedef {import('electron').WebContents} WebContents
 * @typedef {import('electron').BaseWindow} BaseWindowT
 * @typedef {import('../engine/protocol.js').Rpc} Rpc
 * @typedef {import('../engine/manifest.js').Manifest} Manifest
 * @typedef {import('./frame.js').SiteView} SiteView
 * @typedef {ReturnType<typeof startFrame>} Frame
 * @typedef {import('./ui/frame.js').Note} Note
 * @typedef {{ site: string, name: string, pass: boolean }} Check A self-test line.
 * @typedef {(name: string, ok: unknown) => unknown} Pass
 * @typedef {{ code?: string, message: string }} Thrown
 * @typedef {{ manifest: Manifest, dynamic: boolean }} Opened
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELFTEST = process.argv.includes('--selftest')
const FRAMECHECK = process.argv.includes('--framecheck')
const GUARDS = !process.argv.includes('--no-guards')
const TRAYCHECK = process.argv.includes('--traycheck') ? process.argv[process.argv.indexOf('--traycheck') + 1] : null
const IDCHECK = process.argv.includes('--identitycheck') ? process.argv[process.argv.indexOf('--identitycheck') + 1] : null
const HEARTBEAT = 2000
/** @param {string} name */
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1] }

/** @type {Record<string, string | undefined>} */
const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript',
  css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', wasm: 'application/wasm'
}
/** @param {string} p */
const typeOf = (p) => TYPES[/** @type {string} */ (p.split('.').pop()).toLowerCase()] || 'application/octet-stream'
const PKG = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf-8'))
/** @type {import('./model.js').Icon[]} */
const PRESET = JSON.parse(fs.readFileSync(path.join(HERE, 'preset.json'), 'utf-8'))
const APPS = { chat: PRESET.find((p) => p.id === 'preset:chat')?.key || null, contacts: PRESET.find((p) => p.id === 'preset:contacts')?.key || null }
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/

// An installed HyperBrowser has no console: what it says also goes to <data folder>/hyperbrowser.log.
const LOG = app.isPackaged ? path.join(app.getPath('userData'), 'hyperbrowser.log') : null
/** @param {string} line */
function log (line) {
  console.log(line)
  if (!LOG) return
  try {
    if (/** @type {number} */ (fs.statSync(LOG, { throwIfNoEntry: false })?.size) > 1e6) fs.rmSync(LOG) // shortcut: one file, cut at 1 MB
    fs.appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n')
  } catch {}
}

// One HyperBrowser per data folder: two engines on one folder would conflict.
const FIRST = SELFTEST || FRAMECHECK || !!arg('--dir') || app.requestSingleInstanceLock()
if (!FIRST) app.quit()
/** @type {Frame | null} */
let ui = null
let engineErred = false
app.on('second-instance', () => ui?.show())

// Windows shows a popup only for an app id its Start menu shortcut names: the installer's (scripts/build.js).
// From the repo, Electron's own id is left as is. shortcut: unchecked by hand yet; a balloon if it fails.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('org.hyperbrowser.app')

protocol.registerSchemesAsPrivileged([{ scheme: 'hyper', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
if (GUARDS) resolveNoNames()

// null before startEngine and after stopEngine; what may run then checks (rpc?.)
let rpc = /** @type {Rpc} */ (/** @type {unknown} */ (null))
/** @type {ReturnType<typeof PearRuntime.run> | null} */
let worker = null
/** @type {ReturnType<typeof PearRuntime.run> | null} */
let updater = null
/** @type {string | null} */
let update = null
let quitting = false
/** @type {Rpc | null} */
let stopping = null
/** @type {Map<string, Opened>} */
const sites = new Map()
/** @type {Map<number, string>} webContents id -> its site's key */
const viewOf = new Map()
/** @type {Map<number, WebContents>} */
const subscribers = new Map()
/** @type {Map<number, unknown[]>} */
const early = new Map()
/** @type {WeakMap<WebContents, number>} */
const pages = new WeakMap()
/** @type {Map<string, Promise<void>>} */
const asking = new Map()
/** @type {string[]} */
const asked = []
/** @type {Map<string, Promise<unknown>>} */
const permits = new Map()
/** @type {Map<string, Promise<unknown>>} */
const notifyAsks = new Map()
/** @type {WeakMap<WebContents, string | null>} */
const viewed = new WeakMap()
/** @type {string[]} */
const marked = []
/** @type {string[]} */
const peopleOpened = []
/** @type {Set<string>} */
const appsInstalled = new Set()
/** @type {string[]} */
const appsOpened = []
/** @type {number[]} */
const heard = []
let selftestYes = false
/** @type {{ bootstrap: Array<{ host: string, port: number }>, destroy (): Promise<void> } | null} */
let testnet = null

/** @param {string} key @param {string} p */
async function serve (key, p) {
  const { bytes, path: real } = await rpc.request('site.read', { key, path: p })
  return { bytes, type: typeOf(real) }
}

/** @param {string} event @param {any} data the engine's, per event */
function onEvent (event, data) {
  if (event === 'devices') return ui?.devices()
  if (event === 'circles') return ui?.circles()
  if (event === 'notify') return ui?.notify(data)
  if (event === 'engine.error') {
    log(`engine error${data.code ? ' ' + data.code : ''}${data.method ? ' in ' + data.method : ''}: ${data.message}`)
    if (!engineErred) ui?.notice('Something went wrong in HyperBrowser\'s engine. It kept running.')
    engineErred = true
    return
  }
  if (event === 'closing') {
    if (!quitting && data.reason !== 'close') { console.error('engine stopped:', data.reason); app.exit(1) } // 'close': asked (a join)
    return
  }
  if (event !== 'live' && event !== 'event') return
  if (SELFTEST) heard.push(data.id)
  const wc = subscribers.get(data.id)
  const out = event === 'live' ? { items: data.items, complete: data.complete } : data.data
  if (!wc) early.set(data.id, [...(early.get(data.id) || []), out])
  else if (!wc.isDestroyed()) wc.send('hyper-event', { id: data.id, data: out })
}

/** @param {string} key */
function ask (key) {
  if (!asking.has(key)) {
    asked.push(key)
    const title = /** @type {Opened} */ (sites.get(key)).manifest.title
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 1, cancelId: 1, message: `Let "${title}" use your identity?`, detail: 'It will read and write in its own space as you. You can change this later.' }).then((r) => r.response === 0)
    const engine = rpc // answered after a switch: the closed engine refuses it, the new one never hears it
    asking.set(key, answer.then(async (allow) => {
      await engine.request('site.consent', { key, allow })
      if (allow && declares(/** @type {Opened} */ (sites.get(key)).manifest)) askNotify(key)
    }).finally(() => asking.delete(key)))
  }
  return asking.get(key)
}

/** @type {Record<string, [string, string]>} */
const QUESTIONS = {
  contacts: ['see and manage your contacts', 'It will list your friends and requests, accept or remove them, and send requests. Only HyperBrowser\'s Contacts and Chat need this.'],
  projects: ['edit and publish your projects', 'It will read and change the files of your projects, publish their sites, preview them and invite co-authors. Nothing outside your projects. Only an editor like HyperBrowser\'s IDE needs this.']
}
/** @param {string} key */
function askPermit (key, permission = 'contacts') {
  const id = key + ' ' + permission
  if (!permits.has(id)) {
    const title = /** @type {Opened} */ (sites.get(key)).manifest.title
    const [what, detail] = QUESTIONS[permission]
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 1, cancelId: 1, message: `Let "${title}" ${what}?`, detail }).then((r) => r.response === 0)
    const engine = rpc
    permits.set(id, answer.then((allow) => engine.request('site.permit', { key, permission, allow })).finally(() => permits.delete(id)))
  }
  return permits.get(id)
}

/** @param {string} key */
function askNotify (key) {
  if (!notifyAsks.has(key)) {
    const title = /** @type {Opened} */ (sites.get(key)).manifest.title
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 0, cancelId: 1, message: `Let "${title}" notify you?`, detail: 'HyperBrowser watches what it says (new messages, mentions), even while it is closed, and tells you. You can change this in Configuration.' }).then((r) => r.response === 0)
    const engine = rpc
    notifyAsks.set(key, answer.then((allow) => engine.request('site.permit', { key, permission: 'notifications', allow })).catch(() => {}).finally(() => notifyAsks.delete(key)))
  }
  return notifyAsks.get(key)
}
/** @param {Manifest} manifest */
const declares = (manifest) => manifest.permissions.includes('notifications') && !!manifest.notifications?.length

// Marked read for the page's own app only (the engine checks); the frame calls it only for the current, focused tab.
/** @param {WebContents} wc */
async function readViewed (wc) {
  const place = viewed.get(wc)
  const key = viewOf.get(wc.id)
  if (!place || !key) return null
  const ok = await rpc.request('notify.read', GUARDS ? { place, app: key } : { place }).then(() => true, () => false)
  if (ok && SELFTEST) marked.push(place)
  return ok ? place : null
}

// Events on their way land in `early` meanwhile; the engine's answer comes after them.
/** @param {number} id */
async function unsubscribe (id) {
  subscribers.delete(id)
  await rpc?.request('site.off', { id }).catch(() => {})
  early.delete(id)
  return true
}

/** @param {WebContents} wc */
function stopAll (wc) {
  for (const [id, x] of subscribers) if (x === wc) unsubscribe(id)
  return true
}

/** @param {WebContents} wc @param {any} msg the page's: each field checked by the engine */
async function bridge (wc, msg) {
  if (msg.op === 'page') { // a real load: a hash change runs no preload, a cancelled navigation doesn't get here
    pages.set(wc, (pages.get(wc) || 0) + 1)
    return stopAll(wc)
  }
  const page = pages.get(wc)
  let key = /** @type {string} */ (viewOf.get(wc.id)) // the ipc handler checked it is a site's view
  let sub = msg.sub ?? null
  let instance = msg.instance ?? null // one of the app's instances: the engine checks it is
  if (!GUARDS && sites.has(sub)) { key = sub; sub = null } // control run: trusts a key from the page
  if (!GUARDS && sites.has(instance)) { key = instance; instance = null }
  if (!GUARDS && sites.has(msg.site)) key = msg.site // another app's instance, named with its app
  if (msg.op === 'viewing') {
    if (msg.instance !== null && typeof msg.instance !== 'string') throw Object.assign(new Error('an instance key or null'), { code: 'INVALID_PARAMS' })
    viewed.set(wc, msg.instance)
    ui?.looked()
    return true
  }
  if (msg.op === 'off') return !GUARDS || subscribers.get(msg.id) === wc ? unsubscribe(msg.id) : false // only this page's own
  const method = /** @type {Record<string, string | undefined>} */ ({ call: 'site.call', live: 'site.live', on: 'site.on' })[msg.op]
  if (!method) throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  // only the fields of that call; the key is the view's
  const params = { key, sub, instance, method: msg.method, args: msg.args, chain: msg.chain, opts: msg.opts, event: msg.event }
  const permission = (typeof msg.method === 'string' && msg.method.startsWith('projects.')) || msg.event === 'projects' ? 'projects' : 'contacts'
  if (msg.op === 'call' && msg.method === 'projects.openFolder') params.args = [await pickFolder()] // never a page's path
  if (msg.op === 'call' && msg.method === 'projects.closePreview') return !!ui?.undock(wc) // the shell's alone
  let result
  try {
    result = await rpc.request(method, params)
  } catch (e) {
    const err = /** @type {Thrown} */ (e)
    if (err.code !== 'NEEDS_CONSENT' && err.code !== 'NEEDS_PERMISSION') throw err
    await (err.code === 'NEEDS_CONSENT' ? ask(key) : askPermit(key, permission))
    result = await rpc.request(method, params).catch(async (/** @type {Thrown} */ err) => { // the identity first, then the contacts or projects
      if (err.code !== 'NEEDS_PERMISSION') throw err
      await askPermit(key, permission)
      return rpc.request(method, params)
    })
  }
  if (msg.op === 'call' && (msg.method === 'projects.preview' || msg.method === 'projects.resetPreview') && result?.key) ui?.dock(wc, result.key)
  if (msg.op === 'live' || msg.op === 'on') {
    if (wc.isDestroyed() || pages.get(wc) !== page) { // its page left while the engine answered: nobody else would stop it
      unsubscribe(result.id)
      return result
    }
    subscribers.set(result.id, wc)
    for (const data of early.get(result.id) || []) wc.send('hyper-event', { id: result.id, data })
    early.delete(result.id)
  }
  return result
}

async function pickFolder () {
  /** @type {import('electron').OpenDialogOptions} */
  const o = { title: 'Open a folder as a project', properties: ['openDirectory'] }
  const r = await (ui?.win ? dialog.showOpenDialog(ui.win, o) : dialog.showOpenDialog(o))
  if (r.canceled || !r.filePaths[0]) throw Object.assign(new Error('no folder picked'), { code: 'CANCELLED' })
  return r.filePaths[0]
}

ipcMain.handle('site', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await bridge(evt.sender, msg || {}) }
  } catch (e) {
    const err = /** @type {Thrown} */ (e)
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

// Opening needs a click on the page (the preload says whether one is running); a request, the person's yes.
/** @param {WebContents} wc @param {any} msg the page's: checked here */
async function people (wc, { op, identity, name, activated }) {
  if (typeof identity !== 'string' || !KEY.test(identity)) throw Object.assign(new Error('not a person\'s key'), { code: 'INVALID_PARAMS' })
  if (op === 'request') {
    const site = /** @type {Opened} */ (sites.get(/** @type {string} */ (viewOf.get(wc.id)))).manifest.title
    const who = (typeof name === 'string' && name.trim() ? `"${name.trim().slice(0, 64)}" ` : '') + `(key ${identity.slice(0, 8)}…)`
    const yes = !GUARDS || (!SELFTEST && (await dialog.showMessageBox({ type: 'question', buttons: ['Send', 'Cancel'], defaultId: 1, cancelId: 1, message: `Send a friend request to ${who}?`, detail: `"${site}" asks. The name comes from that site: check the key if it matters.` })).response === 0)
    if (!yes) throw Object.assign(new Error('the person said no'), { code: 'NOT_ALLOWED' })
    return rpc.request('contacts.request', { identity, name })
  }
  if (op !== 'chat' && op !== 'contact') throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  if (GUARDS && !activated) return false
  const c = op === 'chat' ? await rpc.request('contacts.get', { identity }) : null
  const [key, query] = c?.state === 'friend' ? [c.chat, ''] : [APPS.contacts, '?person=' + identity]
  if (SELFTEST) return !!peopleOpened.push(key || op)
  if (!key) throw Object.assign(new Error('Contacts is not published yet'), { code: 'NOT_PUBLISHED' })
  ui?.open(key, query)
  return true
}

ipcMain.handle('people', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await people(evt.sender, msg || {}) }
  } catch (e) {
    const err = /** @type {Thrown} */ (e)
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

// Both need a click on the page; installing, the person's yes to a question naming the app by its own title.
/** @param {WebContents} wc @param {any} msg the page's: checked here */
async function apps (wc, { op, key, activated }) {
  if (typeof key !== 'string' || !KEY.test(key)) throw Object.assign(new Error("not a site's key"), { code: 'INVALID_PARAMS' })
  const installed = () => SELFTEST ? appsInstalled.has(key) : !!ui?.installed(key)
  if (op === 'installed') return installed()
  if (op !== 'install' && op !== 'open') throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  if (GUARDS && !activated) return false
  if (op === 'open') {
    if (SELFTEST) return !!appsOpened.push(key)
    ui?.open(key)
    return true
  }
  if (installed()) return true
  const { manifest, key: real } = await rpc.request('site.open', { key }) // its own title, not the page's words
  rpc.request('site.close', { key: real }).catch(() => {})
  const site = /** @type {Opened} */ (sites.get(/** @type {string} */ (viewOf.get(wc.id)))).manifest.title
  const yes = !GUARDS || (SELFTEST ? selftestYes : (await dialog.showMessageBox({ type: 'question', buttons: ['Install', 'Cancel'], defaultId: 1, cancelId: 1, message: `Install "${manifest.title}"?`, detail: `Key ${key.slice(0, 8)}…, from "${site}". Installed, it stays on your desktop, works offline, and your computer serves it to others.` })).response === 0)
  if (!yes) throw Object.assign(new Error('the person said no'), { code: 'NOT_ALLOWED' })
  if (SELFTEST) appsInstalled.add(key)
  else /** @type {Frame} */ (ui).install(key, manifest.title)
  return true
}

ipcMain.handle('apps', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await apps(evt.sender, msg || {}) }
  } catch (e) {
    const err = /** @type {Thrown} */ (e)
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

// Only HyperBrowser joins a circle, after a click and the person's yes: a page has no circles.* call.
/** @param {WebContents} wc @param {any} msg the page's: checked here */
async function circles (wc, { op, link, name, activated }) {
  if (op !== 'join') throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  if (typeof link !== 'string' || !link.startsWith('hg:')) throw Object.assign(new Error('an invite link (hg:...)'), { code: 'INVALID_PARAMS' })
  if (GUARDS && !activated) return { joined: false }
  if (!GUARDS) return { joined: !!(await rpc.request('circles.join', { link })) } // control run: no question
  if (SELFTEST) return { joined: false } // the person's Not now
  return { joined: (await /** @type {Frame} */ (ui).joinCircle(link, typeof name === 'string' ? name : '')).joined } // the page learns no more
}

ipcMain.handle('circles', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await circles(evt.sender, msg || {}) }
  } catch (e) {
    const err = /** @type {Thrown} */ (e)
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

/** @param {string} key @returns {Promise<SiteView>} */
async function openSite (key, query = '') {
  const { manifest, dynamic, key: real, instance = null, ...rest } = await rpc.request('site.open', { key })
  sites.set(real, { manifest, dynamic })
  if (instance) query = '?instance=' + instance + (query.startsWith('#') ? query : '')
  if (rest.notify === 'ask') askNotify(real)
  const v = createSiteView(real, { dynamic, serve, guards: GUARDS, persist: !SELFTEST, query, prefix: ids.current().prefix })
  viewOf.set(v.webContents.id, real)
  v.webContents.on('destroyed', () => {
    stopAll(v.webContents)
    rpc?.request('site.close', { key: real }).catch(() => {})
  })
  return { key: real, instance, manifest, ...v }
}

const IMAGES = new Set(['png', 'gif', 'svg', 'webp', 'jpg', 'jpeg', 'ico'])

/** @param {string} key @param {Manifest} manifest */
async function readIcon (key, manifest) {
  if (!manifest.icon || !IMAGES.has(/** @type {string} */ (manifest.icon.split('.').pop()).toLowerCase())) return null
  const { bytes, type } = await serve(key, manifest.icon)
  return 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64')
}

async function shutdown () {
  quitting = true
  if (updater) { updater.end(); updater = null }
  await stopEngine()
}

async function stopEngine () {
  const [r, w] = [rpc, worker]
  stopping = r // its stream's end is expected (startEngine's onclose)
  if (r) await r.request('close').catch(() => {})
  if (w) {
    /** @type {Promise<void>} */
    const exited = new Promise((resolve) => { if (/** @type {{ _exited?: boolean }} */ (/** @type {unknown} */ (w))._exited) resolve(); else w.once('exit', /** @type {() => void} */ (resolve)) })
    w.destroy() // kills it if it didn't exit by itself
    await exited
  }
  if (rpc === r) rpc = /** @type {Rpc} */ (/** @type {unknown} */ (worker = null))
}

/** @param {BaseWindowT} win @param {SiteView[]} views */
function layout (win, views) {
  const place = () => {
    const { width, height } = win.getContentBounds()
    const w = Math.floor(width / views.length)
    views.forEach((v, i) => v.view.setBounds({ x: i * w, y: 0, width: w, height }))
  }
  for (const v of views) win.contentView.addChildView(v.view)
  place()
  win.on('resize', place)
}

/** @param {string} dir */
async function selftest (dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-selftest-'))
  /** @param {string} name @param {object} manifest */
  const folder = (name, manifest) => {
    const dir = path.join(tmp, name)
    fs.cpSync(path.join(HERE, 'selftest', 'site'), dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(manifest))
    return dir
  }
  /** @type {string[]} */
  const keys = []
  /** @param {string} title */
  const dyn = (title) => ({ title, permissions: ['space', 'notifications'], types: { note: { fields: { text: 'string' } } } }) // no watch, so no question
  for (const [name, manifest] of /** @type {Array<[string, object]>} */ ([['a', dyn('Site A')], ['b', dyn('Site B')], ['c', { title: 'Static C' }]])) {
    keys.push((await rpc.request('site.publish', { folder: folder(name, manifest) })).key)
  }
  const [a, b, c] = keys
  await rpc.request('apps.set', { chat: a })
  const views = [await openSite(a, '?other=' + b), await openSite(b, '?other=' + a), await openSite(c, '?other=' + a + '&static=1')]
  const win = new BaseWindow({ width: 1500, height: 800, title: 'HyperBrowser self-test' + (GUARDS ? '' : ' (no guards)') })
  layout(win, views)

  const timeout = setTimeout(async () => { // where each page stopped: its last line is the check that hangs
    for (const v of views) console.log(await v.webContents.executeJavaScript("document.getElementById('out').innerText").catch(() => '?'))
    console.log('SELFTEST TIMEOUT')
    app.exit(2)
  }, 90000)
  /** @type {Array<Check[] | null>} */
  let results
  for (;;) {
    results = await Promise.all(views.map((v) => v.webContents.executeJavaScript('window.__results || null').catch(() => null)))
    if (results.every(Boolean)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  clearTimeout(timeout)
  /** @type {Check[]} */
  const out = /** @type {Check[][]} */ (results).flat()
  out.push({ site: 'shell', name: 'the identity question: asked once per dynamic site, never for the static one', pass: asked.length === 2 && asked.includes(a) && asked.includes(b) })
  out.push({ site: 'shell', name: 'hyper.people: nothing opened without a click', pass: peopleOpened.length === 0 })
  out.push({ site: 'shell', name: 'hyper.people: a request the person refused sent nothing', pass: (await rpc.request('contacts.get', { identity: b })) === null })
  out.push({ site: 'shell', name: 'hyper.apps: nothing installed or opened without a click', pass: appsInstalled.size === 0 && appsOpened.length === 0 })
  const install = () => views[0].webContents.executeJavaScript(`window.hyper.apps.install(${JSON.stringify(c)}).then(String, (e) => e.code)`, true)
  const refused = await install()
  out.push({ site: 'shell', name: "hyper.apps: a click and the person's no install nothing", pass: refused === 'NOT_ALLOWED' && !appsInstalled.has(c) })
  selftestYes = true
  const said = await install()
  out.push({ site: 'shell', name: 'hyper.apps: a click and a yes install it', pass: said === 'true' && appsInstalled.has(c) })
  const dark = async () => { await new Promise((resolve) => setTimeout(resolve, 300)); return views[0].webContents.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches") }
  nativeTheme.themeSource = 'dark'
  const isDark = await dark()
  nativeTheme.themeSource = 'light'
  const isLight = !(await dark())
  nativeTheme.themeSource = 'system'
  out.push({ site: 'shell', name: "the theme setting is each site's prefers-color-scheme (dark, then light)", pass: isDark && isLight })
  const look = "(() => { const h = getComputedStyle(document.documentElement); return getComputedStyle(document.body).fontFamily + '|' + h.backgroundAttachment })()"
  await views[2].webContents.loadURL('hyper://' + c + '/plain.html')
  await new Promise((resolve) => setTimeout(resolve, 500)) // insertCSS on dom-ready
  const plain = await views[2].webContents.executeJavaScript(look)
  const styled = await views[0].webContents.executeJavaScript(look)
  out.push({ site: 'shell', name: 'a page with no stylesheet gets the default theme (fonts, a fixed dither)', pass: plain === "\"HB Plex Mono\", ui-monospace, monospace|fixed" })
  out.push({ site: 'shell', name: 'a page with its own <style> keeps its look', pass: !styled.includes('HB ') })
  await checkLoads(views, out)
  await checkNotifications(views, out)
  await checkCircles(views, out)
  const chat = await checkChat(win, views, out, tmp)
  await checkChatLine(chat, out, tmp)
  await checkMenus(win, views, out, tmp, chat)
  await checkIde(win, views, out, tmp, chat)
  for (const r of out) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.site + '  ' + r.name)
  const ok = out.every((r) => r.pass)
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL')
  for (const v of views) v.close()
  win.destroy() // with views still open, app.exit() leaves the process running (Windows, Electron 42)
  await shutdown()
  await testnet?.destroy()
  for (const d of [tmp, dir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  app.exit(ok ? 0 : 1)
}

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** @param {() => Promise<unknown>} f */
const until = async (f) => { for (let n = 0; n < 100; n++) { if (await f().catch(() => false)) return true; await wait(100) } return false }

/** @param {SiteView[]} views @param {Check[]} out */
async function checkLoads ([a, b], out) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const wc = b.webContents
  /** @param {string} s */
  const run = (s) => wc.executeJavaScript(s)
  const mine = (w = wc) => [...subscribers].filter(([, x]) => x === w).map(([id]) => id)
  const got = () => run('window.__got')
  const put = async () => {
    const n = await got()
    await run("window.hyper.put('profile', { name: 'load' }).then(() => 0)")
    return until(async () => (await got()) > n)
  }

  const flying = bridge(wc, { op: 'live', args: ['profile'], chain: [] })
  bridge(wc, { op: 'page' }).catch(() => {})
  const late = await flying
  pass('a subscribe answered after its page left is stopped', !subscribers.has(late.id))

  await wc.loadURL('hyper://' + b.key + '/nav.html')
  await until(async () => (await got()) > 0)
  await a.webContents.executeJavaScript("window.hyper.query('profile').live(() => {}); 0")
  await until(async () => mine(a.webContents).length > 0)
  const other = /** @type {number} */ (mine(a.webContents).at(-1)) // subscribed: waited for above

  const before = mine()
  await run("location.hash = '#x'; 0")
  await wait(300)
  pass('a hash change stops nothing', before.length === 1 && String(mine()) === String(before) && await put())
  wc.once('will-navigate', (e) => e.preventDefault())
  await run("location.search = '?cancelled'; 0")
  await wait(500)
  pass('a cancelled navigation stops nothing', String(mine()) === String(before) && await put())

  for (const [name, go] of [['location.search', "location.search = '?2'"], ['reload', 'location.reload()'], ['back', 'history.back()']]) {
    const old = mine()
    await run(`window.__left = true; setTimeout(() => { ${go} }); 0`)
    const loaded = await until(async () => !(await run('window.__left')) && (await got()) > 0)
    const mark = heard.length
    const works = await put()
    const now = mine()
    pass(`a real load (${name}): the old page's subscriptions stop, the new page's work`, loaded && works && now.length === 1 && !old.includes(now[0]) &&
      heard.slice(mark).includes(now[0]) && !heard.slice(mark).some((id) => old.includes(id) || id === late.id) && !old.some((id) => early.has(id)))
  }

  pass("a page's load leaves another view's subscriptions", subscribers.get(other) === a.webContents)
  await bridge(wc, { op: 'off', id: other }).catch(() => {})
  const mark = heard.length
  await a.webContents.executeJavaScript("window.hyper.put('profile', { name: 'still' }).then(() => 0)")
  pass("a page can't stop another page's subscription", await until(async () => heard.slice(mark).includes(other)))
}

/** @param {SiteView[]} views @param {Check[]} out */
async function checkNotifications ([a, b], out) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const own = await rpc.request('site.call', { key: a.key, method: 'instances.create', args: ['mine'] })
  const other = await rpc.request('site.call', { key: b.key, method: 'instances.create', args: ['theirs'] })
  /** @param {string} k */
  const viewing = (k) => a.webContents.executeJavaScript(`window.hyper.notifications.viewing(${JSON.stringify(k)}).then(String, (e) => e.code)`)
  await viewing(other.key)
  await readViewed(a.webContents)
  pass("notifications: a page's viewing can't mark another app's conversation read", !marked.includes(other.key))
  await viewing(own.key)
  await readViewed(a.webContents)
  pass("notifications: a page's viewing marks its own app's conversation read", marked.includes(own.key))
  await checkOwnCounts(a, b, own, other, pass)
  const api = await a.webContents.executeJavaScript('Object.keys(window.hyper.notifications).join()')
  const asked = await bridge(a.webContents, { op: 'call', method: 'notify.state', args: [] }).then(() => 'read', (e) => e.code)
  pass("notifications: a page can't read the person's notifications or their settings (notify.* refused; its own app's counts only, spec 017)", api === 'viewing,unread,on,follow,unfollow,follows' && asked === 'UNKNOWN_METHOD')
}

// Each check names B's site as the instance, which the control run takes for the page's site: there it reads and changes B's.
/** @param {SiteView} a @param {SiteView} b @param {{ key: string }} own @param {{ key: string }} other @param {Pass} pass */
async function checkOwnCounts (a, b, own, other, pass) {
  /** @param {string} method @param {unknown[]} [args] */
  const ask = (method, args = []) => bridge(a.webContents, { op: 'call', instance: b.key, method, args }).then((r) => r, (e) => ({ error: e.code }))
  const counts = await ask('notifications.unread')
  pass("notifications: a page can't read another app's counts", !counts.error && own.key in counts && !(other.key in counts))
  const theirs = await rpc.request('site.call', { key: b.key, method: 'notifications.follow', args: [{ place: other.key, type: 'note', says: 'a note' }] })
  const listed = await ask('notifications.follows')
  pass("notifications: a page can't read another app's follows", Array.isArray(listed) && !listed.some((/** @type {{ id: string }} */ f) => f.id === theirs.id))
  await ask('notifications.unfollow', [theirs.id])
  const still = await rpc.request('site.call', { key: b.key, method: 'notifications.follows', args: [] })
  pass("notifications: a page can't remove another app's follow", still.some((/** @type {{ id: string }} */ f) => f.id === theirs.id))
  const made = await ask('notifications.follow', [{ place: other.key, type: 'note', says: 'a note' }])
  pass("notifications: a page can't follow another app's places", made.error === 'NOT_ALLOWED')
  const gone = await rpc.request('site.call', { key: b.key, method: 'instances.create', args: ['gone'] })
  await wait(1000)
  const sub = await bridge(a.webContents, { op: 'on', instance: b.key, event: 'notifications' })
  const mark = heard.length
  await rpc.request('site.call', { key: b.key, method: 'instances.leave', args: [gone.key] })
  await wait(1000)
  pass("notifications: a page doesn't hear another app's counts", !heard.slice(mark).includes(sub.id))
  await bridge(a.webContents, { op: 'off', id: sub.id })
}

// Each check names B's site with B's private instance, which the control run takes for the page's site.
/** @param {SiteView[]} views @param {Check[]} out */
async function checkCircles ([a, b], out) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const theirs = await rpc.request('site.call', { key: b.key, method: 'instances.create', args: ['Theirs', { private: true }] })
  /** @param {string} method */
  const ask = (method) => bridge(a.webContents, { op: 'call', site: b.key, instance: theirs.key, method, args: [] }).then(() => 'done', (e) => e.code)
  pass("copies: a page can't read another app's instance's copies", (await ask('copies')) === 'NOT_ALLOWED')
  pass("rotateKey: a page can't change another app's instance's key", (await ask('rotateKey')) === 'NOT_ALLOWED')
  pass("secure: a page can't renew another app's instance", (await ask('secure')) === 'NOT_ALLOWED')
  pass("trimHistory: a page can't trim another app's instance", (await ask('trimHistory')) === 'NOT_ALLOWED')
  const circle = await rpc.request('circles.create', { name: 'Self-test' })
  const { link } = await rpc.request('circles.invite', { key: circle.key })
  const asked = await bridge(a.webContents, { op: 'call', method: 'circles.join', args: [link] }).then(() => 'joined', (e) => e.code)
  pass('circles: a page has no circles.* call of the engine', asked === 'UNKNOWN_METHOD')
  const clicked = await a.webContents.executeJavaScript(`window.hyper.circles.join(${JSON.stringify(link)}).then((r) => JSON.stringify(r), (e) => e.code)`, true)
  pass("circles: a click and the person's Not now join nothing", clicked === '{"joined":false}')
}

/** @param {BaseWindowT} win @param {SiteView[]} views @param {Check[]} out @param {string} tmp */
async function checkChat (win, views, out, tmp) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const folder = path.join(tmp, 'chat') // a copy: publishing links a folder both ways with the engine
  fs.cpSync(path.join(HERE, '..', 'sites', 'chat'), folder, { recursive: true })
  const { key } = await rpc.request('site.publish', { folder })
  const chat = await openSite(key)
  views.push(chat)
  win.contentView.addChildView(chat.view)
  chat.view.setBounds({ x: 0, y: 0, width: 500, height: 800 })
  /** @param {string} s */
  const run = (s) => chat.webContents.executeJavaScript(s)
  await until(() => run("!!document.querySelector('input[name=name]')"))
  await run("(() => { const i = document.querySelector('input[name=name]'); i.value = 'Scroll'; i.form.requestSubmit(); return 0 })()")
  await until(() => run("!!document.querySelector('textarea[name=text]')"))
  const list = "document.querySelector('main div[style*=overflow]')"
  const box = "document.querySelector('textarea[name=text]')"
  let shown = 0
  /** @param {number} lines */
  const say = async (lines) => {
    await run(`window.hyper.instance(new URLSearchParams(location.search).get('instance')).put('message', { text: ${JSON.stringify('line\n'.repeat(lines))} }).then(() => 0)`)
    return until(async () => (await run(`${list}.children.length`)) === shown + 1).then((ok) => { shown++; return ok })
  }
  const atEnd = () => run(`(() => { const l = ${list}; return l.scrollHeight > l.clientHeight && l.scrollHeight - l.scrollTop - l.clientHeight <= 8 })()`)
  const scrollUp = () => run(`${list}.scrollTop = 100`)

  pass('chat: a conversation shows its latest messages', await say(80) && await atEnd())
  pass('chat: a new message keeps you at the end', await say(80) && await atEnd())
  await scrollUp()
  pass('chat: scrolled up, a new message keeps your place', await say(1) && (await run(`${list}.scrollTop`)) === 100)
  await run(`(() => { const t = ${box}; t.focus(); t.value = 'hello world'; t.dispatchEvent(new Event('input')); t.setSelectionRange(2, 5); return 0 })()`)
  await say(1)
  pass('chat: a redraw keeps the caret and the selection', (await run(`(() => { const t = ${box}; return [document.activeElement === t, t.selectionStart, t.selectionEnd].join() })()`)) === 'true,2,5')
  await scrollUp()
  await run(`${box}.form.requestSubmit(); 0`)
  pass('chat: your own message takes you to the end', await until(async () => (await run(`${list}.children.length`)) === shown + 1) && await until(atEnd))
  return { key, view: chat }
}

/** @param {() => Promise<unknown>} f */
const waitFor = async (f, ms = 60000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f().catch(() => false)) return true; return false }

// Ann: a second engine in this process, on the self-test's own DHT.
/** @param {{ key: string, view: SiteView }} chat @param {Check[]} out @param {string} tmp */
async function checkChatLine ({ key, view }, out, tmp) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const { start } = await import('../engine/index.js')
  const [x, y] = pair()
  start(x)
  const ann = connect(y, {})
  try {
    await ann.request('init', { dir: path.join(tmp, 'ann'), bootstrap: /** @type {NonNullable<typeof testnet>} */ (testnet).bootstrap })
    await ann.request('site.open', { key, timeout: 60000 })
    await ann.request('site.consent', { key, allow: true })
    /** @param {Rpc} e @param {string} method @param {unknown[]} [args] @param {string | null} [instance] */
    const as = (e, method, args = [], instance = null) => e.request('site.call', { key, instance, method, args })
    for (const [e, name] of /** @type {Array<[Rpc, string]>} */ ([[rpc, 'Bob'], [ann, 'Ann']])) {
      await e.request('apps.set', { chat: key })
      await e.request('site.permit', { key, permission: 'contacts', allow: true })
      await e.request('site.permit', { key, permission: 'notifications', allow: true })
      await as(e, 'contacts.setMe', [{ name }])
    }
    const annId = (await as(ann, 'info')).identity
    await as(rpc, 'contacts.add', [(await as(ann, 'contacts.link')).link])
    /** @type {string | null} */
    let direct = null
    await waitFor(async () => (direct = (await as(rpc, 'contacts.list')).find((/** @type {{ identity: string, state: string }} */ c) => c.identity === annId && c.state === 'friend')?.chat))
    const group = (await as(ann, 'instances.create', ['Line', { private: true }])).key
    await as(rpc, 'instances.join', [await as(ann, 'createInvite', [{ role: 'member' }], group)])
    /** @param {string} s */
    const run = (s) => view.webContents.executeJavaScript(s)
    const list = "document.querySelector('main div[style*=overflow]')"
    for (const [kind, place] of /** @type {Array<[string, string | null]>} */ ([['a group', group], ['a direct conversation', direct]])) {
      if (!place) { pass(`chat: ${kind}: there`, false); continue }
      const count = async () => (await as(rpc, 'notifications.unread'))[place]?.count ?? -1
      await wait(3000) // the engine's first look at a place just joined: what was there is history
      for (let i = 1; i <= 30; i++) await as(ann, 'put', ['message', { text: 'h' + i + '\nsecond line\nthird line' }], place)
      await waitFor(async () => (await count()) === 30)
      await rpc.request('notify.read', { place })
      for (let i = 1; i <= 5; i++) await as(ann, 'put', ['message', { text: 'u' + i }], place)
      const five = await waitFor(async () => (await count()) === 5)
      await run(`location.search = '?instance=${place}'; 0`)
      const shown = await waitFor(() => run(`(${list}?.children.length || 0) >= 36`), 30000) // 35 and the line
      await wait(500)
      const line = await run(`(() => { const l = ${list}; const n = l.querySelector('.new-line'); if (!n) return 'none'; const top = n.offsetTop - l.scrollTop
        return [top >= 0 && top < l.clientHeight, n.nextElementSibling.textContent.includes('u1'), l.scrollTop > 0].join() })()`)
      pass(`chat: ${kind} opens at a "New messages" line above the 5 unread, in view`, five && shown && line === 'true,true,true')
      const order = await run(`[...${list}.children].filter((p) => !p.classList.contains('new-line')).map((p) => p.textContent).join('|')`)
      pass(`chat: ${kind}: oldest at the top, newest at the bottom`, order.split('|')[0].includes('h1') && order.endsWith('u5'))
      await run("(() => { const t = document.querySelector('textarea[name=text]'); t.value = 'from Bob'; t.form.requestSubmit(); return 0 })()")
      const end = await waitFor(() => run(`(() => { const l = ${list}; return l.lastElementChild.textContent.includes('from Bob') && l.scrollHeight - l.scrollTop - l.clientHeight <= 8 })()`), 15000)
      pass(`chat: ${kind}: sending takes you to the end`, end)
    }
    const menu = await run(`(() => { const d = ${list}.querySelector('details'); if (!d) return 'none'; d.querySelector('summary').focus(); return [document.activeElement.tagName, [...d.querySelectorAll('button')].map((b) => b.textContent).join()].join() })()`)
    pass('chat: Edit and Delete behind one "…" per message, reachable by keyboard', menu === 'SUMMARY,Edit,Delete')
    // A page's instances.join of a circle link doesn't leave Bob in the circle; its one use is still spent (a known limit).
    const ring = await ann.request('circles.create', { name: 'Ann only' })
    const { link } = await ann.request('circles.invite', { key: ring.key })
    const before = (await rpc.request('hosting')).sites
    const said = await run(`window.hyper.instances.join(${JSON.stringify(link)}).then(() => 'joined', (e) => e.code)`)
    pass("circles: a page's instances.join of a circle link leaves the person out of it", said === 'NOT_ALLOWED' && (await rpc.request('hosting')).sites === before && !(await rpc.request('circles.list')).some((/** @type {{ key: string }} */ c) => c.key === ring.key))
    await as(ann, 'contacts.inviteToCircle', [(await as(rpc, 'contacts.me')).identity, ring.key])
    await run(`location.search = '?instance=${direct}'; 0`)
    const button = "[...document.querySelectorAll('main button')].find((b) => b.textContent.startsWith('Accept Ann\\'s invitation to ') && b.textContent.includes('Ann only'))"
    const shown = await waitFor(() => run(`!!${button}`), 30000)
    const asked = shown && await view.webContents.executeJavaScript(`${button}.click(); 0`, true).then(() => waitFor(async () => !(await rpc.request('circles.list')).some((/** @type {{ key: string }} */ c) => c.key === ring.key), 3000))
    pass("chat: a circle's invite shows Accept Ann's invitation; its click asks HyperBrowser, nothing joined on Not now", shown && asked)
  } finally {
    await ann.request('close').catch(() => {})
  }
}

// Every element's box before and after opening, except the menu's own content.
/** @param {(s: string) => Promise<any>} run @param {string} menu @param {string} open */
async function moves (run, menu, open) {
  const places = `((m) => [...document.body.querySelectorAll('*')].filter((e) => !(m.contains(e) && !e.matches('summary, [aria-haspopup]'))).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join() }).join('|'))(${menu})`
  await run('document.fonts.ready.then(() => 0)') // the theme's font loading late moved text (a false "moved")
  const before = await run(places)
  await run(open + '; 0')
  await wait(300)
  return before !== await run(places)
}

/** @param {BaseWindowT} win @param {SiteView[]} views @param {Check[]} out @param {string} tmp @param {{ key: string, view: SiteView }} chat */
async function checkMenus (win, views, out, tmp, chat) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  /** @param {string} name */
  const page = async (name, query = '') => {
    const folder = path.join(tmp, name)
    fs.cpSync(path.join(HERE, '..', 'sites', name), folder, { recursive: true })
    const { key } = await rpc.request('site.publish', { folder })
    const v = await openSite(key, query)
    views.push(v)
    win.contentView.addChildView(v.view)
    v.view.setBounds({ x: 0, y: 0, width: 700, height: 800 })
    return { key, v, run: (/** @type {string} */ s) => v.webContents.executeJavaScript(s) }
  }
  const contacts = await page('contacts')
  const run = contacts.run
  const friend = "document.querySelector('[data-menu]')"
  const there = await waitFor(() => run(`!!${friend}`), 30000)
  const moved = there && await moves(run, friend, `${friend}.querySelector('button').click()`)
  const items = there && await run(`[...${friend}.querySelectorAll('[role=menuitem]')].map((b) => b.textContent).join()`)
  pass('contacts: a friend\'s "…" opens a menu of circles that moves nothing on the page', there && !moved && items === 'Invite to "Self-test"')
  const gap = there && await run(`(() => { const li = ${friend}.closest('li'); const msg = [...li.querySelectorAll('button')].find((b) => b.textContent === 'Message'); return ${friend}.querySelector('button').getBoundingClientRect().left - msg.getBoundingClientRect().right })()`)
  pass('contacts: the "…" is a button apart from Message', gap >= 8)
  await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0")
  pass('contacts: Escape closes the menu, the focus back on its "…"', await run(`!${friend}.querySelector('[role=menu]') && document.activeElement === ${friend}.querySelector('button')`))
  await run(`${friend}.querySelector('button').click(); 0`)
  await run("document.querySelector('h1').click(); 0")
  pass('contacts: a click outside closes it', await run(`!${friend}.querySelector('[role=menu]')`))

  const msg = "document.querySelector('summary[aria-label=\"Message actions\"]').parentElement"
  pass('chat: a message\'s "…" opens without moving anything', await chat.view.webContents.executeJavaScript(`!!${msg}`) && !(await moves((/** @type {string} */ s) => chat.view.webContents.executeJavaScript(s), msg, `${msg}.querySelector('summary').click()`)))

  const forum = await page('forum')
  await waitFor(() => forum.run("!!document.querySelector('.desk')"), 30000)
  const made = await forum.run("window.hyper.instances.create('Menus', { private: true }).then((i) => i.key, (e) => 'error ' + e.code)")
  await forum.run(`location.search = '?instance=${made}'; 0`)
  const fm = "document.querySelector('details.menu')"
  const shown = await waitFor(() => forum.run(`!!${fm}`), 30000)
  pass('forum: a forum\'s "…" opens without moving anything', shown && !(await moves(forum.run, fm, `${fm}.querySelector('summary').click()`)))
  /** @param {string} label */
  const button = (label) => `[...document.querySelectorAll('details.menu button')].find((b) => b.textContent === ${JSON.stringify(label)})`
  const both = await waitFor(() => forum.run(`!!${button('Secure this place…')} && !!${button('Trim history…')}`), 20000)
  pass('forum: its owner\'s "…" has Secure this place… and Trim history…', both)
  await forum.run(`${button('Secure this place…')}.click(); 0`)
  pass('forum: Secure this place… asks first, "Also delete history before now" off', await waitFor(() => forum.run("!!document.querySelector('.confirm-box input[type=checkbox]') && !document.querySelector('.confirm-box input[type=checkbox]').checked"), 5000))
  await forum.run("[...document.querySelectorAll('.confirm-box button')].find((b) => b.textContent === 'Cancel').click(); 0")
  await forum.run(`${button('Trim history…')}.click(); 0`)
  pass('forum: Trim history… warns that copies taken can\'t be recalled', await waitFor(() => forum.run("!!document.querySelector('.confirm-box') && document.querySelector('.confirm-box').textContent.includes('be recalled')"), 5000))
}

// Prints PERF lines that perf/ide.mjs records: start, the editor's load, memory, a preview's reload.
/** @param {BaseWindowT} win @param {SiteView[]} views @param {Check[]} out @param {string} tmp @param {{ key: string, view: SiteView }} chat */
async function checkIde (win, views, out, tmp, chat) {
  /** @type {Pass} */
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const folder = path.join(tmp, 'ide')
  fs.cpSync(path.join(HERE, '..', 'sites', 'ide'), folder, { recursive: true })
  const { key } = await rpc.request('site.publish', { folder })
  const t0 = performance.now()
  const v = await openSite(key)
  views.push(v)
  win.contentView.addChildView(v.view)
  v.view.setBounds({ x: 0, y: 0, width: 900, height: 800 })
  /** @param {string} s */
  const run = (s) => v.webContents.executeJavaScript(s, true)
  const started = await waitFor(() => run("document.querySelector('h1')?.textContent === 'Hyper IDE' && !!document.querySelector('form')"), 30000)
  const start = performance.now() - t0
  pass('ide: it opens (its projects asked for once)', started)
  /** @param {string} sel */
  const inside = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })()`
  await run("document.querySelector('[data-menu=home] > button').click(); 0")
  const homeMenu = await waitFor(() => run(inside('[data-menu=home] [role=menu]')), 3000)
  await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0")
  pass('ide: the home page\'s "…" menu is inside the window', homeMenu)
  const memory = () => (app.getAppMetrics().find((m) => m.pid === v.webContents.getOSProcessId())?.memory.workingSetSize || 0) / 1024 // MB
  /** @param {string} label */
  const button = (label) => `[...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(label)})`
  await run("(() => { const f = document.querySelector('form'); f.name.value = 'Self-test site'; f.kind.value = 'hypermd'; f.requestSubmit(); return 0 })()")
  const made = await waitFor(() => run("document.querySelector('nav[aria-label=Pages]')?.textContent.includes('Self-test site')"), 30000)
  await run(`${button('New page')}.click(); 0`)
  await waitFor(() => run("!!document.querySelector('dialog[open] input')"), 5000)
  await run("(() => { const d = document.querySelector('dialog[open]'); d.querySelector('input').value = 'About'; d.querySelector('button').click(); return 0 })()")
  const two = await waitFor(() => run("document.querySelectorAll('nav[aria-label=Pages] li').length === 2 && document.querySelector('nav').textContent.includes('About')"), 15000)
  const bare = await run("!/\\.(hmd|html|json)\\b|\\{/.test(document.body.innerText)")
  pass('ide: a beginner makes a site of two pages, by their titles, with no file name or JSON shown (FR-001)', made && two && bare)
  const edges = `(() => {
    const title = document.querySelector('nav[aria-label=Pages] input:not([type])')
    const nav = title.closest('nav').getBoundingClientRect()
    const box = document.querySelector('#editor').getBoundingClientRect()
    const main = document.querySelector('[role=main]').getBoundingClientRect()
    const t = title.getBoundingClientRect()
    const b = document.querySelector('#editor')
    return t.right <= nav.right + 0.5 && box.right <= main.right + 0.5 && box.right <= innerWidth && nav.right <= innerWidth && document.scrollingElement.scrollWidth <= innerWidth &&
      b.scrollWidth <= b.clientWidth && b.scrollHeight <= b.clientHeight // the box itself never scrolls: its text area does
  })()`
  /** @type {number[]} */
  const pageEdges = []
  for (const width of [1400, 770]) {
    v.view.setBounds({ x: 0, y: 0, width, height: 700 })
    await wait(400)
    if (!(await run(edges))) pageEdges.push(width)
  }
  v.view.setBounds({ x: 0, y: 0, width: 900, height: 800 })
  pass('ide: the Title field and the page editor end inside their boxes and the window (1400, 770px)' + (pageEdges.length ? ' (cut at ' + pageEdges + ')' : ''), !pageEdges.length)
  await run("(() => { const a = document.querySelector('textarea'); a.value += 'Hello **you**'; a.dispatchEvent(new Event('input')); return 0 })()")
  const builtPage = async () => {
    const { key } = await run('window.hyper.projects.list().then(([p]) => window.hyper.projects.preview(p.key))')
    await rpc.request('site.open', { key })
    const html = Buffer.from((await rpc.request('site.read', { key, path: 'about.html' })).bytes).toString()
    await rpc.request('site.close', { key })
    return html.includes('<strong') && !(await run("window.hyper.projects.list().then(async ([p]) => (await window.hyper.projects.files(p.key)).some((f) => f.path.endsWith('.html')))"))
  }
  const built = await waitFor(builtPage, 10000)
  pass('ide: typing a page builds it (HyperMD in the page), outside the project folder', built)
  const menu = "document.querySelector('header [data-menu]')"
  pass('ide: the project\'s "…" opens without moving anything', !(await moves(run, menu, `${menu}.querySelector('button').click()`)))
  const before = memory()
  const t1 = performance.now()
  await run(`${button('Show the files')}.click(); 0`)
  /** @param {string} p */
  const item = (p) => `document.querySelector('[role=treeitem][data-path=${JSON.stringify(p)}]')`
  await waitFor(() => run(`!!${item('index.hmd')}`), 5000)
  await run(`${item('index.hmd')}.click(); 0`)
  const cm = await waitFor(() => run("!!document.querySelector('#editor')?.shadowRoot?.querySelector('.cm-editor')"), 15000)
  const editorLoad = performance.now() - t1
  pass('ide: a file in the files view opens in CodeMirror, loaded then', cm)
  const snug = `(() => {
    const nav = document.querySelector('nav[aria-label=Files]')
    const box = document.querySelector('#editor')
    const sc = box?.shadowRoot?.querySelector('.cm-scroller')
    const fit = (e) => !!e && e.scrollWidth <= e.clientWidth
    return [fit(nav), fit(box), fit(sc)].join()
  })()`
  /** @type {string[]} */
  const loose = []
  for (const width of [1400, 770]) {
    v.view.setBounds({ x: 0, y: 0, width, height: 700 })
    await wait(400)
    const r = await run(snug)
    if (r !== 'true,true,true') loose.push(width + ' (tree, box, scroller: ' + r + ')')
  }
  v.view.setBounds({ x: 0, y: 0, width: 900, height: 800 })
  pass('ide: the tree and the editor fit their space: no horizontal scrollbar for short content (1400, 770px)' + (loose.length ? ' ' + loose.join('; ') : ''), !loose.length)
  pass('ide: the default theme stays with the editor loaded', await run("getComputedStyle(document.body).fontFamily.includes('HB ')"))
  const after = memory()
  const menuItems = "[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((b) => b.textContent).join('|')"
  // The theme's li text-indent used to cut names' first two letters.
  const names = await run(`[...document.querySelectorAll('[role=treeitem]')].map((li) => {
    const span = [...li.querySelectorAll('span')].find((x) => x.textContent && !/^[▸▾ ]*$/.test(x.textContent))
    const r = document.createRange()
    r.selectNodeContents(span)
    return r.getBoundingClientRect().left >= span.getBoundingClientRect().left - 0.5 && span.textContent === li.dataset.path.split('/').pop() && li.title === li.dataset.path
  }).every(Boolean)`)
  pass('ide: the tree shows each name from its first letter, the whole path as its tooltip', names)
  await run(`${item('index.hmd')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 120 })); 0`)
  const rightClick = await run(menuItems)
  pass('ide: right-click on a file: Open, Rename, Delete, Cut, Copy, New file, New folder', ['Open', 'Rename', 'Delete…', 'Cut', 'Copy', 'New file…', 'New folder…'].every((x) => rightClick.split('|').includes(x)))
  await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0")
  const closed = await run("!document.querySelector('[role=menu]') && document.activeElement?.getAttribute('role') === 'treeitem'")
  await run(`${item('_layout.hmd')}.focus(); ${item('_layout.hmd')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); 0`)
  const keyboard = await run(menuItems)
  pass('ide: the tree\'s menu by keyboard (Shift+F10), Escape closes it with the focus back', closed && keyboard.includes('Rename') && await run("document.activeElement?.getAttribute('role') === 'menuitem'"))
  await run("[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => b.textContent === 'Copy').click(); 0")
  await run(`${item('about.hmd')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 140 })); 0`)
  await run("[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => b.textContent === 'Rename').click(); 0")
  const field = await waitFor(() => run(`!!${item('about.hmd')}?.querySelector('input')`), 3000)
  await run(`(() => { const f = ${item('about.hmd')}.querySelector('input'); f.value = 'me.hmd'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 0 })()`)
  const renamed = await waitFor(() => run(`!!${item('me.hmd')}`), 10000)
  pass('ide: rename in place (the row becomes a field; Enter renames)', field && renamed)
  await run(`${item('me.hmd')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 140 })); 0`)
  const pasteItem = await run(menuItems)
  await run("[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => b.textContent.startsWith('Paste')).click(); 0")
  const pasted = await waitFor(() => run(`!!${item('_layout copy.hmd')}`), 10000)
  pass('ide: copy, then paste: a copy under a free name', pasteItem.includes('Paste _layout.hmd') && pasted)
  await run(`${button('Hide file explorer')}.click(); 0`)
  const hidden = await waitFor(() => run("!document.querySelector('nav[aria-label=Files]') && !!document.querySelector('#editor')"), 5000)
  const remembered = await waitFor(() => run('window.hyper.mine.all().then((m) => m.tree === false)'), 5000) // saved in the background
  pass('ide: Hide file explorer gives the editor the room, and is remembered', hidden && remembered)
  await run(`${button('Show file explorer')}.click(); 0`)
  await run(`${menu}.querySelector('button').click(); 0`)
  await run(`${button('Editor settings')}.click(); 0`)
  await waitFor(() => run("!!document.querySelector('[role=main] input[type=checkbox]')"), 5000)
  await run("(() => { const c = document.querySelector('[role=main] input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); return 0 })()")
  const saved = await waitFor(() => run('window.hyper.mine.all().then((m) => m.editor?.wrap === true)'), 5000)
  await run(`${button('← Back to the editor')}.click(); 0`)
  const wrapping = await waitFor(() => run("!!document.querySelector('#editor')?.shadowRoot?.querySelector('.cm-lineWrapping')"), 10000)
  pass('ide: Editor settings: line wrapping on, saved per person (hyper.mine)', saved && wrapping)
  const fill = `(() => {
    const box = document.querySelector('#editor')
    const cm = box?.shadowRoot?.querySelector('.cm-editor')
    if (!cm) return 'no editor'
    const b = box.getBoundingClientRect()
    const c = cm.getBoundingClientRect()
    const body = getComputedStyle(document.body)
    const right = document.body.getBoundingClientRect().right - parseFloat(body.paddingRight) - parseFloat(body.borderRightWidth)
    const ok = Math.abs(b.right - right) <= 2 && Math.abs(c.width - box.clientWidth) <= 2 && Math.abs(c.height - box.clientHeight) <= 2
    return ok ? 'ok' : JSON.stringify({ box: [b.left, b.right], right, cm: [c.width, c.height], inner: [box.clientWidth, box.clientHeight] })
  })()`
  /** @type {string[]} */
  const fills = []
  for (const shown of [true, false]) {
    if (!shown) await run(`${button('Hide file explorer')}.click(); 0`)
    for (const width of [1400, 900, 600]) {
      v.view.setBounds({ x: 0, y: 0, width, height: 700 })
      await wait(400)
      const r = await run(fill)
      if (r !== 'ok') fills.push(`${shown ? 'list' : 'no list'} ${width}: ${r}`)
    }
  }
  await run(`${button('Show file explorer')}.click(); 0`)
  pass('ide: the editor fills the space left over, the list shown or hidden, at 1400, 900, 600 px' + (fills.length ? ' (' + fills.join('; ') + ')' : ''), !fills.length)
  await run("window.hyper.projects.list().then(([p]) => window.hyper.projects.write(p.key, 'long.js', '// ' + 'x'.repeat(3000) + '\\n')).then(() => 0)")
  await waitFor(() => run(`!!${item('long.js')}`), 10000)
  await run(`${item('long.js')}.click(); 0`)
  await waitFor(() => run("document.querySelector('#editor')?.shadowRoot?.querySelector('.cm-content')?.textContent.length > 2000"), 10000)
  /** @type {string[]} */
  const codeEdges = []
  for (const width of [1400, 770]) {
    v.view.setBounds({ x: 0, y: 0, width, height: 700 })
    await wait(400)
    const r = await run("(() => { const b = document.querySelector('#editor').getBoundingClientRect(); const m = document.querySelector('[role=main]').getBoundingClientRect(); return b.right <= m.right + 0.5 && b.right <= innerWidth && document.scrollingElement.scrollWidth <= innerWidth ? 'ok' : JSON.stringify([b.right, m.right, innerWidth, document.scrollingElement.scrollWidth]) })()")
    if (r !== 'ok') codeEdges.push(width + ': ' + r)
  }
  v.view.setBounds({ x: 0, y: 0, width: 900, height: 800 })
  pass('ide: a long line scrolls inside the editor, its right border inside the window (1400, 770px)' + (codeEdges.length ? ' (' + codeEdges.join('; ') + ')' : ''), !codeEdges.length)
  pass('ide: buttons keep their shadow\'s room (2px right and below)', await run("(() => { const c = getComputedStyle(document.querySelector('button')); return c.marginRight === '2px' && c.marginBottom === '2px' })()"))
  const sizes = [[1400, 800], [1000, 700], [700, 500], [480, 360]]
  /** @param {SiteView} v */
  const fitsAll = async (v) => {
    for (const [width, height] of sizes) {
      v.view.setBounds({ x: 0, y: 0, width, height })
      await wait(400)
      const ok = await v.webContents.executeJavaScript('(() => { const e = document.scrollingElement; return e.scrollHeight <= innerHeight + 1 && e.scrollWidth <= innerWidth + 1 })()')
      if (!ok) return `${width}×${height}`
    }
    return null
  }
  const ideStuck = await fitsAll(v)
  pass('ide: no page scrollbar at 1400×800, 1000×700, 700×500, 480×360' + (ideStuck ? ' (scrolls at ' + ideStuck + ')' : ''), !ideStuck)
  const c = chat.view
  win.contentView.addChildView(c.view)
  const chatStuck = await fitsAll(c)
  pass('chat: no page scrollbar at those sizes' + (chatStuck ? ' (scrolls at ' + chatStuck + ')' : ''), !chatStuck)
  c.view.setBounds({ x: 0, y: 0, width: 700, height: 500 })
  /** @param {string} js */
  const crun = (js) => c.webContents.executeJavaScript(js, true)
  const link = 'hg:' + 'x'.repeat(297)
  await crun(`(() => { const t = document.querySelector('textarea[name=text]'); t.value = ${JSON.stringify(link)}; t.closest('form').requestSubmit(); return 0 })()`)
  const shown = await waitFor(() => crun(`document.querySelector('[data-key]')?.textContent.includes(${JSON.stringify(link)})`), 10000)
  const wide = await crun("(() => { const m = document.querySelector('[data-key]'); const e = document.scrollingElement; return m.scrollWidth <= m.clientWidth + 1 && e.scrollWidth <= innerWidth + 1 })()")
  pass('chat: a 300-character hg: link wraps (no horizontal overflow)', shown && wide)
  const ffolder = path.join(tmp, 'forum-fit')
  fs.cpSync(path.join(HERE, '..', 'sites', 'forum'), ffolder, { recursive: true })
  const { key: fkey } = await rpc.request('site.publish', { folder: ffolder })
  const f = await openSite(fkey)
  views.push(f)
  win.contentView.addChildView(f.view)
  /** @param {string} s */
  const frun = (s) => f.webContents.executeJavaScript(s)
  await waitFor(() => frun("!!document.querySelector('.desk')"), 30000)
  const fit = await frun("window.hyper.instances.create('Fit', { private: true }).then((i) => i.key, (e) => 'error ' + e.code)")
  await frun(`location.search = '?instance=${fit}'; 0`)
  await waitFor(() => frun("!!document.querySelector('.layout')"), 30000)
  const forumStuck = await fitsAll(f)
  pass('forum: long words wrap anywhere (posts, titles, names: spec 028)', await frun("getComputedStyle(document.querySelector('.layout')).overflowWrap === 'anywhere'"))
  pass('forum: no page scrollbar at those sizes (its columns and its desk scroll)' + (forumStuck ? ' (scrolls at ' + forumStuck + ')' : ''), !forumStuck)
  const { key: draft } = await run('window.hyper.projects.list().then(([p]) => window.hyper.projects.preview(p.key))')
  const pv = await openSite(draft)
  views.push(pv)
  await waitFor(() => pv.webContents.executeJavaScript("document.readyState === 'complete'"), 15000)
  const t2 = performance.now()
  /** @type {Promise<void>} */
  const loaded = new Promise((resolve) => pv.webContents.once('did-finish-load', /** @type {() => void} */ (resolve)))
  pv.webContents.reload()
  await loaded
  const reload = performance.now() - t2
  pass('ide: the preview shows the project', await pv.webContents.executeJavaScript("document.body.innerText.includes('Self-test site')"))
  /** @param {number} x */
  const ms = (x) => Math.round(x)
  console.log(`PERF ide.start ${ms(start)} ms`)
  console.log(`PERF ide.editor ${ms(editorLoad)} ms`)
  console.log(`PERF ide.memory.start ${ms(before)} MB`)
  console.log(`PERF ide.memory.editor ${ms(after)} MB`)
  console.log(`PERF ide.preview.reload ${ms(reload)} ms`)
}

/**
 * @param {BaseWindowT} win
 * @param {Frame['inspect']} inspect
 * @param {Frame['dock']} dock
 * @param {Frame['undock']} undock
 * @param {string} key
 * @param {string} file
 * @returns {Promise<Array<[string, boolean]>>}
 */
async function checkSplit (win, inspect, dock, undock, key, file) {
  /** @type {Array<[string, boolean]>} */
  const out = []
  const wc = /** @type {WebContents} */ (inspect().wcs.find((w) => w.getURL().startsWith('hyper://' + key)))
  dock(wc, key)
  await waitFor(async () => !!inspect().side && !!inspect().handle && !(/** @type {import('electron').WebContentsView} */ (inspect().handle)).webContents.isLoading(), 15000)
  await wait(300)
  const { width } = win.getContentBounds()
  /** @param {ReturnType<Frame['inspect']>} i */
  const meet = (i) => !!i.side && i.views[0].width === i.side.x && i.side.x + i.side.width === width && i.views[0].y === i.side.y
  let i = inspect()
  out.push(['spec 027: the preview docks beside the site, the two meeting at the line (55% at first)', meet(i) && Math.abs(i.views[0].width - Math.round(width * 0.55)) <= 1])
  const h = /** @type {import('electron').WebContentsView} */ (i.handle).webContents // docked: waited for above
  const hb = /** @type {import('electron').WebContentsView} */ (i.handle).getBounds()
  out.push(["the line's handle: a 6px strip over the line, a focusable separator", hb.width === 6 && hb.x === i.views[0].width - 3 &&
    await h.executeJavaScript("document.getElementById('h').tabIndex === 0 && document.getElementById('h').getAttribute('role') === 'separator'")])
  const before = i.views[0].width
  h.focus()
  await h.executeJavaScript("document.getElementById('h').focus(); 0")
  for (let n = 0; n < 2; n++) {
    h.sendInputEvent({ type: 'keyDown', keyCode: 'Left' })
    h.sendInputEvent({ type: 'keyUp', keyCode: 'Left' })
  }
  await wait(300)
  i = inspect()
  out.push(['the arrow keys move the line (24px a step)', i.views[0].width === before - 48 && meet(i)])
  /** @param {number} x */
  const drag = async (x) => {
    const at = /** @type {import('electron').WebContentsView} */ (i.handle).getBounds().width === 6 ? 3 : i.views[0].width
    h.sendInputEvent({ type: 'mouseDown', x: at, y: 100, button: 'left', clickCount: 1 })
    await wait(250)
    h.sendInputEvent({ type: 'mouseMove', x, y: 100, button: 'left' })
    await wait(250)
    h.sendInputEvent({ type: 'mouseUp', x, y: 100, button: 'left', clickCount: 1 })
    await wait(300)
    i = inspect()
  }
  await drag(400)
  out.push(['a drag moves the line (to 400px); the handle a strip again after it', Math.abs(i.views[0].width - 400) <= 1 && meet(i) && /** @type {import('electron').WebContentsView} */ (i.handle).getBounds().width === 6])
  await drag(10)
  out.push(['each side keeps at least 240px', i.views[0].width === 240 && meet(i)])
  const saved = JSON.parse(fs.readFileSync(file, 'utf-8')).settings.split
  out.push(['the split is remembered (shell.json)', Math.abs(saved * width - 240) <= 1])
  undock(wc)
  await wait(200)
  out.push(['closing the preview gives the site the whole width', inspect().views[0].width === width && !inspect().side])
  dock(wc, key)
  await waitFor(async () => !!inspect().side, 15000)
  await wait(200)
  out.push(['docked again: the line where it was left', inspect().views[0].width === 240 && meet(inspect())])
  await wc.executeJavaScript("(() => { const t = document.createElement('textarea'); t.id = 'typing'; document.body.append(t); t.focus(); return 0 })()")
  win.focus()
  wc.focus()
  /** @param {string} text */
  const type = (text) => { for (const c of text) { wc.sendInputEvent({ type: 'keyDown', keyCode: c }); wc.sendInputEvent({ type: 'char', keyCode: c }); wc.sendInputEvent({ type: 'keyUp', keyCode: c }) } }
  /** @type {boolean[]} */
  const kept = []
  type('abc')
  for (const more of ['def', 'ghi', 'jkl']) {
    dock(wc, key)
    await waitFor(async () => !inspect().handle || !tabOfSide(inspect)?.isLoading(), 5000)
    await wait(400)
    kept.push(wc.isFocused() && !(await wc.executeJavaScript("document.activeElement?.id === 'typing'").then((x) => !x)))
    type(more)
  }
  await wait(200)
  const typed = await wc.executeJavaScript("(() => { const t = document.getElementById('typing'); return t.value + '|' + (t.selectionStart === t.value.length) })()")
  out.push(['typing while the preview reloads: the focus stays in the page, every key and the caret where they were', kept.every(Boolean) && typed === 'abcdefghijkl|true'])
  undock(wc)
  return out
}

/** @param {Frame['inspect']} inspect */
const tabOfSide = (inspect) => inspect().sideWc

/** @param {string} dir */
async function framecheck (dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-framecheck-'))
  fs.cpSync(path.join(HERE, '..', 'sites', 'demo'), path.join(tmp, 'site'), { recursive: true })
  const { key } = await rpc.request('site.publish', { folder: path.join(tmp, 'site') })
  const { fake, calls } = scripted(key)
  fs.writeFileSync(path.join(tmp, 'shell.json'), JSON.stringify({ settings: { circleNoticed: true } })) // the circles notice seen (a dialog would wait)
  const { win, inspect, notify, dock, undock, open: openTab } = startFrame({ rpc: fake, openSite, readIcon, identity: null, file: path.join(tmp, 'shell.json'), open: key })
  const timeout = setTimeout(() => { console.log('FRAMECHECK TIMEOUT'); app.exit(2) }, 90000)
  const settled = async () => inspect().ready === 1 && await inspect().fwc.executeJavaScript("document.getElementById('tabs').children.length === 2").catch(() => false)
  while (!(await settled())) await new Promise((resolve) => setTimeout(resolve, 250))
  await new Promise((resolve) => setTimeout(resolve, 500)) // the frame's 'bars' message
  clearTimeout(timeout)
  const i = inspect()
  const css = await i.fwc.executeJavaScript(`(() => {
    const region = (q) => { const c = getComputedStyle(document.querySelector(q)); return c.getPropertyValue('app-region') || c.getPropertyValue('-webkit-app-region') }
    const paths = [...document.querySelectorAll('[data-g] path')]
    return { top: region('#top'), clickable: ['#tabs', '#plus', '#hb', '#w-min', '#w-max', '#w-close'].map(region), bars: document.getElementById('bars').offsetHeight,
      glyphs: paths.length === document.querySelectorAll('[data-g]').length && paths.every((p) => p.getAttribute('d')), plus: document.querySelector('#plus path').getAttribute('d') }
  })()`)
  const site = await /** @type {WebContents} */ (openSiteOf(key)).executeJavaScript('typeof window.frame')
  await i.fwc.executeJavaScript("document.getElementById('hb').click(); document.getElementById('m-config').click(); document.getElementById('cf-devices').click()")
  const listed = await until(() => i.fwc.executeJavaScript("document.querySelectorAll('#dv-list li').length === 1 && document.querySelector('#dv-list li').textContent.includes('(this computer)')"))
  await i.fwc.executeJavaScript("document.getElementById('dv-add').click()")
  const coded = await until(() => i.fwc.executeJavaScript("(document.querySelector('#dv-out .code')?.textContent.length || 0) > 20"))
  if (process.env.HB_SHOT) fs.writeFileSync(process.env.HB_SHOT, (await i.fwc.capturePage()).toPNG())
  const circles = await checkCirclesWindow(i.fwc)
  const notes = await checkNotes(i.fwc, inspect, notify, calls)
  const names = await checkNames(i.fwc, key)
  openTab(key) // its tab current again (the checks before opened others)
  const split = await checkSplit(win, inspect, dock, undock, key, path.join(tmp, 'shell.json'))
  clearTimeout(timeout)
  const b = win.getBounds()
  const c = win.getContentBounds()
  /** @type {Array<[string, boolean]>} */
  const out = [
    ['no app menu (no File, Edit, View)', Menu.getApplicationMenu() === null],
    ['no OS frame: the window is all content', b.width === c.width && b.height === c.height],
    ['the taskbar row drags the window', css.top === 'drag'],
    ['tabs, +, the menu and the window buttons stay clickable', css.clickable.every((/** @type {string} */ r) => r === 'no-drag')],
    ['the site view starts right under the bars', i.views.length === 1 && i.views[0].y === i.bars && i.bars >= css.bars],
    ['over a site, the frame covers the bars only', i.frame.height === i.bars],
    ["a site's page has no door to the frame", site === 'undefined'],
    ['the icons are drawn from shell/icons/*.png (plus.png: a 5×5 cross)', css.glyphs && css.plus === 'M2 0h1v1H2zM2 1h1v1H2zM0 2h5v1H0zM2 3h1v1H2zM2 4h1v1H2z'],
    ['Devices: this computer listed (spec 012)', listed],
    ['Devices: Add a device shows a code', coded],
    ...circles,
    ...notes,
    ...names,
    ...split
  ]
  for (const [name, pass] of out) console.log((pass ? 'PASS ' : 'FAIL ') + 'frame  ' + name)
  const ok = out.every(([, pass]) => pass)
  console.log(ok ? 'FRAMECHECK PASS' : 'FRAMECHECK FAIL')
  win.destroy()
  await shutdown()
  for (const d of [tmp, dir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  app.exit(ok ? 0 : 1)
}

/** @param {WebContents} fwc @returns {Promise<Array<[string, boolean]>>} */
async function checkCirclesWindow (fwc) {
  /** @param {string} s */
  const js = (s) => fwc.executeJavaScript(s)
  await js("document.getElementById('dv-close').click(); document.getElementById('hb').click(); document.getElementById('m-config').click()")
  const section = await until(() => js("document.getElementById('cf-held').textContent === 'You hold 0 GB of 1 GB (off)' && document.querySelector('[data-hold=\"off\"]').getAttribute('aria-pressed') === 'true' && document.getElementById('cf-share').value === '1'"))
  await js("document.getElementById('cf-share').value = '0.05'; document.getElementById('cf-share-set').click()")
  const refused = await until(() => js("document.getElementById('cf-hold-out').textContent === 'At least 0.1 GB'"))
  await js("document.getElementById('cf-circles').click(); document.getElementById('cl-name').value = 'Frame'; document.getElementById('cl-create').click()")
  const made = await until(() => js("[...document.querySelectorAll('#cl-list li')].some((l) => l.textContent.startsWith('Frame1 member'))"))
  await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Members').click() })()")
  const members = await until(() => js("document.getElementById('cl-out').textContent.includes('(you)owner · holds')"))
  // Read again until hypergraph has the holder's record.
  const numbers = await until(async () => {
    await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Members').click() })()")
    await new Promise((resolve) => setTimeout(resolve, 300))
    return js("(() => { const t = document.getElementById('cl-out').textContent; return t.includes('(you)owner · holds · <0.1/') && t.includes('TOTAL ≈ ') })()")
  })
  await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Copy invite link').click() })()")
  const link = await until(() => js("(document.querySelector('#cl-out .code')?.textContent || '').startsWith('hg:')"))
  await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Invite contacts…').click() })()")
  const friends = await until(() => js("document.getElementById('cl-out').textContent === 'No friends yet: add some in Contacts'"))
  await js("document.getElementById('cl-join').click(); document.querySelector('#cl-out input').value = 'hg:nope'; [...document.querySelectorAll('#cl-out button')].find((b) => b.textContent === 'Join').click()")
  const pasted = await until(() => js("document.getElementById('cl-out').textContent.startsWith('This is not a circle invite')"))
  await js("document.getElementById('cl-close').click()")
  return [
    ['Configuration: Circles: holding off, the share (1 GB), what is held (spec 018)', section],
    ['Configuration: Circles: a share under 0.1 GB is refused, saying why', refused],
    ['Circles: Create a circle lists it (1 member)', made],
    ['Circles: … → Members: you, owner, holding (the first circle turned it on)', members],
    ["Circles: … → Members: what you hold of your share (<0.1/1 GB) and the circle's TOTAL (spec 021)", numbers],
    ['Circles: … → Copy invite link shows a link', link],
    ['Circles: … → Invite contacts… with no friend says so (spec 019)', friends],
    ['Circles: Join with a link… refuses a link that is not a circle invite, in the window', pasted]
  ]
}

/** @param {WebContents} fwc @param {string} key @returns {Promise<Array<[string, boolean]>>} */
async function checkNames (fwc, key) {
  /** @param {string} s */
  const js = (s) => fwc.executeJavaScript(s)
  /** @param {string} text */
  const type = (text) => js(`(() => { const a = document.getElementById('address'); a.focus(); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })()`)
  await type('hyper://demo@frame')
  const lookingUp = await until(() => js("document.getElementById('panel-text').textContent === 'Looking up demo@frame …'"))
  const shown = await until(() => js("document.activeElement !== document.getElementById('address') && document.getElementById('address').value === 'demo@frame' && document.getElementById('panel').hidden"))
  const keyed = await js(`[...document.querySelectorAll('#tabs .tab')].some((b) => b.title.includes('demo@frame · ' + ${JSON.stringify(key)}))`)
  await type('nope@frame')
  const refused = await until(() => js("document.getElementById('panel-text').textContent.startsWith('No such name in this authority.')"))
  await js("document.getElementById('panel-close').click()")
  return [
    ['names: name@authority shows "Looking up…" (spec 022)', lookingUp],
    ['names: it opens the site and the address bar keeps the name', shown],
    ["names: the site's key stays in its tab's info", keyed],
    ['names: an unknown name says so in plain words', refused]
  ]
}

const SCRIPT = { chat: /** @type {string} */ (/** @type {import('./model.js').Icon} */ (PRESET.find((p) => p.id === 'preset:chat')).key), forum: /** @type {string} */ (/** @type {import('./model.js').Icon} */ (PRESET.find((p) => p.id === 'preset:forum')).key), a: 'y'.repeat(52), b: 'b'.repeat(52) }
/**
 * An engine whose notify.* calls and one name are scripted; the rest goes to the real engine.
 * @param {string} site
 */
function scripted (site) {
  /** @type {Array<[string, Record<string, any>]>} */
  const calls = []
  /** @type {Set<string>} */
  const read = new Set()
  /** @param {number} n @param {string} app @param {string} place @param {string} text */
  const item = (n, app, place, text) => ({ app, place, id: 'r' + n, type: 'message', author: 'o'.repeat(52), name: 'Ann', text, open: null, stamp: n, at: n })
  const items = [item(3, SCRIPT.chat, SCRIPT.a, 'third'), item(2, SCRIPT.forum, SCRIPT.b, 'mentioned you'), item(1, SCRIPT.chat, SCRIPT.a, 'first')]
  const state = () => {
    /** @type {import('./ui/frame.js').Unread} */
    const unread = { total: 0, byApp: {}, byPlace: {} }
    for (const x of items) {
      if (read.has(x.place)) continue
      unread.total++
      unread.byApp[x.app] = (unread.byApp[x.app] || 0) + 1
      unread.byPlace[x.place] = (unread.byPlace[x.place] || 0) + 1
    }
    return {
      items: items.map((x) => ({ ...x, read: read.has(x.place) })),
      unread,
      apps: [{ key: SCRIPT.chat, title: 'Chat', allow: true, hide: false, places: [{ key: SCRIPT.a, name: 'Ann', muted: false }] },
        { key: SCRIPT.forum, title: 'HyperBrowser Forum', allow: true, hide: false, places: [{ key: SCRIPT.b, name: 'Climbing', muted: false }] }]
    }
  }
  const fake = {
    /** @param {string} method @param {Record<string, any>} [params] @returns {Promise<any>} */
    request (method, params = {}) {
      if (method === 'names.resolve') { // one name of a scripted authority (the engine's own call has its test)
        calls.push([method, params])
        if (params.address === 'demo@frame') return new Promise((resolve) => setTimeout(() => resolve({ key: site, authority: 'f'.repeat(52) }), 1000))
        return Promise.reject(Object.assign(new Error('no such name'), { code: 'UNKNOWN_NAME' }))
      }
      if (!method.startsWith('notify.')) return rpc.request(method, params)
      calls.push([method, params])
      if (method === 'notify.read') read.add(params.place)
      return Promise.resolve(method === 'notify.state' ? state() : true)
    }
  }
  return { fake, calls }
}

/**
 * @param {WebContents} fwc
 * @param {Frame['inspect']} inspect
 * @param {Frame['notify']} notify
 * @param {Array<[string, Record<string, any>]>} calls
 * @returns {Promise<Array<[string, boolean]>>}
 */
async function checkNotes (fwc, inspect, notify, calls) {
  /** @param {string} s */
  const js = (s) => fwc.executeJavaScript(s)
  await js("document.querySelector('#tabs .tab').click()")
  const counted = await until(() => js("document.getElementById('bell-n').textContent === '3'"))
  /** @param {string} key */
  const badge = (key) => `([...document.querySelectorAll('#grid .icon')].find((b) => b.title.endsWith(${JSON.stringify(key)}))?.querySelector('.badge')?.textContent || '')`
  const icons = await until(async () => (await js(badge(SCRIPT.chat))) === '2' && (await js(badge(SCRIPT.forum))) === '1')
  await js("document.getElementById('bell').click()")
  const rows = await until(() => js("!document.getElementById('notes').hidden && document.querySelectorAll('#notes-list .item').length === 2"))
  const order = await js("document.querySelector('#notes-list .item .text').textContent") === 'third'
  const marked = !!inspect().tray?.marked()
  await js("document.querySelector('#notes-list .item').click()")
  const read = await until(() => js("document.getElementById('bell-n').textContent === '1'")) && calls.some(([m, p]) => m === 'notify.read' && p.place === SCRIPT.a)
  await js("document.querySelector('#tabs .tab').click()")
  const down = await until(async () => (await js(badge(SCRIPT.chat))) === '' && (await js(badge(SCRIPT.forum))) === '1')
  await js("document.getElementById('hb').click(); document.getElementById('m-config').click()")
  const config = await until(() => js("document.querySelectorAll('#cf-apps .app').length === 2 && !!document.querySelector('#config [data-tray=\"off\"]') && !document.querySelector('#menu [data-tray]') && !document.getElementById('m-devices')"))
  await js("[...document.querySelectorAll('#cf-apps .app')][0].querySelectorAll('.choice')[1].click()")
  const blocked = await until(async () => calls.some(([m, p]) => m === 'notify.set' && p.app === SCRIPT.chat && p.allow === false))
  await js("document.getElementById('cf-close').click()")
  const before = inspect().popups
  // notes with the fields popups read
  await notify({ items: /** @type {Note[]} */ ([{ app: SCRIPT.chat, place: SCRIPT.a, id: 'n1' }, { app: SCRIPT.chat, place: SCRIPT.a, id: 'n2' }, { app: SCRIPT.forum, place: SCRIPT.b, id: 'n3' }]), summary: null })
  const perPlace = inspect().popups - before
  await notify({ items: /** @type {Note[]} */ ([{ app: SCRIPT.chat, place: SCRIPT.a, id: 'n4' }]), summary: { count: 500 } })
  const summary = inspect().popups - before - perPlace
  const popups = !Notification.isSupported() || (perPlace === 2 && summary === 1)
  const loud = inspect().popups
  await notify({ items: /** @type {Note[]} */ ([{ app: SCRIPT.forum, place: SCRIPT.b, id: 'n5', popup: false }]), summary: null })
  const quiet = inspect().popups === loud
  return [
    ['notifications: the counter between the address bar and the peers says 3 (spec 016)', counted],
    ["notifications: each app's desktop icon shows its share (Chat 2, Forum 1)", icons],
    ['notifications: the list has one row per conversation, newest first', rows && order],
    ['notifications: the tray is marked while something is unread', marked || !inspect().tray],
    ['notifications: a row opens its conversation and counts as read (counter 1)', read],
    ["notifications: read, the icon's count goes", down],
    ['Configuration: notifications per app, the tray setting and Devices moved there', config],
    ['Configuration: Blocked reaches the engine', blocked],
    ['notifications: popups, one per conversation; a catch-up, one in all', popups],
    ['notifications: a quiet follow is listed, never popped up (spec 017)', quiet]
  ]
}

// test:sandbox checks the process really ends: 'quit' (to the tray, launched again, then Quit) or 'off' (setting off, window closed).
/** @param {Frame} frame @param {string} mode */
async function traycheck ({ win, inspect, show }, mode) {
  /** @param {string} name @param {unknown} pass */
  const ok = (name, pass) => console.log((pass ? 'PASS ' : 'FAIL ') + 'tray  ' + name)
  /** @param {number} ms */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  /** @param {() => unknown} f */
  const until = async (f, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await f()) return true
    return false
  }
  const { fwc } = inspect()
  await until(() => !fwc.isLoading())
  if (mode === 'quit') {
    ok('on by default: an icon in the tray', !!inspect().tray && inspect().settings.tray === true)
    win.close()
    ok('closing the window hides it; HyperBrowser keeps running', await until(() => !win.isVisible()) && !win.isDestroyed())
    await wait(HEARTBEAT * 2)
    ok('the engine still answers, past its heartbeat', await rpc.request('ping').catch(() => false))
    ok('the tray says how many sites it hosts', await until(() => /^hosting \d+ sites?$/.test(/** @type {NonNullable<ReturnType<Frame['inspect']>['tray']>} */ (inspect().tray).status())))
    ok('the first time: the notice', inspect().notices === 1 && inspect().settings.trayNoticed === true)
    show()
    win.close()
    ok('only the first time', await until(() => !win.isVisible()) && inspect().notices === 1)
    console.log('TRAYCHECK WAITING') // the test launches HyperBrowser again, on the same data folder
    ok('a second launch shows this window', await until(() => win.isVisible(), 60000))
    console.log('TRAYCHECK QUIT')
    const quit = /** @type {import('electron').MenuItem} */ (/** @type {NonNullable<ReturnType<Frame['inspect']>['tray']>} */ (inspect().tray).item('Quit'))
    quit.click()
  } else {
    ok('the notice was remembered: not shown again', inspect().settings.trayNoticed === true && inspect().notices === 0)
    await fwc.executeJavaScript("document.getElementById('hb').click(); document.getElementById('m-config').click(); document.querySelector('[data-tray=\"off\"]').click()")
    ok('turned off in the menu: no tray', await until(() => !inspect().tray && inspect().settings.tray === false))
    console.log('TRAYCHECK CLOSE')
    win.close()
  }
}

function installed () {
  if (!app.isPackaged || !PKG.upgrade) return null
  if (process.platform === 'win32') return path.dirname(process.execPath)
  if (process.platform === 'linux') return process.env.APPIMAGE || null
  return path.join(process.resourcesPath, '..', '..')
}

function startUpdates () {
  const file = installed()
  log('HyperBrowser ' + PKG.version + (file ? ', channel ' + PKG.upgrade : ', no updates'))
  if (!file) return
  const name = PKG.productName + (process.platform === 'win32' ? '' : path.extname(file))
  const args = [app.getPath('userData'), PKG.version, PKG.upgrade, name, file, process.env.HYPERBROWSER_UPDATE_BOOTSTRAP || '', process.env.HYPERBROWSER_UPDATE_DELAY || '']
  updater = PearRuntime.run(fileURLToPath(new URL('./updater.js', import.meta.url)), args)
  let rest = ''
  updater.on('data', (d) => {
    const lines = (rest + /** @type {Uint8Array} */ (d)).split('\n')
    rest = /** @type {string} */ (lines.pop())
    for (const line of lines) {
      log('update: ' + line)
      if (!line.startsWith('ready ')) continue
      const [version, ...folder] = line.slice(6).split(' ')
      update = version
      incoming = folder.join(' ') || null
    }
  })
  const stderr = /** @type {NonNullable<typeof updater.stderr>} */ (updater.stderr) // piped (the default)
  stderr.on('data', (d) => log('updater: ' + String(d).trim()))
  updater.on('error', () => {})
}

// Windows can't replace the folder while HyperBrowser or its Bare workers run: a PowerShell step swaps it after the quit,
// started through WMI so nothing that ends with HyperBrowser takes it along. If it never runs, the next launch updates again.
/** @type {string | null} */
let incoming = null
let relaunch = false
/** @param {string} s */
const ps = (s) => "'" + s.replace(/'/g, "''") + "'"
app.on('will-quit', () => {
  if (!incoming) return
  const dir = path.dirname(process.execPath)
  const old = dir + '-' + PKG.version
  const exe = ps(path.join(dir, path.basename(process.execPath)))
  const start = relaunch ? `Start-Process ${exe}` + (process.argv.length > 1 ? ' -ArgumentList ' + process.argv.slice(1).map((a) => ps('"' + a + '"')).join(',') : '') : ''
  const script = `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue
$moved = $false
for ($i = 0; $i -lt 120 -and -not $moved; $i++) { try { Rename-Item -LiteralPath ${ps(dir)} -NewName ${ps(path.basename(old))} -ErrorAction Stop; $moved = $true } catch { Start-Sleep -Milliseconds 500 } }
if ($moved) {
  try { Move-Item -LiteralPath ${ps(/** @type {string} */ (incoming))} -Destination ${ps(dir)} -ErrorAction Stop; Remove-Item -LiteralPath ${ps(old)} -Recurse -Force }
  catch { if (-not (Test-Path -LiteralPath ${ps(dir)})) { Rename-Item -LiteralPath ${ps(old)} -NewName ${ps(path.basename(dir))} } }
}
${start}`
  const line = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${ps(line)} }).ReturnValue`], { windowsHide: true, timeout: 15000 })
  log('update: ' + update + ' takes the place of ' + PKG.version + ' once HyperBrowser has quit (' + (String(r.stdout).trim() === '0' ? 'started' : 'could not start: ' + (r.error?.message || String(r.stderr).trim())) + ')')
})

function restart () {
  const args = process.argv.slice(1)
  if (process.platform === 'linux') app.relaunch({ execPath: process.env.APPIMAGE, args: ['--appimage-extract-and-run', ...args.filter((a) => a !== '--appimage-extract-and-run')] })
  else if (process.platform === 'win32') relaunch = true // started by the swap, after the quit
  else app.relaunch()
  ui?.win.destroy() // the tray's Quit path: window-all-closed, shutdown(), app.quit()
}

/** @param {string} dir @param {object} [more] init's other params */
async function startEngine (dir, more = {}) {
  worker = PearRuntime.run(fileURLToPath(new URL('../engine/worker.js', import.meta.url)))
  const stderr = /** @type {NonNullable<typeof worker.stderr>} */ (worker.stderr) // piped (the default)
  stderr.on('data', (d) => process.stderr.write('engine: ' + /** @type {Uint8Array} */ (d)))
  const conn = connect(worker, { onEvent, onclose: () => { if (!quitting && stopping !== conn) { console.error('engine stopped without a word'); app.exit(1) } } })
  rpc = conn
  const projects = SELFTEST || FRAMECHECK ? path.join(dir, 'projects') : path.join(app.getPath('documents'), 'HyperBrowser')
  const up = await rpc.request('init', { dir, heartbeat: HEARTBEAT, deviceName: os.hostname(), bundle: path.join(HERE, '..', 'apps'), projects, ...more })
  if (APPS.chat) await rpc.request('apps.set', { chat: APPS.chat }) // friends' conversations are Chat's (also after a join)
  return up
}

// Not a restart: closing an engine seconds after a join can hang in hypergraph.
/** @param {string} dir @param {string} code */
async function join (dir, code) {
  const aside = dir + '-before-join-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  await stopEngine()
  await move(dir, aside)
  let said = 'joined'
  /** @type {string} */
  let identity
  try {
    ({ identity } = await startEngine(dir, { joinCode: code, joinTimeout: 60000 }))
    log("joined another device's identity; the one before is in " + aside)
  } catch (e) {
    const err = /** @type {Thrown} */ (e)
    said = err.message + ' (' + (err.code || 'ERROR') + ')'
    log('could not join: ' + said)
    await stopEngine()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    await move(aside, dir)
    ;({ identity } = await startEngine(dir))
  }
  /** @type {Frame} */ (ui).joined({ identity, said }) // the frame asked for this join
}

// A rename that waits for a just-ended worker to let go of its files (Windows: EBUSY, EPERM for a moment).
/** @param {string} from @param {string} to */
async function move (from, to) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to) } catch (err) {
      if (i >= 40 || !['EBUSY', 'EPERM', 'EACCES'].includes(/** @type {string} */ (/** @type {NodeJS.ErrnoException} */ (err).code))) throw err
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

/** @param {string} key */
const openSiteOf = (key) => [...viewOf].map(([id, k]) => k === key && webContents.fromId(id)).find(Boolean)

// The self-test and frame check: a fresh folder each run. --dir: another HyperBrowser, its identities beside it.
const HOME = SELFTEST || FRAMECHECK ? path.join(app.getPath('userData'), 'selftest-' + process.pid) : arg('--dir') ? arg('--dir') + '-identities' : app.getPath('userData')
const ids = identities(HOME, arg('--dir') || path.join(HOME, 'engine'))
let switching = false
let era = 0 // one per identity opened: a window's late calls never reach the next identity's engine

/** @param {string} identity */
function openFrame (identity) {
  const me = ids.current()
  const mine = era
  /**
   * @template {unknown[]} A
   * @template T
   * @param {(...args: A) => Promise<T>} f
   * @returns {(...args: A) => Promise<T>}
   */
  const own = (f) => (...args) => mine === era && rpc ? f(...args) : Promise.reject(Object.assign(new Error('engine stopped'), { code: 'CLOSED' }))
  const engine = { request: own((/** @type {string} */ method, /** @type {object | undefined} */ params) => rpc.request(method, params)) }
  const people = { list: ids.list, create: ids.create, rename: ids.rename, open: switchTo, remove: removeIdentity, phrase: own((/** @type {unknown} */ id, /** @type {string | undefined} */ password) => rpc.request('phrase.read', { dir: ids.get(id).dir, password })) }
  ui = startFrame({ rpc: engine, openSite: own(openSite), readIcon: own(readIcon), readViewed: own(readViewed), contacts: APPS.contacts, identity, file: me.shell, open: switching ? null : arg('--open'), update: () => update, restart, identities: people, join: (code) => join(ids.current().dir, code).catch((/** @type {Error} */ err) => { log('join: ' + err.message); app.exit(1) }) })
}

// Nothing of the identity before stays: its window (views, tray, popups) goes, then its engine, before the next starts.
/** @param {unknown} id */
async function switchTo (id) {
  const before = ids.current()
  if (switching || before.id === ids.get(id).id) return
  switching = true
  era++
  try {
    ui?.win.destroy()
    ui = null
    await stopEngine()
    engineErred = false
    ids.use(id)
    let up
    try {
      up = await startEngine(ids.current().dir)
    } catch (e) {
      log('could not open that identity: ' + /** @type {Error} */ (e).message)
      await stopEngine()
      ids.use(before.id)
      up = await startEngine(before.dir)
    }
    openFrame(up.identity)
  } finally {
    switching = false
  }
}

// A session still open (the identity was used since launch) keeps its folder locked: cleared now, its folder swept at the next start.
/** @param {unknown} id */
async function removeIdentity (id) {
  const { prefix } = ids.remove(id)
  const root = path.join(app.getPath('userData'), 'Partitions')
  /** @type {string[]} */
  let names = []
  try { names = fs.readdirSync(root).filter((n) => n.startsWith(prefix + 'site-')) } catch {}
  for (const name of names) {
    try { fs.rmSync(path.join(root, name), { recursive: true }) } catch {
      const ses = session.fromPartition('persist:' + name)
      await ses.clearStorageData()
      await ses.clearCache()
    }
  }
}

app.whenReady().then(async () => {
  if (!FIRST) return
  ids.sweep(path.join(app.getPath('userData'), 'Partitions'))
  const dir = ids.current().dir
  if (SELFTEST) testnet = await (await import('hyperdht/testnet.js')).default(3)
  const { identity } = await startEngine(dir, testnet ? { bootstrap: testnet.bootstrap } : {})
  setInterval(() => rpc && rpc.request('ping').catch(() => {}), HEARTBEAT / 2)
  log('engine up') // no identity named: the log is one file for all of them
  if (SELFTEST) return selftest(HOME)
  if (FRAMECHECK) return framecheck(HOME)
  if (IDCHECK === 'sweep') return app.exit(0)
  if (!TRAYCHECK && !IDCHECK) startUpdates()
  openFrame(identity)
  if (TRAYCHECK) traycheck(/** @type {Frame} */ (ui), TRAYCHECK)
  if (IDCHECK) (await import('./selftest/identities.js')).identitycheck({ ui: () => ui, ids, engine: () => rpc, pid: () => /** @type {{ _process?: { pid?: number } }} */ (/** @type {unknown} */ (worker))?._process?.pid, switching: () => switching })
}).catch((err) => { console.error(err); app.exit(1) })

app.on('window-all-closed', async () => {
  if (SELFTEST || FRAMECHECK || switching) return
  await shutdown()
  app.quit()
})
