// The shell: runs the engine as a Bare worker (pear-runtime), keeps it alive with heartbeats, serves
// hyper://<key>/ from the engine, and shows each site in its own sandboxed view inside the frame
// (frame.js, spec 002). Only this file bridges a site to the engine, and it names the site from the view.
//   npm start [-- --open <key>] [-- --dir <engine folder>]
//   npm run selftest [-- --no-guards]      (the sandbox self-test; --no-guards is its control run: must fail)
//   npm run framecheck                     (the frame: no OS frame, no app menu, sites under the bars)
//   electron . --user-data-dir=<tmp> --traycheck quit|off   (the tray, spec 010: npm run test:sandbox runs it)
// Installed (npm run build, spec 011), it also follows its release channel: see startUpdates().
import { app, BaseWindow, ipcMain, protocol, dialog, Menu, webContents, nativeTheme, Notification } from 'electron'
import fs from 'fs'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import PearRuntime from 'pear-runtime'
import { connect, pair } from '../engine/protocol.js'
import { createSiteView } from './views.js'
import { startFrame } from './frame.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELFTEST = process.argv.includes('--selftest')
const FRAMECHECK = process.argv.includes('--framecheck')
const GUARDS = !process.argv.includes('--no-guards')
const TRAYCHECK = process.argv.includes('--traycheck') ? process.argv[process.argv.indexOf('--traycheck') + 1] : null
const HEARTBEAT = 2000
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1] }

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript',
  css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', wasm: 'application/wasm'
}
const typeOf = (p) => TYPES[p.split('.').pop().toLowerCase()] || 'application/octet-stream'
const PKG = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf-8'))
// The official apps the shell's own calls open (spec 013): their keys once Tibo published them (preset.json)
const PRESET = JSON.parse(fs.readFileSync(path.join(HERE, 'preset.json'), 'utf-8'))
const APPS = { chat: PRESET.find((p) => p.id === 'preset:chat')?.key || null, contacts: PRESET.find((p) => p.id === 'preset:contacts')?.key || null }
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/

// An installed HyperBrowser has no console: what it says also goes to <data folder>/hyperbrowser.log.
const LOG = app.isPackaged ? path.join(app.getPath('userData'), 'hyperbrowser.log') : null
function log (line) {
  console.log(line)
  if (!LOG) return
  try {
    if (fs.statSync(LOG, { throwIfNoEntry: false })?.size > 1e6) fs.rmSync(LOG) // shortcut: one file, cut at 1 MB
    fs.appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n')
  } catch {}
}

// One HyperBrowser a data folder (spec 010): a second launch shows the first one's window (maybe in the tray)
// instead of a second engine on the same folder. Another --dir is another HyperBrowser (two-peer testing).
const FIRST = SELFTEST || FRAMECHECK || !!arg('--dir') || app.requestSingleInstanceLock()
if (!FIRST) app.quit()
let ui = null // startFrame's { win, inspect, show }
app.on('second-instance', () => ui?.show())

// Windows shows a popup (spec 016) only for an app id its Start menu shortcut names: the installer's (scripts/build.js).
// From the repo, Electron's own id is left as is. shortcut: unchecked by hand yet (R8); a balloon if it fails.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('org.hyperbrowser.app')

protocol.registerSchemesAsPrivileged([{ scheme: 'hyper', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let rpc = null
let worker = null
let updater = null
let update = null // the version installed by an update, started at the next launch (spec 011)
let quitting = false
let stopping = null // the engine connection being stopped (a join, spec 012)
const sites = new Map() // key -> { manifest, dynamic }
const viewOf = new Map() // webContents id -> site key
const subscribers = new Map() // engine subscription id -> webContents
const early = new Map() // engine subscription id -> events that came before its reply
const pages = new WeakMap() // webContents -> how many pages it has loaded (the preload's 'page' message)
const asking = new Map() // key -> the identity question in progress
const asked = [] // keys the question was asked for (the self-test checks: once per site)
const permits = new Map() // key + permission -> the contacts (spec 013) or projects (spec 024) question in progress
const notifyAsks = new Map() // key -> the notifications question in progress (spec 016)
const viewed = new WeakMap() // webContents -> the instance its page says it shows (hyper.notifications.viewing)
const marked = [] // the self-test's record of the places a page's viewing marked read
const peopleOpened = [] // the self-test's record of what hyper.people opened (no frame there)
const appsInstalled = new Set() // the self-test's installs and opens through hyper.apps (spec 014)
const appsOpened = []
const heard = [] // the self-test's record of which subscriptions the engine still sends events for
let selftestYes = false // the self-test's answer to "Install …?"
let testnet = null // the self-test's own DHT (spec 017: a second person, Ann, in Chat)

async function serve (key, p) {
  const { bytes, path: real } = await rpc.request('site.read', { key, path: p })
  return { bytes, type: typeOf(real) }
}

function onEvent (event, data) {
  if (event === 'devices') return ui?.devices()
  if (event === 'circles') return ui?.circles()
  if (event === 'notify') return ui?.notify(data)
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

// "Let this site use your identity?": once per site; the engine remembers the answer.
function ask (key) {
  if (!asking.has(key)) {
    asked.push(key)
    const title = sites.get(key).manifest.title
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 1, cancelId: 1, message: `Let "${title}" use your identity?`, detail: 'It will read and write in its own space as you. You can change this later.' }).then((r) => r.response === 0)
    asking.set(key, answer.then(async (allow) => {
      await rpc.request('site.consent', { key, allow })
      if (allow && declares(sites.get(key).manifest)) askNotify(key) // spec 016: the next question (not waited for)
    }).finally(() => asking.delete(key)))
  }
  return asking.get(key)
}

// "Let this site see and manage your contacts?" (spec 013) or "...your projects?" (spec 024): once per site
// declaring it; the engine remembers.
const QUESTIONS = {
  contacts: ['see and manage your contacts', 'It will list your friends and requests, accept or remove them, and send requests. Only HyperBrowser\'s Contacts and Chat need this.'],
  projects: ['edit and publish your projects', 'It will read and change the files of your projects, publish their sites, preview them and invite co-authors. Nothing outside your projects. Only an editor like HyperBrowser\'s IDE needs this.']
}
function askPermit (key, permission = 'contacts') {
  const id = key + ' ' + permission
  if (!permits.has(id)) {
    const title = sites.get(key).manifest.title
    const [what, detail] = QUESTIONS[permission]
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 1, cancelId: 1, message: `Let "${title}" ${what}?`, detail }).then((r) => r.response === 0)
    permits.set(id, answer.then((allow) => rpc.request('site.permit', { key, permission, allow })).finally(() => permits.delete(id)))
  }
  return permits.get(id)
}

// "Let this app notify you?": right after the identity question (spec 016), once; the engine remembers.
function askNotify (key) {
  if (!notifyAsks.has(key)) {
    const title = sites.get(key).manifest.title
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 0, cancelId: 1, message: `Let "${title}" notify you?`, detail: 'HyperBrowser watches what it says (new messages, mentions), even while it is closed, and tells you. You can change this in Configuration.' }).then((r) => r.response === 0)
    notifyAsks.set(key, answer.then((allow) => rpc.request('site.permit', { key, permission: 'notifications', allow })).catch(() => {}).finally(() => notifyAsks.delete(key)))
  }
  return notifyAsks.get(key)
}
const declares = (manifest) => manifest.permissions.includes('notifications') && !!manifest.notifications?.length

// What a page says it shows, marked read for its own app only (the engine checks the place is that app's).
// The frame calls it only while that tab is current and the window focused.
async function readViewed (wc) {
  const place = viewed.get(wc)
  const key = viewOf.get(wc.id)
  if (!place || !key) return null
  const ok = await rpc.request('notify.read', GUARDS ? { place, app: key } : { place }).then(() => true, () => false)
  if (ok && SELFTEST) marked.push(place)
  return ok ? place : null
}

// Events on their way land in `early` meanwhile; the engine's answer comes after them.
async function unsubscribe (id) {
  subscribers.delete(id)
  await rpc?.request('site.off', { id }).catch(() => {})
  early.delete(id)
  return true
}

function stopAll (wc) {
  for (const [id, x] of subscribers) if (x === wc) unsubscribe(id)
  return true
}

async function bridge (wc, msg) {
  if (msg.op === 'page') { // a real load: a hash change runs no preload, a cancelled navigation doesn't get here
    pages.set(wc, (pages.get(wc) || 0) + 1)
    return stopAll(wc)
  }
  const page = pages.get(wc)
  let key = viewOf.get(wc.id)
  let sub = msg.sub ?? null
  let instance = msg.instance ?? null // one of the app's instances (spec 009): the engine checks it is
  if (!GUARDS && sites.has(sub)) { key = sub; sub = null } // control run: trusts a key from the page
  if (!GUARDS && sites.has(instance)) { key = instance; instance = null }
  if (!GUARDS && sites.has(msg.site)) key = msg.site // spec 018's checks: another app's instance, named with its app
  if (msg.op === 'viewing') { // spec 016
    if (msg.instance !== null && typeof msg.instance !== 'string') throw Object.assign(new Error('an instance key or null'), { code: 'INVALID_PARAMS' })
    viewed.set(wc, msg.instance)
    ui?.looked()
    return true
  }
  if (msg.op === 'off') return !GUARDS || subscribers.get(msg.id) === wc ? unsubscribe(msg.id) : false // only this page's own
  const method = { call: 'site.call', live: 'site.live', on: 'site.on' }[msg.op]
  if (!method) throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  // only the fields of that call; the key is the view's
  const params = { key, sub, instance, method: msg.method, args: msg.args, chain: msg.chain, opts: msg.opts, event: msg.event }
  const permission = (typeof msg.method === 'string' && msg.method.startsWith('projects.')) || msg.event === 'projects' ? 'projects' : 'contacts'
  if (msg.op === 'call' && msg.method === 'projects.openFolder') params.args = [await pickFolder()] // spec 024: never a page's path
  if (msg.op === 'call' && msg.method === 'projects.closePreview') return !!ui?.undock(wc) // spec 025: the shell's alone
  let result
  try {
    result = await rpc.request(method, params)
  } catch (err) {
    if (err.code !== 'NEEDS_CONSENT' && err.code !== 'NEEDS_PERMISSION') throw err
    await (err.code === 'NEEDS_CONSENT' ? ask(key) : askPermit(key, permission))
    result = await rpc.request(method, params).catch(async (err) => { // the identity first, then the contacts or projects
      if (err.code !== 'NEEDS_PERMISSION') throw err
      await askPermit(key, permission)
      return rpc.request(method, params)
    })
  }
  if (msg.op === 'call' && (msg.method === 'projects.preview' || msg.method === 'projects.resetPreview') && result?.key) ui?.dock(wc, result.key) // spec 025
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

// hyper.projects.openFolder() (spec 024): the person picks the folder; cancelled: CANCELLED.
async function pickFolder () {
  const o = { title: 'Open a folder as a project', properties: ['openDirectory'] }
  const r = await (ui?.win ? dialog.showOpenDialog(ui.win, o) : dialog.showOpenDialog(o))
  if (r.canceled || !r.filePaths[0]) throw Object.assign(new Error('no folder picked'), { code: 'CANCELLED' })
  return r.filePaths[0]
}

ipcMain.handle('site', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await bridge(evt.sender, msg || {}) }
  } catch (err) {
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

// hyper.people (spec 013): what any site may ask of the person's contacts and chats, through HyperBrowser only.
// Opening needs a click on the page (the preload says whether one is running); a request, the person's yes.
async function people (wc, { op, identity, name, activated }) {
  if (typeof identity !== 'string' || !KEY.test(identity)) throw Object.assign(new Error('not a person\'s key'), { code: 'INVALID_PARAMS' })
  if (op === 'request') {
    const site = sites.get(viewOf.get(wc.id)).manifest.title
    const who = (typeof name === 'string' && name.trim() ? `"${name.trim().slice(0, 64)}" ` : '') + `(key ${identity.slice(0, 8)}…)`
    const yes = !GUARDS || (!SELFTEST && (await dialog.showMessageBox({ type: 'question', buttons: ['Send', 'Cancel'], defaultId: 1, cancelId: 1, message: `Send a friend request to ${who}?`, detail: `"${site}" asks. The name comes from that site: check the key if it matters.` })).response === 0)
    if (!yes) throw Object.assign(new Error('the person said no'), { code: 'NOT_ALLOWED' })
    return rpc.request('contacts.request', { identity, name })
  }
  if (op !== 'chat' && op !== 'contact') throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  if (GUARDS && !activated) return false // only right after a click on the page
  const c = op === 'chat' ? await rpc.request('contacts.get', { identity }) : null
  const [key, query] = c?.state === 'friend' ? [c.chat, ''] : [APPS.contacts, '?person=' + identity] // not a friend: their page
  if (SELFTEST) return !!peopleOpened.push(key || op)
  if (!key) throw Object.assign(new Error('Contacts is not published yet'), { code: 'NOT_PUBLISHED' })
  ui?.open(key, query)
  return true
}

ipcMain.handle('people', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await people(evt.sender, msg || {}) }
  } catch (err) {
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

// hyper.apps (spec 014): any site may offer to install or open another (the Apps store does), through HyperBrowser
// only. Both need a click on the page; installing, the person's yes to a question naming the app by its own title.
async function apps (wc, { op, key, activated }) {
  if (typeof key !== 'string' || !KEY.test(key)) throw Object.assign(new Error("not a site's key"), { code: 'INVALID_PARAMS' })
  const installed = () => SELFTEST ? appsInstalled.has(key) : !!ui?.installed(key)
  if (op === 'installed') return installed()
  if (op !== 'install' && op !== 'open') throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  if (GUARDS && !activated) return false // only right after a click on the page
  if (op === 'open') {
    if (SELFTEST) return !!appsOpened.push(key)
    ui?.open(key)
    return true
  }
  if (installed()) return true
  const { manifest, key: real } = await rpc.request('site.open', { key }) // its own title, not the page's words
  rpc.request('site.close', { key: real }).catch(() => {})
  const site = sites.get(viewOf.get(wc.id)).manifest.title
  const yes = !GUARDS || (SELFTEST ? selftestYes : (await dialog.showMessageBox({ type: 'question', buttons: ['Install', 'Cancel'], defaultId: 1, cancelId: 1, message: `Install "${manifest.title}"?`, detail: `Key ${key.slice(0, 8)}…, from "${site}". Installed, it stays on your desktop, works offline, and your computer serves it to others.` })).response === 0)
  if (!yes) throw Object.assign(new Error('the person said no'), { code: 'NOT_ALLOWED' })
  if (SELFTEST) appsInstalled.add(key)
  else ui.install(key, manifest.title)
  return true
}

ipcMain.handle('apps', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await apps(evt.sender, msg || {}) }
  } catch (err) {
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

// hyper.circles.join (spec 018): a page offers a circle's invite (Chat's Join button); only HyperBrowser joins, after
// a click on the page and the person's yes (the notice the first time). A page has no circles.* call of the engine.
async function circles (wc, { op, link, name, activated }) {
  if (op !== 'join') throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  if (typeof link !== 'string' || !link.startsWith('hg:')) throw Object.assign(new Error('an invite link (hg:...)'), { code: 'INVALID_PARAMS' })
  if (GUARDS && !activated) return { joined: false } // only right after a click on the page
  if (!GUARDS) return { joined: !!(await rpc.request('circles.join', { link })) } // control run: no question
  if (SELFTEST) return { joined: false } // the person's Not now
  return { joined: (await ui.joinCircle(link, typeof name === 'string' ? name : '')).joined } // the page learns no more
}

ipcMain.handle('circles', async (evt, msg) => {
  if (!viewOf.has(evt.sender.id)) return { error: { code: 'NOT_ALLOWED', message: 'not a site' } }
  try {
    return { result: await circles(evt.sender, msg || {}) }
  } catch (err) {
    return { error: { code: err.code || 'ERROR', message: err.message } }
  }
})

async function openSite (key, query = '') {
  const { manifest, dynamic, key: real, instance = null, ...rest } = await rpc.request('site.open', { key })
  sites.set(real, { manifest, dynamic })
  if (instance) query = '?instance=' + instance + (query.startsWith('#') ? query : '') // an app's instance (spec 009): the app's pages, told which one; a notification's place in it (spec 016)
  if (rest.notify === 'ask') askNotify(real) // spec 016: identity said yes before, this question not asked yet
  const v = createSiteView(real, { dynamic, serve, guards: GUARDS, persist: !SELFTEST, query })
  viewOf.set(v.webContents.id, real)
  v.webContents.on('destroyed', () => {
    stopAll(v.webContents)
    rpc?.request('site.close', { key: real }).catch(() => {}) // the engine leaves it a while later unless installed (spec 004)
  })
  return { key: real, instance, manifest, ...v }
}

const IMAGES = new Set(['png', 'gif', 'svg', 'webp', 'jpg', 'jpeg', 'ico'])

// A site's icon (site.json `icon`) as a data URL for the frame, or null.
async function readIcon (key, manifest) {
  if (!manifest.icon || !IMAGES.has(manifest.icon.split('.').pop().toLowerCase())) return null
  const { bytes, type } = await serve(key, manifest.icon)
  return 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64')
}

async function shutdown () {
  quitting = true
  if (updater) { updater.end(); updater = null } // it closes by itself (or dies with the app)
  await stopEngine()
}

async function stopEngine () {
  const [r, w] = [rpc, worker]
  stopping = r // its stream's end is expected (startEngine's onclose)
  if (r) await r.request('close').catch(() => {})
  if (w) {
    const exited = new Promise((resolve) => { if (w._exited) resolve(); else w.once('exit', resolve) })
    w.destroy() // kills it if it didn't exit by itself
    await exited
  }
  if (rpc === r) rpc = worker = null
}

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

// The sandbox self-test: two dynamic sites and a static one, published from copies of shell/selftest/site.
async function selftest (dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-selftest-'))
  const folder = (name, manifest) => {
    const dir = path.join(tmp, name)
    fs.cpSync(path.join(HERE, 'selftest', 'site'), dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(manifest))
    return dir
  }
  const keys = []
  const dyn = (title) => ({ title, permissions: ['space', 'notifications'], types: { note: { fields: { text: 'string' } } } }) // spec 017: no watch, so no question
  for (const [name, manifest] of [['a', dyn('Site A')], ['b', dyn('Site B')], ['c', { title: 'Static C' }]]) {
    keys.push((await rpc.request('site.publish', { folder: folder(name, manifest) })).key)
  }
  const [a, b, c] = keys
  await rpc.request('apps.set', { chat: a }) // spec 013: a request makes a conversation of some app
  const views = [await openSite(a, '?other=' + b), await openSite(b, '?other=' + a), await openSite(c, '?other=' + a + '&static=1')]
  const win = new BaseWindow({ width: 1500, height: 800, title: 'HyperBrowser self-test' + (GUARDS ? '' : ' (no guards)') })
  layout(win, views)

  const timeout = setTimeout(async () => { // where each page stopped: its last line is the check that hangs
    for (const v of views) console.log(await v.webContents.executeJavaScript("document.getElementById('out').innerText").catch(() => '?'))
    console.log('SELFTEST TIMEOUT')
    app.exit(2)
  }, 90000)
  let results
  for (;;) {
    results = await Promise.all(views.map((v) => v.webContents.executeJavaScript('window.__results || null').catch(() => null)))
    if (results.every(Boolean)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  clearTimeout(timeout)
  const out = results.flat()
  out.push({ site: 'shell', name: 'the identity question: asked once per dynamic site, never for the static one', pass: asked.length === 2 && asked.includes(a) && asked.includes(b) })
  // spec 013: what the pages asked of hyper.people without a click, or refused by the person, did nothing
  out.push({ site: 'shell', name: 'hyper.people: nothing opened without a click', pass: peopleOpened.length === 0 })
  out.push({ site: 'shell', name: 'hyper.people: a request the person refused sent nothing', pass: (await rpc.request('contacts.get', { identity: b })) === null })
  // spec 014: hyper.apps installs only after a click (executeJavaScript's user gesture) and the person's yes
  out.push({ site: 'shell', name: 'hyper.apps: nothing installed or opened without a click', pass: appsInstalled.size === 0 && appsOpened.length === 0 })
  const install = () => views[0].webContents.executeJavaScript(`window.hyper.apps.install(${JSON.stringify(c)}).then(String, (e) => e.code)`, true)
  const refused = await install()
  out.push({ site: 'shell', name: "hyper.apps: a click and the person's no install nothing", pass: refused === 'NOT_ALLOWED' && !appsInstalled.has(c) })
  selftestYes = true
  const said = await install()
  out.push({ site: 'shell', name: 'hyper.apps: a click and a yes install it', pass: said === 'true' && appsInstalled.has(c) })
  // the look (spec 008): HyperBrowser's theme reaches sites; a page with no stylesheet gets the default theme
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (f) => { for (let n = 0; n < 100; n++) { if (await f().catch(() => false)) return true; await wait(100) } return false }

// A real load ends the old page's subscriptions and only those; a hash change or a cancelled navigation ends none.
async function checkLoads ([a, b], out) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const wc = b.webContents
  const run = (s) => wc.executeJavaScript(s)
  const mine = (w = wc) => [...subscribers].filter(([, x]) => x === w).map(([id]) => id)
  const got = () => run('window.__got')
  const put = async () => {
    const n = await got()
    await run("window.hyper.put('profile', { name: 'load' }).then(() => 0)")
    return until(async () => (await got()) > n)
  }

  // the reply to a subscribe comes after its page left
  const flying = bridge(wc, { op: 'live', args: ['profile'], chain: [] })
  bridge(wc, { op: 'page' }).catch(() => {})
  const late = await flying
  pass('a subscribe answered after its page left is stopped', !subscribers.has(late.id))

  await wc.loadURL('hyper://' + b.key + '/nav.html')
  await until(async () => (await got()) > 0)
  await a.webContents.executeJavaScript("window.hyper.query('profile').live(() => {}); 0")
  await until(async () => mine(a.webContents).length > 0)
  const other = mine(a.webContents).at(-1)

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

// spec 016: a page tells what it shows, and silences that only, for its own app; it reads nothing back.
async function checkNotifications ([a, b], out) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const own = await rpc.request('site.call', { key: a.key, method: 'instances.create', args: ['mine'] })
  const other = await rpc.request('site.call', { key: b.key, method: 'instances.create', args: ['theirs'] })
  const viewing = (k) => a.webContents.executeJavaScript(`window.hyper.notifications.viewing(${JSON.stringify(k)}).then(String, (e) => e.code)`)
  await viewing(other.key)
  await readViewed(a.webContents) // as the frame does while that tab is current and the window focused
  pass("notifications: a page's viewing can't mark another app's conversation read", !marked.includes(other.key))
  await viewing(own.key)
  await readViewed(a.webContents)
  pass("notifications: a page's viewing marks its own app's conversation read", marked.includes(own.key))
  await checkOwnCounts(a, b, own, other, pass)
  const api = await a.webContents.executeJavaScript('Object.keys(window.hyper.notifications).join()')
  const asked = await bridge(a.webContents, { op: 'call', method: 'notify.state', args: [] }).then(() => 'read', (e) => e.code)
  pass("notifications: a page can't read the person's notifications or their settings (notify.* refused; its own app's counts only, spec 017)", api === 'viewing,unread,on,follow,unfollow,follows' && asked === 'UNKNOWN_METHOD')
}

// spec 017: a page reaches its own app's counts and follows only. Each check names B's site as the instance, which
// the control run takes for the page's site (as with the other guards): there it reads and changes B's.
async function checkOwnCounts (a, b, own, other, pass) {
  const ask = (method, args = []) => bridge(a.webContents, { op: 'call', instance: b.key, method, args }).then((r) => r, (e) => ({ error: e.code }))
  const counts = await ask('notifications.unread')
  pass("notifications: a page can't read another app's counts", !counts.error && own.key in counts && !(other.key in counts))
  const theirs = await rpc.request('site.call', { key: b.key, method: 'notifications.follow', args: [{ place: other.key, type: 'note', says: 'a note' }] })
  const listed = await ask('notifications.follows')
  pass("notifications: a page can't read another app's follows", Array.isArray(listed) && !listed.some((f) => f.id === theirs.id))
  await ask('notifications.unfollow', [theirs.id])
  const still = await rpc.request('site.call', { key: b.key, method: 'notifications.follows', args: [] })
  pass("notifications: a page can't remove another app's follow", still.some((f) => f.id === theirs.id))
  const made = await ask('notifications.follow', [{ place: other.key, type: 'note', says: 'a note' }])
  pass("notifications: a page can't follow another app's places", made.error === 'NOT_ALLOWED')
  const gone = await rpc.request('site.call', { key: b.key, method: 'instances.create', args: ['gone'] })
  await wait(1000)
  const sub = await bridge(a.webContents, { op: 'on', instance: b.key, event: 'notifications' })
  const mark = heard.length
  await rpc.request('site.call', { key: b.key, method: 'instances.leave', args: [gone.key] }) // B's counts change: one place fewer
  await wait(1000)
  pass("notifications: a page doesn't hear another app's counts", !heard.slice(mark).includes(sub.id))
  await bridge(a.webContents, { op: 'off', id: sub.id })
}

// spec 018: copies and rotateKey (spec 023: secure and trimHistory) reach the page's own app's instances only (each check names B's site with B's
// private instance, which the control run takes for the page's site); a circle is joined only through HyperBrowser.
async function checkCircles ([a, b], out) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const theirs = await rpc.request('site.call', { key: b.key, method: 'instances.create', args: ['Theirs', { private: true }] })
  const ask = (method) => bridge(a.webContents, { op: 'call', site: b.key, instance: theirs.key, method, args: [] }).then(() => 'done', (e) => e.code)
  pass("copies: a page can't read another app's instance's copies", (await ask('copies')) === 'NOT_ALLOWED')
  pass("rotateKey: a page can't change another app's instance's key", (await ask('rotateKey')) === 'NOT_ALLOWED')
  pass("secure: a page can't renew another app's instance", (await ask('secure')) === 'NOT_ALLOWED') // spec 023
  pass("trimHistory: a page can't trim another app's instance", (await ask('trimHistory')) === 'NOT_ALLOWED')
  const circle = await rpc.request('circles.create', { name: 'Self-test' })
  const { link } = await rpc.request('circles.invite', { key: circle.key })
  const asked = await bridge(a.webContents, { op: 'call', method: 'circles.join', args: [link] }).then(() => 'joined', (e) => e.code)
  pass('circles: a page has no circles.* call of the engine', asked === 'UNKNOWN_METHOD')
  const clicked = await a.webContents.executeJavaScript(`window.hyper.circles.join(${JSON.stringify(link)}).then((r) => JSON.stringify(r), (e) => e.code)`, true)
  pass("circles: a click and the person's Not now join nothing", clicked === '{"joined":false}')
}

// Chat's page, in a real browser: where a redraw leaves the message list and the caret.
async function checkChat (win, views, out, tmp) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const folder = path.join(tmp, 'chat') // a copy: publishing links a folder both ways with the engine
  fs.cpSync(path.join(HERE, '..', 'sites', 'chat'), folder, { recursive: true })
  const { key } = await rpc.request('site.publish', { folder })
  const chat = await openSite(key)
  views.push(chat)
  win.contentView.addChildView(chat.view)
  chat.view.setBounds({ x: 0, y: 0, width: 500, height: 800 })
  const run = (s) => chat.webContents.executeJavaScript(s)
  await until(() => run("!!document.querySelector('input[name=name]')"))
  await run("(() => { const i = document.querySelector('input[name=name]'); i.value = 'Scroll'; i.form.requestSubmit(); return 0 })()")
  await until(() => run("!!document.querySelector('textarea[name=text]')"))
  const list = "document.querySelector('main div[style*=overflow]')"
  const box = "document.querySelector('textarea[name=text]')"
  let shown = 0
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

const waitFor = async (f, ms = 60000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await f().catch(() => false)) return true; return false }

// spec 017 SC-005: Chat opens at a "New messages" line just above the unread messages, in view; sending goes to the
// end; a group and a direct conversation alike (oldest at the top). Ann: a second engine, in this process, on the
// self-test's own DHT. 30 messages read, then 5 unread.
async function checkChatLine ({ key, view }, out, tmp) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const { start } = await import('../engine/index.js')
  const [x, y] = pair()
  start(x)
  const ann = connect(y, {})
  try {
    await ann.request('init', { dir: path.join(tmp, 'ann'), bootstrap: testnet.bootstrap })
    await ann.request('site.open', { key, timeout: 60000 })
    await ann.request('site.consent', { key, allow: true })
    const as = (e, method, args = [], instance = null) => e.request('site.call', { key, instance, method, args })
    for (const [e, name] of [[rpc, 'Bob'], [ann, 'Ann']]) {
      await e.request('apps.set', { chat: key })
      await e.request('site.permit', { key, permission: 'contacts', allow: true })
      await e.request('site.permit', { key, permission: 'notifications', allow: true })
      await as(e, 'contacts.setMe', [{ name }])
    }
    const annId = (await as(ann, 'info')).identity
    await as(rpc, 'contacts.add', [(await as(ann, 'contacts.link')).link])
    let direct = null
    await waitFor(async () => (direct = (await as(rpc, 'contacts.list')).find((c) => c.identity === annId && c.state === 'friend')?.chat))
    const group = (await as(ann, 'instances.create', ['Line', { private: true }])).key
    await as(rpc, 'instances.join', [await as(ann, 'createInvite', [{ role: 'member' }], group)])
    const run = (s) => view.webContents.executeJavaScript(s)
    const list = "document.querySelector('main div[style*=overflow]')"
    for (const [kind, place] of [['a group', group], ['a direct conversation', direct]]) {
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
    // spec 018: a page's instances.join of a circle link (Ann's) doesn't leave Bob in the circle (the engine's guard:
    // the control run doesn't change it; its one use is spent, a known limit)
    const ring = await ann.request('circles.create', { name: 'Ann only' })
    const { link } = await ann.request('circles.invite', { key: ring.key })
    const before = (await rpc.request('hosting')).sites
    const said = await run(`window.hyper.instances.join(${JSON.stringify(link)}).then(() => 'joined', (e) => e.code)`)
    pass("circles: a page's instances.join of a circle link leaves the person out of it", said === 'NOT_ALLOWED' && (await rpc.request('hosting')).sites === before && !(await rpc.request('circles.list')).some((c) => c.key === ring.key))
    // Ann invites Bob from Contacts: Chat shows a Join button in their conversation; a click asks HyperBrowser (Not now)
    await as(ann, 'contacts.inviteToCircle', [(await as(rpc, 'contacts.me')).identity, ring.key])
    await run(`location.search = '?instance=${direct}'; 0`)
    const button = "[...document.querySelectorAll('main button')].find((b) => b.textContent.startsWith('Accept Ann\\'s invitation to ') && b.textContent.includes('Ann only'))"
    const shown = await waitFor(() => run(`!!${button}`), 30000)
    const asked = shown && await view.webContents.executeJavaScript(`${button}.click(); 0`, true).then(() => waitFor(async () => !(await rpc.request('circles.list')).some((c) => c.key === ring.key), 3000))
    pass("chat: a circle's invite shows Accept Ann's invitation; its click asks HyperBrowser, nothing joined on Not now", shown && asked)
  } finally {
    await ann.request('close').catch(() => {})
  }
}

// spec 019 FR-004, FR-005: a "…" menu opens without moving anything else on the page (every element's box before
// and after, but the menu's own content). `menu`: an expression for the menu's element, `open`: a script opening it.
async function moves (run, menu, open) {
  const places = `((m) => [...document.body.querySelectorAll('*')].filter((e) => !(m.contains(e) && !e.matches('summary, [aria-haspopup]'))).map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join() }).join('|'))(${menu})`
  await run('document.fonts.ready.then(() => 0)') // the theme's font loading late moved text (a false "moved")
  const before = await run(places)
  await run(open + '; 0')
  await wait(300)
  return before !== await run(places)
}

// Contacts' friend "…" (Bob's friend Ann, his circle "Self-test"), Chat's message "…", a Forum's "…", in real pages.
async function checkMenus (win, views, out, tmp, chat) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const page = async (name, query = '') => {
    const folder = path.join(tmp, name)
    fs.cpSync(path.join(HERE, '..', 'sites', name), folder, { recursive: true })
    const { key } = await rpc.request('site.publish', { folder })
    const v = await openSite(key, query)
    views.push(v)
    win.contentView.addChildView(v.view)
    v.view.setBounds({ x: 0, y: 0, width: 700, height: 800 })
    return { key, v, run: (s) => v.webContents.executeJavaScript(s) }
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
  pass('chat: a message\'s "…" opens without moving anything', await chat.view.webContents.executeJavaScript(`!!${msg}`) && !(await moves((s) => chat.view.webContents.executeJavaScript(s), msg, `${msg}.querySelector('summary').click()`)))

  const forum = await page('forum')
  await waitFor(() => forum.run("!!document.querySelector('.desk')"), 30000)
  const made = await forum.run("window.hyper.instances.create('Menus', { private: true }).then((i) => i.key, (e) => 'error ' + e.code)")
  await forum.run(`location.search = '?instance=${made}'; 0`)
  const fm = "document.querySelector('details.menu')"
  const shown = await waitFor(() => forum.run(`!!${fm}`), 30000)
  pass('forum: a forum\'s "…" opens without moving anything', shown && !(await moves(forum.run, fm, `${fm}.querySelector('summary').click()`)))
  // spec 023: its owner's "…" on a private forum: Secure this place… (a box with the history checkbox off) and Trim history…
  const button = (label) => `[...document.querySelectorAll('details.menu button')].find((b) => b.textContent === ${JSON.stringify(label)})`
  const both = await waitFor(() => forum.run(`!!${button('Secure this place…')} && !!${button('Trim history…')}`), 20000)
  pass('forum: its owner\'s "…" has Secure this place… and Trim history…', both)
  await forum.run(`${button('Secure this place…')}.click(); 0`)
  pass('forum: Secure this place… asks first, "Also delete history before now" off', await waitFor(() => forum.run("!!document.querySelector('.confirm-box input[type=checkbox]') && !document.querySelector('.confirm-box input[type=checkbox]').checked"), 5000))
  await forum.run("[...document.querySelectorAll('.confirm-box button')].find((b) => b.textContent === 'Cancel').click(); 0")
  await forum.run(`${button('Trim history…')}.click(); 0`)
  pass('forum: Trim history… warns that copies taken can\'t be recalled', await waitFor(() => forum.run("!!document.querySelector('.confirm-box') && document.querySelector('.confirm-box').textContent.includes('be recalled')"), 5000))
}

// spec 025: the IDE in a real page. A beginner makes a site of two pages without a file name or JSON in sight, typing
// builds the page; a developer's file opens CodeMirror (loaded then), the default theme stays. Its costs are printed
// as PERF lines (perf/ide.mjs records them): start, the editor's load, memory before and after, a preview's reload.
async function checkIde (win, views, out, tmp, chat) {
  const pass = (name, ok) => out.push({ site: 'shell', name, pass: !!ok })
  const folder = path.join(tmp, 'ide')
  fs.cpSync(path.join(HERE, '..', 'sites', 'ide'), folder, { recursive: true })
  const { key } = await rpc.request('site.publish', { folder })
  const t0 = performance.now()
  const v = await openSite(key)
  views.push(v)
  win.contentView.addChildView(v.view)
  v.view.setBounds({ x: 0, y: 0, width: 900, height: 800 })
  const run = (s) => v.webContents.executeJavaScript(s, true)
  const started = await waitFor(() => run("document.querySelector('h1')?.textContent === 'IDE' && !!document.querySelector('form')"), 30000)
  const start = performance.now() - t0
  pass('ide: it opens (its projects asked for once)', started)
  const memory = () => (app.getAppMetrics().find((m) => m.pid === v.webContents.getOSProcessId())?.memory.workingSetSize || 0) / 1024 // MB
  const button = (label) => `[...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(label)})`
  await run("(() => { const f = document.querySelector('form'); f.name.value = 'Self-test site'; f.kind.value = 'hypermd'; f.requestSubmit(); return 0 })()")
  const made = await waitFor(() => run("document.querySelector('nav[aria-label=Pages]')?.textContent.includes('Self-test site')"), 30000)
  await run(`${button('New page')}.click(); 0`)
  await waitFor(() => run("!!document.querySelector('dialog[open] input')"), 5000)
  await run("(() => { const d = document.querySelector('dialog[open]'); d.querySelector('input').value = 'About'; d.querySelector('button').click(); return 0 })()")
  const two = await waitFor(() => run("document.querySelectorAll('nav[aria-label=Pages] li').length === 2 && document.querySelector('nav').textContent.includes('About')"), 15000)
  const bare = await run("!/\\.(hmd|html|json)\\b|\\{/.test(document.body.innerText)")
  pass('ide: a beginner makes a site of two pages, by their titles, with no file name or JSON shown (FR-001)', made && two && bare)
  await run("(() => { const a = document.querySelector('textarea'); a.value += 'Hello **you**'; a.dispatchEvent(new Event('input')); return 0 })()")
  // spec 026: built pages live outside the project; the preview (the project, then its built pages) shows them
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
  const item = (p) => `document.querySelector('[role=treeitem][data-path=${JSON.stringify(p)}]')`
  await waitFor(() => run(`!!${item('index.hmd')}`), 5000)
  await run(`${item('index.hmd')}.click(); 0`)
  const cm = await waitFor(() => run("!!document.querySelector('#editor')?.shadowRoot?.querySelector('.cm-editor')"), 15000)
  const editorLoad = performance.now() - t1
  pass('ide: a file in the files view opens in CodeMirror, loaded then', cm)
  pass('ide: the default theme stays with the editor loaded', await run("getComputedStyle(document.body).fontFamily.includes('HB ')"))
  const after = memory()
  // spec 026 I1: the tree: a right-click menu, Shift+F10 on the focused row, Escape, rename in place, a new folder
  const menuItems = "[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((b) => b.textContent).join('|')"
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
  // spec 026 I2, I3: the list hidden (remembered), the editor's settings
  await run(`${button('Hide the list')}.click(); 0`)
  const hidden = await waitFor(() => run("!document.querySelector('nav[aria-label=Files]') && !!document.querySelector('#editor')"), 5000)
  const remembered = await waitFor(() => run('window.hyper.mine.all().then((m) => m.tree === false)'), 5000) // saved in the background
  pass('ide: Hide the list gives the editor the room, and is remembered', hidden && remembered)
  await run(`${button('Show the list')}.click(); 0`)
  await run(`${menu}.querySelector('button').click(); 0`)
  await run(`${button('Editor settings')}.click(); 0`)
  await waitFor(() => run("!!document.querySelector('main input[type=checkbox]')"), 5000)
  await run("(() => { const c = document.querySelector('main input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change')); return 0 })()")
  const saved = await waitFor(() => run('window.hyper.mine.all().then((m) => m.editor?.wrap === true)'), 5000)
  await run(`${button('← Back to the editor')}.click(); 0`)
  const wrapping = await waitFor(() => run("!!document.querySelector('#editor')?.shadowRoot?.querySelector('.cm-lineWrapping')"), 10000)
  pass('ide: Editor settings: line wrapping on, saved per person (hyper.mine)', saved && wrapping)
  // spec 026 L5: a button keeps its shadow's room, so a pressed one never covers the next
  pass('ide: buttons keep their shadow\'s room (2px right and below)', await run("(() => { const c = getComputedStyle(document.querySelector('button')); return c.marginRight === '2px' && c.marginBottom === '2px' })()"))
  // spec 026 L3: apps fit the window at every size; only their parts scroll
  const sizes = [[1400, 800], [1000, 700], [700, 500], [480, 360]]
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
  const ffolder = path.join(tmp, 'forum-fit')
  fs.cpSync(path.join(HERE, '..', 'sites', 'forum'), ffolder, { recursive: true })
  const { key: fkey } = await rpc.request('site.publish', { folder: ffolder })
  const f = await openSite(fkey)
  views.push(f)
  win.contentView.addChildView(f.view)
  const frun = (s) => f.webContents.executeJavaScript(s)
  await waitFor(() => frun("!!document.querySelector('.desk')"), 30000)
  const fit = await frun("window.hyper.instances.create('Fit', { private: true }).then((i) => i.key, (e) => 'error ' + e.code)")
  await frun(`location.search = '?instance=${fit}'; 0`)
  await waitFor(() => frun("!!document.querySelector('.layout')"), 30000)
  const forumStuck = await fitsAll(f)
  pass('forum: no page scrollbar at those sizes (its columns and its desk scroll)' + (forumStuck ? ' (scrolls at ' + forumStuck + ')' : ''), !forumStuck)
  const { key: draft } = await run('window.hyper.projects.list().then(([p]) => window.hyper.projects.preview(p.key))')
  const pv = await openSite(draft)
  views.push(pv)
  await waitFor(() => pv.webContents.executeJavaScript("document.readyState === 'complete'"), 15000)
  const t2 = performance.now()
  const loaded = new Promise((resolve) => pv.webContents.once('did-finish-load', resolve))
  pv.webContents.reload()
  await loaded
  const reload = performance.now() - t2
  pass('ide: the preview shows the project', await pv.webContents.executeJavaScript("document.body.innerText.includes('Self-test site')"))
  const ms = (x) => Math.round(x)
  console.log(`PERF ide.start ${ms(start)} ms`)
  console.log(`PERF ide.editor ${ms(editorLoad)} ms`)
  console.log(`PERF ide.memory.start ${ms(before)} MB`)
  console.log(`PERF ide.memory.editor ${ms(after)} MB`)
  console.log(`PERF ide.preview.reload ${ms(reload)} ms`)
}

// The frame check: the demo site in a frame of its own, then where everything is.
async function framecheck (dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-framecheck-'))
  fs.cpSync(path.join(HERE, '..', 'sites', 'demo'), path.join(tmp, 'site'), { recursive: true })
  const { key } = await rpc.request('site.publish', { folder: path.join(tmp, 'site') })
  const { fake, calls } = scripted(key)
  fs.writeFileSync(path.join(tmp, 'shell.json'), JSON.stringify({ settings: { circleNoticed: true } })) // spec 018: Q8's notice seen (a dialog would wait)
  const { win, inspect, notify } = startFrame({ rpc: fake, openSite, readIcon, identity: null, file: path.join(tmp, 'shell.json'), open: key })
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
  const site = await openSiteOf(key).executeJavaScript('typeof window.frame')
  // the Devices window (spec 012): from the menu, this computer listed, a code to add another
  await i.fwc.executeJavaScript("document.getElementById('hb').click(); document.getElementById('m-config').click(); document.getElementById('cf-devices').click()")
  const listed = await until(() => i.fwc.executeJavaScript("document.querySelectorAll('#dv-list li').length === 1 && document.querySelector('#dv-list li').textContent.includes('(this computer)')"))
  await i.fwc.executeJavaScript("document.getElementById('dv-add').click()")
  const coded = await until(() => i.fwc.executeJavaScript("(document.querySelector('#dv-out .code')?.textContent.length || 0) > 20"))
  if (process.env.HB_SHOT) fs.writeFileSync(process.env.HB_SHOT, (await i.fwc.capturePage()).toPNG())
  const circles = await checkCirclesWindow(i.fwc)
  const notes = await checkNotes(i.fwc, inspect, notify, calls)
  const names = await checkNames(i.fwc, key)
  clearTimeout(timeout)
  const b = win.getBounds()
  const c = win.getContentBounds()
  const out = [
    ['no app menu (no File, Edit, View)', Menu.getApplicationMenu() === null],
    ['no OS frame: the window is all content', b.width === c.width && b.height === c.height],
    ['the taskbar row drags the window', css.top === 'drag'],
    ['tabs, +, the menu and the window buttons stay clickable', css.clickable.every((r) => r === 'no-drag')],
    ['the site view starts right under the bars', i.views.length === 1 && i.views[0].y === i.bars && i.bars >= css.bars],
    ['over a site, the frame covers the bars only', i.frame.height === i.bars],
    ["a site's page has no door to the frame", site === 'undefined'],
    ['the icons are drawn from shell/icons/*.png (plus.png: a 5×5 cross)', css.glyphs && css.plus === 'M2 0h1v1H2zM2 1h1v1H2zM0 2h5v1H0zM2 3h1v1H2zM2 4h1v1H2z'],
    ['Devices: this computer listed (spec 012)', listed],
    ['Devices: Add a device shows a code', coded],
    ...circles,
    ...notes,
    ...names
  ]
  for (const [name, pass] of out) console.log((pass ? 'PASS ' : 'FAIL ') + 'frame  ' + name)
  const ok = out.every(([, pass]) => pass)
  console.log(ok ? 'FRAMECHECK PASS' : 'FRAMECHECK FAIL')
  win.destroy()
  await shutdown()
  for (const d of [tmp, dir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  app.exit(ok ? 0 : 1)
}

// spec 018: Configuration's Circles section (holding off, its share), then the circles window: a circle made, its
// members (you, holding), an invite link.
async function checkCirclesWindow (fwc) {
  const js = (s) => fwc.executeJavaScript(s)
  await js("document.getElementById('dv-close').click(); document.getElementById('hb').click(); document.getElementById('m-config').click()")
  const section = await until(() => js("document.getElementById('cf-held').textContent === 'You hold 0 GB of 1 GB (off)' && document.querySelector('[data-hold=\"off\"]').getAttribute('aria-pressed') === 'true' && document.getElementById('cf-share').value === '1'"))
  await js("document.getElementById('cf-share').value = '0.05'; document.getElementById('cf-share-set').click()")
  const refused = await until(() => js("document.getElementById('cf-hold-out').textContent === 'At least 0.1 GB'"))
  await js("document.getElementById('cf-circles').click(); document.getElementById('cl-name').value = 'Frame'; document.getElementById('cl-create').click()")
  const made = await until(() => js("[...document.querySelectorAll('#cl-list li')].some((l) => l.textContent.startsWith('Frame1 member'))"))
  await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Members').click() })()")
  const members = await until(() => js("document.getElementById('cl-out').textContent.includes('(you)owner · holds')"))
  // spec 021: this computer's held/share and the circle's TOTAL (its share ÷ 5); the Members window read again until hypergraph has its record
  const numbers = await until(async () => {
    await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Members').click() })()")
    await new Promise((resolve) => setTimeout(resolve, 300))
    return js("(() => { const t = document.getElementById('cl-out').textContent; return t.includes('(you)owner · holds · <0.1/') && t.includes('TOTAL ≈ ') })()")
  })
  await js("(() => { const d = document.querySelector('#cl-list details'); d.open = true; [...d.querySelectorAll('button')].find((b) => b.textContent === 'Copy invite link').click() })()")
  const link = await until(() => js("(document.querySelector('#cl-out .code')?.textContent || '').startsWith('hg:')"))
  // spec 019: Invite contacts… with no friend yet; a pasted link that isn't a circle's
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

// spec 022's frame check: name@authority in the address bar opens the site it names (the engine's names.resolve,
// scripted) and keeps showing the name; an unknown name says so in plain words.
async function checkNames (fwc, key) {
  const js = (s) => fwc.executeJavaScript(s)
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

// spec 016's frame check: the engine's notify.* answered with scripted notifications (3 unread: 2 in a Chat
// conversation, 1 in a forum), the rest passed to the real engine. calls: what the frame asked.
const SCRIPT = { chat: PRESET.find((p) => p.id === 'preset:chat').key, forum: PRESET.find((p) => p.id === 'preset:forum').key, a: 'y'.repeat(52), b: 'b'.repeat(52) }
function scripted (site) {
  const calls = []
  const read = new Set()
  const item = (n, app, place, text) => ({ app, place, id: 'r' + n, type: 'message', author: 'o'.repeat(52), name: 'Ann', text, open: null, stamp: n, at: n })
  const items = [item(3, SCRIPT.chat, SCRIPT.a, 'third'), item(2, SCRIPT.forum, SCRIPT.b, 'mentioned you'), item(1, SCRIPT.chat, SCRIPT.a, 'first')]
  const state = () => {
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
    request (method, params = {}) {
      if (method === 'names.resolve') { // spec 022: one name of a scripted authority (the engine's own call has its test)
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

async function checkNotes (fwc, inspect, notify, calls) {
  const js = (s) => fwc.executeJavaScript(s)
  await js("document.querySelector('#tabs .tab').click()") // the desktop
  const counted = await until(() => js("document.getElementById('bell-n').textContent === '3'"))
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
  await js("[...document.querySelectorAll('#cf-apps .app')][0].querySelectorAll('.choice')[1].click()") // Chat: Blocked
  const blocked = await until(async () => calls.some(([m, p]) => m === 'notify.set' && p.app === SCRIPT.chat && p.allow === false))
  await js("document.getElementById('cf-close').click()")
  const before = inspect().popups
  await notify({ items: [{ app: SCRIPT.chat, place: SCRIPT.a, id: 'n1' }, { app: SCRIPT.chat, place: SCRIPT.a, id: 'n2' }, { app: SCRIPT.forum, place: SCRIPT.b, id: 'n3' }], summary: null })
  const perPlace = inspect().popups - before
  await notify({ items: [{ app: SCRIPT.chat, place: SCRIPT.a, id: 'n4' }], summary: { count: 500 } })
  const summary = inspect().popups - before - perPlace
  const popups = !Notification.isSupported() || (perPlace === 2 && summary === 1)
  const loud = inspect().popups
  await notify({ items: [{ app: SCRIPT.forum, place: SCRIPT.b, id: 'n5', popup: false }], summary: null })
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

// The tray check (spec 010): the app itself, in a data folder of its own (--user-data-dir). It ends the way
// `mode` says, and npm run test:sandbox checks the process really ends: 'quit' (closed to the tray, launched
// again, then the tray's Quit) or 'off' (the setting turned off in the menu, then the window closed).
async function traycheck ({ win, inspect, show }, mode) {
  const ok = (name, pass) => console.log((pass ? 'PASS ' : 'FAIL ') + 'tray  ' + name)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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
    ok('the tray says how many sites it hosts', await until(() => /^hosting \d+ sites?$/.test(inspect().tray.status())))
    ok('the first time: the notice', inspect().notices === 1 && inspect().settings.trayNoticed === true)
    show()
    win.close()
    ok('only the first time', await until(() => !win.isVisible()) && inspect().notices === 1)
    console.log('TRAYCHECK WAITING') // the test launches HyperBrowser again, on the same data folder
    ok('a second launch shows this window', await until(() => win.isVisible(), 60000))
    console.log('TRAYCHECK QUIT')
    inspect().tray.item('Quit').click()
  } else {
    ok('the notice was remembered: not shown again', inspect().settings.trayNoticed === true && inspect().notices === 0)
    await fwc.executeJavaScript("document.getElementById('hb').click(); document.getElementById('m-config').click(); document.querySelector('[data-tray=\"off\"]').click()")
    ok('turned off in the menu: no tray', await until(() => !inspect().tray && inspect().settings.tray === false))
    console.log('TRAYCHECK CLOSE')
    win.close()
  }
}

// P2P updates (spec 011): only an installed build that follows a channel, never from source (npm start).
// What pear-runtime replaces: the .AppImage, the .app, or on Windows the folder (HyperBrowser\, its .exe
// and files). The data folder is the same one either way.
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
  const name = PKG.productName + (process.platform === 'win32' ? '' : path.extname(file)) // its name in the release
  const args = [app.getPath('userData'), PKG.version, PKG.upgrade, name, file, process.env.HYPERBROWSER_UPDATE_BOOTSTRAP || '', process.env.HYPERBROWSER_UPDATE_DELAY || '']
  updater = PearRuntime.run(fileURLToPath(new URL('./updater.js', import.meta.url)), args)
  let rest = ''
  updater.on('data', (d) => {
    const lines = (rest + d).split('\n')
    rest = lines.pop()
    for (const line of lines) {
      log('update: ' + line)
      if (!line.startsWith('ready ')) continue
      const [version, ...folder] = line.slice(6).split(' ')
      update = version
      incoming = folder.join(' ') || null
    }
  })
  updater.stderr.on('data', (d) => log('updater: ' + String(d).trim()))
  updater.on('error', () => {})
}

// Windows: the downloaded folder takes the installed folder's place once HyperBrowser (and its Bare workers,
// whose files are in it) has quit: a PowerShell step renames the installed folder away (retrying while files
// are still in use), moves the new one in, puts the old one back if that fails, else deletes it; for restart
// it then starts the new HyperBrowser.exe. Started through WMI, not as our child, so nothing that ends with
// HyperBrowser takes it along. If it never runs (power cut), the next launch gets the update again.
let incoming = null
let relaunch = false
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
  try { Move-Item -LiteralPath ${ps(incoming)} -Destination ${ps(dir)} -ErrorAction Stop; Remove-Item -LiteralPath ${ps(old)} -Recurse -Force }
  catch { if (-not (Test-Path -LiteralPath ${ps(dir)})) { Rename-Item -LiteralPath ${ps(old)} -NewName ${ps(path.basename(dir))} } }
}
${start}`
  const line = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${ps(line)} }).ReturnValue`], { windowsHide: true, timeout: 15000 })
  log('update: ' + update + ' takes the place of ' + PKG.version + ' once HyperBrowser has quit (' + (String(r.stdout).trim() === '0' ? 'started' : 'could not start: ' + (r.error?.message || String(r.stderr).trim())) + ')')
})

// The new version now: the same file again (swapped by now, or at the quit on Windows), the same arguments.
function restart () {
  const args = process.argv.slice(1)
  if (process.platform === 'linux') app.relaunch({ execPath: process.env.APPIMAGE, args: ['--appimage-extract-and-run', ...args.filter((a) => a !== '--appimage-extract-and-run')] })
  else if (process.platform === 'win32') relaunch = true // started by the swap, after the quit
  else app.relaunch()
  ui.win.destroy() // the tray's Quit path: window-all-closed, shutdown(), app.quit()
}

// The engine, as a Bare worker: rpc set, then init in `dir` (with `more`: a join code, spec 012).
async function startEngine (dir, more = {}) {
  worker = PearRuntime.run(fileURLToPath(new URL('../engine/worker.js', import.meta.url)))
  worker.stderr.on('data', (d) => process.stderr.write('engine: ' + d))
  const conn = connect(worker, { onEvent, onclose: () => { if (!quitting && stopping !== conn) { console.error('engine stopped without a word'); app.exit(1) } } })
  rpc = conn
  // spec 015: the apps a build packed (scripts/build.js --apps-from) next to shell/; none when run from the repo
  const projects = SELFTEST || FRAMECHECK ? path.join(dir, 'projects') : path.join(app.getPath('documents'), 'HyperBrowser') // spec 024: where the person finds them
  const up = await rpc.request('init', { dir, heartbeat: HEARTBEAT, deviceName: os.hostname(), bundle: path.join(HERE, '..', 'apps'), projects, ...more })
  if (APPS.chat) await rpc.request('apps.set', { chat: APPS.chat }) // spec 013: friends' conversations are Chat's (also after a join)
  return up
}

// Join another device's identity (spec 012): this computer's engine folder is moved aside (kept), a new one
// joins with the code; a failed join puts the old folder back. The frame then goes on with whichever engine
// is up. Not a restart: closing an engine seconds after a join can hang in hypergraph (seen 2026-11-08).
async function join (dir, code) {
  const aside = dir + '-before-join-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
  await stopEngine()
  await move(dir, aside)
  let said = 'joined'
  let identity
  try {
    ({ identity } = await startEngine(dir, { joinCode: code, joinTimeout: 60000 }))
    log("joined another device's identity " + identity + '; the one before is in ' + aside)
  } catch (err) {
    said = err.message + ' (' + (err.code || 'ERROR') + ')'
    log('could not join: ' + said)
    await stopEngine()
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    await move(aside, dir)
    ;({ identity } = await startEngine(dir))
  }
  ui.joined({ identity, said })
}

// A rename that waits for a just-ended worker to let go of its files (Windows: EBUSY, EPERM for a moment).
async function move (from, to) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to) } catch (err) {
      if (i >= 40 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

const openSiteOf = (key) => [...viewOf].map(([id, k]) => k === key && webContents.fromId(id)).find(Boolean)

app.whenReady().then(async () => {
  if (!FIRST) return
  const dir = arg('--dir') || path.join(app.getPath('userData'), SELFTEST || FRAMECHECK ? 'selftest-' + process.pid : 'engine')
  if (SELFTEST) testnet = await (await import('hyperdht/testnet.js')).default(3) // spec 017: two people, offline
  const { identity } = await startEngine(dir, testnet ? { bootstrap: testnet.bootstrap } : {})
  setInterval(() => rpc && rpc.request('ping').catch(() => {}), HEARTBEAT / 2)
  log('engine up, identity ' + identity)
  if (SELFTEST) return selftest(dir)
  if (FRAMECHECK) return framecheck(dir)
  if (!TRAYCHECK) startUpdates()
  // the frame and the tray reach whichever engine is up (a join starts another, spec 012)
  const engine = { request: (method, params) => rpc ? rpc.request(method, params) : Promise.reject(Object.assign(new Error('engine stopped'), { code: 'CLOSED' })) }
  ui = startFrame({ rpc: engine, openSite, readIcon, readViewed, contacts: APPS.contacts, identity, file: path.join(app.getPath('userData'), 'shell.json'), open: arg('--open'), update: () => update, restart, join: (code) => join(dir, code).catch((err) => { log('join: ' + err.message); app.exit(1) }) })
  if (TRAYCHECK) traycheck(ui, TRAYCHECK)
}).catch((err) => { console.error(err); app.exit(1) })

app.on('window-all-closed', async () => {
  if (SELFTEST || FRAMECHECK) return // the checks exit with their own code
  await shutdown()
  app.quit()
})
