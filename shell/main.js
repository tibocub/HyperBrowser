// The shell: runs the engine as a Bare worker (pear-runtime), keeps it alive with heartbeats, serves
// hyper://<key>/ from the engine, and shows each site in its own sandboxed view inside the frame
// (frame.js, spec 002). Only this file bridges a site to the engine, and it names the site from the view.
//   npm start [-- --open <key>] [-- --dir <engine folder>]
//   npm run selftest [-- --no-guards]      (the sandbox self-test; --no-guards is its control run: must fail)
import { app, BaseWindow, ipcMain, protocol, dialog } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import PearRuntime from 'pear-runtime'
import { connect } from '../engine/protocol.js'
import { createSiteView } from './views.js'
import { startFrame } from './frame.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELFTEST = process.argv.includes('--selftest')
const GUARDS = !process.argv.includes('--no-guards')
const HEARTBEAT = 2000
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1] }

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript',
  css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', wasm: 'application/wasm'
}
const typeOf = (p) => TYPES[p.split('.').pop().toLowerCase()] || 'application/octet-stream'

protocol.registerSchemesAsPrivileged([{ scheme: 'hyper', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let rpc = null
let worker = null
let quitting = false
const sites = new Map() // key -> { manifest, dynamic }
const viewOf = new Map() // webContents id -> site key
const subscribers = new Map() // engine subscription id -> webContents
const early = new Map() // engine subscription id -> events that came before its reply
const asking = new Map() // key -> the identity question in progress
const asked = [] // keys the question was asked for (the self-test checks: once per site)

async function serve (key, p) {
  const { bytes, path: real } = await rpc.request('site.read', { key, path: p })
  return { bytes, type: typeOf(real) }
}

function onEvent (event, data) {
  if (event === 'closing') {
    if (!quitting) { console.error('engine stopped:', data.reason); app.exit(1) }
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

async function bridge (wc, msg) {
  let key = viewOf.get(wc.id)
  let sub = msg.sub ?? null
  if (!GUARDS && sites.has(sub)) { key = sub; sub = null } // control run: trusts a key from the page
  if (msg.op === 'off') return rpc.request('site.off', { id: msg.id })
  const method = { call: 'site.call', live: 'site.live', on: 'site.on' }[msg.op]
  if (!method) throw Object.assign(new Error('unknown call'), { code: 'UNKNOWN_METHOD' })
  // only the fields of that call; the key is the view's
  const params = { key, sub, method: msg.method, args: msg.args, chain: msg.chain, opts: msg.opts, event: msg.event }
  let result
  try {
    result = await rpc.request(method, params)
  } catch (err) {
    if (err.code !== 'NEEDS_CONSENT') throw err
    await ask(key)
    result = await rpc.request(method, params)
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

async function openSite (key, query = '') {
  const { manifest, dynamic, key: real } = await rpc.request('site.open', { key })
  sites.set(real, { manifest, dynamic })
  const v = createSiteView(real, { dynamic, serve, guards: GUARDS, persist: !SELFTEST, query })
  viewOf.set(v.webContents.id, real)
  v.webContents.on('destroyed', () => {
    for (const [id, wc] of subscribers) if (wc === v.webContents) { subscribers.delete(id); rpc.request('site.off', { id }).catch(() => {}) }
  })
  return { key: real, manifest, ...v }
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
  if (rpc) await rpc.request('close').catch(() => {})
  if (worker) {
    const exited = new Promise((resolve) => { if (worker._exited) resolve(); else worker.once('exit', resolve) })
    worker.destroy() // kills it if it didn't exit by itself
    await exited
  }
  rpc = worker = null
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
  const views = [await openSite(a, '?other=' + b), await openSite(b, '?other=' + a), await openSite(c, '?other=' + a + '&static=1')]
  const win = new BaseWindow({ width: 1500, height: 800, title: 'HyperBrowser self-test' + (GUARDS ? '' : ' (no guards)') })
  layout(win, views)

  const timeout = setTimeout(() => { console.log('SELFTEST TIMEOUT'); app.exit(2) }, 90000)
  let results
  for (;;) {
    results = await Promise.all(views.map((v) => v.webContents.executeJavaScript('window.__results || null').catch(() => null)))
    if (results.every(Boolean)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  clearTimeout(timeout)
  const out = results.flat()
  out.push({ site: 'shell', name: 'the identity question: asked once per dynamic site, never for the static one', pass: asked.length === 2 && asked.includes(a) && asked.includes(b) })
  for (const r of out) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.site + '  ' + r.name)
  const ok = out.every((r) => r.pass)
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL')
  for (const v of views) v.close()
  win.destroy() // with views still open, app.exit() leaves the process running (Windows, Electron 42)
  await shutdown()
  for (const d of [tmp, dir]) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  app.exit(ok ? 0 : 1)
}

app.whenReady().then(async () => {
  worker = PearRuntime.run(fileURLToPath(new URL('../engine/worker.js', import.meta.url)))
  worker.stderr.on('data', (d) => process.stderr.write('engine: ' + d))
  rpc = connect(worker, { onEvent })
  const dir = arg('--dir') || path.join(app.getPath('userData'), SELFTEST ? 'selftest-' + process.pid : 'engine')
  const { identity } = await rpc.request('init', { dir, heartbeat: HEARTBEAT })
  setInterval(() => rpc && rpc.request('ping').catch(() => {}), HEARTBEAT / 2)
  console.log('engine up, identity', identity)
  if (SELFTEST) return selftest(dir)
  startFrame({ rpc, openSite, readIcon, identity, file: path.join(app.getPath('userData'), 'shell.json'), open: arg('--open') })
}).catch((err) => { console.error(err); app.exit(1) })

app.on('window-all-closed', async () => {
  if (SELFTEST) return // the self-test exits with its own code
  await shutdown()
  app.quit()
})
