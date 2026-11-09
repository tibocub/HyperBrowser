// The shell: runs the engine as a Bare worker (pear-runtime), keeps it alive with heartbeats, serves
// hyper://<key>/ from the engine, and shows each site in its own sandboxed view inside the frame
// (frame.js, spec 002). Only this file bridges a site to the engine, and it names the site from the view.
//   npm start [-- --open <key>] [-- --dir <engine folder>]
//   npm run selftest [-- --no-guards]      (the sandbox self-test; --no-guards is its control run: must fail)
//   npm run framecheck                     (the frame: no OS frame, no app menu, sites under the bars)
//   electron . --user-data-dir=<tmp> --traycheck quit|off   (the tray, spec 010: npm run test:sandbox runs it)
// Installed (npm run build, spec 011), it also follows its release channel: see startUpdates().
import { app, BaseWindow, ipcMain, protocol, dialog, Menu, webContents, nativeTheme } from 'electron'
import fs from 'fs'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import PearRuntime from 'pear-runtime'
import { connect } from '../engine/protocol.js'
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
const asking = new Map() // key -> the identity question in progress
const asked = [] // keys the question was asked for (the self-test checks: once per site)
const permits = new Map() // key -> the contacts question in progress (spec 013)
const peopleOpened = [] // the self-test's record of what hyper.people opened (no frame there)
const appsInstalled = new Set() // the self-test's installs and opens through hyper.apps (spec 014)
const appsOpened = []
let selftestYes = false // the self-test's answer to "Install …?"

async function serve (key, p) {
  const { bytes, path: real } = await rpc.request('site.read', { key, path: p })
  return { bytes, type: typeOf(real) }
}

function onEvent (event, data) {
  if (event === 'devices') return ui?.devices()
  if (event === 'closing') {
    if (!quitting && data.reason !== 'close') { console.error('engine stopped:', data.reason); app.exit(1) } // 'close': asked (a join)
    return
  }
  if (event !== 'live' && event !== 'event') return
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
    asking.set(key, answer.then((allow) => rpc.request('site.consent', { key, allow })).finally(() => asking.delete(key)))
  }
  return asking.get(key)
}

// "Let this site see and manage your contacts?": once per site declaring it (spec 013); the engine remembers.
function askPermit (key) {
  if (!permits.has(key)) {
    const title = sites.get(key).manifest.title
    const answer = SELFTEST
      ? Promise.resolve(true)
      : dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Refuse'], defaultId: 1, cancelId: 1, message: `Let "${title}" see and manage your contacts?`, detail: 'It will list your friends and requests, accept or remove them, and send requests. Only HyperBrowser\'s Contacts and Chat need this.' }).then((r) => r.response === 0)
    permits.set(key, answer.then((allow) => rpc.request('site.permit', { key, permission: 'contacts', allow })).finally(() => permits.delete(key)))
  }
  return permits.get(key)
}

async function bridge (wc, msg) {
  let key = viewOf.get(wc.id)
  let sub = msg.sub ?? null
  let instance = msg.instance ?? null // one of the app's instances (spec 009): the engine checks it is
  if (!GUARDS && sites.has(sub)) { key = sub; sub = null } // control run: trusts a key from the page
  if (!GUARDS && sites.has(instance)) { key = instance; instance = null }
  if (msg.op === 'off') return rpc.request('site.off', { id: msg.id })
  const method = { call: 'site.call', live: 'site.live', on: 'site.on' }[msg.op]
  if (!method) throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  // only the fields of that call; the key is the view's
  const params = { key, sub, instance, method: msg.method, args: msg.args, chain: msg.chain, opts: msg.opts, event: msg.event }
  let result
  try {
    result = await rpc.request(method, params)
  } catch (err) {
    if (err.code !== 'NEEDS_CONSENT' && err.code !== 'NEEDS_PERMISSION') throw err
    await (err.code === 'NEEDS_CONSENT' ? ask(key) : askPermit(key))
    result = await rpc.request(method, params).catch(async (err) => { // the identity first, then the contacts
      if (err.code !== 'NEEDS_PERMISSION') throw err
      await askPermit(key)
      return rpc.request(method, params)
    })
  }
  if (msg.op === 'live' || msg.op === 'on') {
    subscribers.set(result.id, wc)
    for (const data of early.get(result.id) || []) wc.send('hyper-event', { id: result.id, data })
    early.delete(result.id)
  }
  return result
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

async function openSite (key, query = '') {
  const { manifest, dynamic, key: real, instance = null } = await rpc.request('site.open', { key })
  sites.set(real, { manifest, dynamic })
  if (instance) query = '?instance=' + instance // an app's instance (spec 009): the app's pages, told which one
  const v = createSiteView(real, { dynamic, serve, guards: GUARDS, persist: !SELFTEST, query })
  viewOf.set(v.webContents.id, real)
  v.webContents.on('destroyed', () => {
    for (const [id, wc] of subscribers) if (wc === v.webContents) { subscribers.delete(id); rpc.request('site.off', { id }).catch(() => {}) }
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
  for (const [name, manifest] of [['a', { title: 'Site A', permissions: ['space'] }], ['b', { title: 'Site B', permissions: ['space'] }], ['c', { title: 'Static C' }]]) {
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
  for (const r of out) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.site + '  ' + r.name)
  const ok = out.every((r) => r.pass)
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL')
  for (const v of views) v.close()
  win.destroy() // with views still open, app.exit() leaves the process running (Windows, Electron 42)
  await shutdown()
  for (const d of [tmp, dir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  app.exit(ok ? 0 : 1)
}

// The frame check: the demo site in a frame of its own, then where everything is.
async function framecheck (dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-framecheck-'))
  fs.cpSync(path.join(HERE, '..', 'sites', 'demo'), path.join(tmp, 'site'), { recursive: true })
  const { key } = await rpc.request('site.publish', { folder: path.join(tmp, 'site') })
  const { win, inspect } = startFrame({ rpc, openSite, readIcon, identity: null, file: path.join(tmp, 'shell.json'), open: key })
  const timeout = setTimeout(() => { console.log('FRAMECHECK TIMEOUT'); app.exit(2) }, 60000)
  const until = async (f) => { for (let n = 0; n < 100; n++) { if (await f().catch(() => false)) return true; await new Promise((resolve) => setTimeout(resolve, 100)) } return false }
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
  await i.fwc.executeJavaScript("document.getElementById('hb').click(); document.getElementById('m-devices').click()")
  const listed = await until(() => i.fwc.executeJavaScript("document.querySelectorAll('#dv-list li').length === 1 && document.querySelector('#dv-list li').textContent.includes('(this computer)')"))
  await i.fwc.executeJavaScript("document.getElementById('dv-add').click()")
  const coded = await until(() => i.fwc.executeJavaScript("(document.querySelector('#dv-out .code')?.textContent.length || 0) > 20"))
  if (process.env.HB_SHOT) fs.writeFileSync(process.env.HB_SHOT, (await i.fwc.capturePage()).toPNG())
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
    ['Devices: Add a device shows a code', coded]
  ]
  for (const [name, pass] of out) console.log((pass ? 'PASS ' : 'FAIL ') + 'frame  ' + name)
  const ok = out.every(([, pass]) => pass)
  console.log(ok ? 'FRAMECHECK PASS' : 'FRAMECHECK FAIL')
  win.destroy()
  await shutdown()
  for (const d of [tmp, dir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  app.exit(ok ? 0 : 1)
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
    await fwc.executeJavaScript("document.querySelector('[data-tray=\"off\"]').click()")
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
  const up = await rpc.request('init', { dir, heartbeat: HEARTBEAT, deviceName: os.hostname(), bundle: path.join(HERE, '..', 'apps'), ...more })
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
  const { identity } = await startEngine(dir)
  setInterval(() => rpc && rpc.request('ping').catch(() => {}), HEARTBEAT / 2)
  log('engine up, identity ' + identity)
  if (SELFTEST) return selftest(dir)
  if (FRAMECHECK) return framecheck(dir)
  if (!TRAYCHECK) startUpdates()
  // the frame and the tray reach whichever engine is up (a join starts another, spec 012)
  const engine = { request: (method, params) => rpc ? rpc.request(method, params) : Promise.reject(Object.assign(new Error('engine stopped'), { code: 'CLOSED' })) }
  ui = startFrame({ rpc: engine, openSite, readIcon, identity, file: path.join(app.getPath('userData'), 'shell.json'), open: arg('--open'), update: () => update, restart, join: (code) => join(dir, code).catch((err) => { log('join: ' + err.message); app.exit(1) }) })
  if (TRAYCHECK) traycheck(ui, TRAYCHECK)
}).catch((err) => { console.error(err); app.exit(1) })

app.on('window-all-closed', async () => {
  if (SELFTEST || FRAMECHECK) return // the checks exit with their own code
  await shutdown()
  app.quit()
})
