// A site view must reach nothing but hyper://. Every probe aims at a local listener, or at a name under NAME (seen in
// the net log if Chromium tries to resolve it), and any contact is a leak. --no-guards: the control, where they reach.
// Used by test/sandbox.electron.js.
import { app, BaseWindow, netLog, protocol, session } from 'electron'
import net from 'net'
import dgram from 'dgram'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createSiteView, resolveNoNames } from '../views.js'

const GUARDS = !process.argv.includes('--no-guards')
const KEY = 'leakprobe'
const NAME = 'leakprobe.test'
/** @type {Map<string, number>} */
const contacts = new Map()
/** @param {string} what */
const saw = (what) => contacts.set(what, (contacts.get(what) || 0) + 1)

/** @param {string} label @returns {Promise<number>} each connection, named by its HTTP path when it sends one */
const tcp = (label) => new Promise((resolve) => {
  const server = net.createServer((s) => {
    let named = false
    s.on('data', (d) => {
      const m = !named && /^[A-Z]+ \/([\w-]+)/.exec(d.toString('latin1'))
      named = true
      saw(m ? m[1] : label)
      s.destroy()
    })
    s.on('error', () => {})
    s.on('close', () => { if (!named) saw(label) })
  })
  server.listen(0, '127.0.0.1', () => resolve(/** @type {net.AddressInfo} */ (server.address()).port))
})
/** @param {string} label @returns {Promise<number>} each datagram */
const udp = (label) => new Promise((resolve) => {
  const s = dgram.createSocket('udp4')
  s.on('message', () => saw(label))
  s.bind(0, '127.0.0.1', () => resolve(s.address().port))
})

/** @param {Record<string, number>} p */
const page = (p) => {
  const http = 'http://127.0.0.1:' + p.http + '/'
  return `<!doctype html><html><head>
<link rel="dns-prefetch" href="//dns-prefetch.${NAME}">
<link rel="preconnect" href="http://127.0.0.1:${p.preconnect}/">
<link rel="preconnect" href="http://preconnect.${NAME}/">
<link rel="prefetch" href="${http}prefetch">
<link rel="prerender" href="${http}prerender">
<link rel="preload" as="image" href="${http}preload">
<link rel="icon" href="${http}favicon">
<link rel="stylesheet" href="${http}stylesheet">
<script type="speculationrules">{"prerender":[{"source":"list","urls":["${http}speculation-prerender"]}],"prefetch":[{"source":"list","urls":["${http}speculation-prefetch"]}]}</script>
<style>@import url(${http}css-import); body { background: url(${http}css-url) } @font-face { font-family: p; src: url(${http}font) } p { font-family: p }</style>
</head><body>
<p>probe</p>
<img src="${http}img"><video src="${http}video"></video><audio src="${http}audio"></audio><object data="${http}object"></object>
<a id="ping" href="#x" ping="${http}ping">ping</a>
<a href="http://anchor.${NAME}/">anchor</a>
<iframe src="${http}iframe"></iframe>
<iframe srcdoc="<meta http-equiv=refresh content='0;url=${http}meta-refresh'>"></iframe>
<iframe src="data:text/html,<script>fetch('${http}data-iframe-fetch')</script>"></iframe>
<form id="form" action="${http}form" method="post" target="sink"><input name="a" value="b"></form><iframe name="sink"></iframe>
<textarea spellcheck="true">helo wrold speling</textarea>
<script>
const r = { candidates: [] }
const t = (f) => { try { f() } catch {} }
t(() => fetch('${http}fetch').catch(() => {}))
t(() => { const x = new XMLHttpRequest(); x.open('GET', '${http}xhr'); x.send() })
t(() => navigator.sendBeacon('${http}beacon', 'x'))
t(() => new WebSocket('ws://127.0.0.1:${p.http}/websocket'))
t(() => new EventSource('${http}eventsource'))
t(() => new WebTransport('https://127.0.0.1:${p.webtransport}/'))
t(() => new Worker(URL.createObjectURL(new Blob(["fetch('${http}worker-fetch')"]))))
t(() => document.getElementById('ping').click())
t(() => document.getElementById('form').submit())
t(() => window.open('${http}window-open'))
t(() => navigator.geolocation.getCurrentPosition(() => {}, () => {}))
;(async () => {
  const pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:127.0.0.1:${p.stun}' }, { urls: 'stun:stun.${NAME}:3478' },
    { urls: 'turn:127.0.0.1:${p.turn}?transport=tcp', username: 'u', credential: 'c' },
    { urls: 'turn:turn.${NAME}:3478?transport=tcp', username: 'u', credential: 'c' }
  ] })
  pc.onicecandidate = (e) => { if (e.candidate) r.candidates.push(e.candidate.candidate) }
  pc.createDataChannel('x')
  await pc.setLocalDescription(await pc.createOffer())
})().catch((e) => { r.rtc = String(e) })
window.__probe = r
</script></body></html>`
}

protocol.registerSchemesAsPrivileged([{ scheme: 'hyper', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
if (GUARDS) resolveNoNames()

app.whenReady().then(async () => {
  /** @type {Record<string, number>} */
  const ports = {}
  for (const name of ['http', 'preconnect', 'turn', 'dns']) ports[name] = await tcp(name)
  for (const name of ['stun', 'webtransport']) ports[name] = await udp(name)
  // names go to a dead local DNS (DoH): the control run's lookups never leave this machine; the log names them
  app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: ['https://127.0.0.1:' + ports.dns + '/dns-query'] })
  const dir = fs.mkdtempSync(path.join(process.env.HG_TEST_TMP || os.tmpdir(), 'hb-leaks-'))
  const log = path.join(dir, 'net.json')
  await netLog.startLogging(log)

  const ses = session.fromPartition('site-' + KEY)
  // shortcut: only hunspell (Linux) downloads; Windows and macOS spellcheck with the OS, so there the check is the switch
  ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:' + ports.http + '/spellcheck/')
  const html = new TextEncoder().encode(page(ports))
  const site = createSiteView(KEY, { dynamic: false, persist: false, guards: GUARDS, serve: async () => ({ bytes: html, type: 'text/html; charset=utf-8' }) })
  const win = new BaseWindow({ width: 800, height: 600, show: false })
  win.contentView.addChildView(site.view)
  site.view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  await new Promise((resolve) => setTimeout(resolve, 6000)) // ICE gathering, DNS, prerender: nothing to await from here
  const probe = await site.webContents.executeJavaScript('window.__probe').catch(() => null)
  await netLog.stopLogging()

  contacts.delete('dns') // the DoH stub's own connections: Chromium probes it; the names below are the lookups
  const logged = fs.readFileSync(log, 'utf-8')
  for (const n of new Set(logged.match(/[\w.-]*leakprobe\.test/g))) saw('lookup ' + n)
  if (/"host":"wpad[:"]/.test(logged)) saw('lookup wpad')
  if (ses.isSpellCheckerEnabled()) saw('spellchecker on')
  // a .local candidate hides the address (mDNS); any other shows one to the page
  const shown = (probe?.candidates || []).filter((/** @type {string} */ c) => !/ [\w-]+\.local /.test(c))
  if (shown.length) saw('ICE candidates with an address')
  if (!probe) saw('the probe page did not run')
  for (const [what, n] of [...contacts].sort()) console.log('CONTACT ' + what + ' ' + n)
  console.log(contacts.size ? 'LEAKS ' + contacts.size : 'LEAKS NONE')
  fs.rmSync(dir, { recursive: true, force: true })
  app.exit(0)
}).catch((err) => { console.error(err); app.exit(1) })
