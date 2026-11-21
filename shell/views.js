// A static site gets no preload, so no API at all. `guards: false` is the self-test's control run only.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { app, WebContentsView, session } from 'electron'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRELOAD = path.join(HERE, 'site-preload.cjs')
// wasm-unsafe-eval: WebAssembly compiles; it runs in the same sandbox as the page's JS
const CSP = "default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:"
// the default theme (ui/theme.css), its fonts inlined: a site's CSP loads data: but not the shell's files
const THEME = fs.readFileSync(path.join(HERE, 'ui', 'theme.css'), 'utf-8')
  .replace(/url\(fonts\/([\w.-]+)\)/g, (m, f) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(HERE, 'ui', 'fonts', f)).toString('base64') + ')')

/**
 * Before the app is ready: Chromium resolves no name, ever. HyperBrowser needs none (the engine has its own
 * network), and DNS prefetch, WebRTC's STUN and TURN names and proxy auto-detection resolve outside webRequest.
 */
export const resolveNoNames = () => app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND')

/**
 * A site's view: its own session, the hyper: protocol answering for this site only.
 * @param {string} key
 * @param {object} opts
 * @param {boolean} opts.dynamic it gets the site API (the preload)
 * @param {(key: string, path: string) => Promise<{ bytes: Uint8Array, type: string }>} opts.serve
 * @param {boolean} [opts.guards]
 * @param {boolean} [opts.persist]
 * @param {string} [opts.query]
 */
export function createSiteView (key, { dynamic, serve, guards = true, persist = true, query = '' }) {
  const ses = session.fromPartition((persist ? 'persist:' : '') + 'site-' + key)
  const origin = 'hyper://' + key + '/'
  if (ses.protocol.isProtocolHandled('hyper')) ses.protocol.unhandle('hyper')
  ses.protocol.handle('hyper', async (req) => {
    const url = new URL(req.url)
    if (guards && url.host !== key) return new Response('not this site', { status: 404 })
    try {
      const { bytes, type } = await serve(guards ? key : url.host, decodeURIComponent(url.pathname))
      /** @type {Record<string, string>} */
      const headers = { 'content-type': type }
      if (guards) headers['content-security-policy'] = CSP
      return new Response(/** @type {Uint8Array<ArrayBuffer>} */ (bytes), { headers })
    } catch (e) {
      const err = /** @type {{ code?: string }} */ (e)
      const status = err.code === 'NOT_FOUND' || err.code === 'INVALID_KEY' ? 404 : err.code === 'NOT_AVAILABLE' ? 503 : 500
      return new Response(err.code || 'error', { status })
    }
  })
  if (guards) ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(origin) && !d.url.startsWith('devtools:') }))
  // hunspell (Linux) downloads its dictionaries from Google
  if (guards) ses.setSpellCheckerEnabled(false)
  // a proxy nobody listens on, for WebRTC's TCP (below); <-loopback>: Chromium never proxies 127.0.0.1 otherwise
  const proxied = guards ? ses.setProxy({ proxyRules: 'http://127.0.0.1:1', proxyBypassRules: '<-loopback>' }) : Promise.resolve()
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)

  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload: dynamic ? PRELOAD : undefined,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  const wc = view.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  // WebRTC's STUN and TURN sockets bypass webRequest: no UDP, and TCP only through the proxy
  if (guards) wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) e.preventDefault() })
  // as a user stylesheet: the page's own CSS always wins (and theme.css applies only to pages without any)
  wc.on('dom-ready', () => wc.insertCSS(THEME, { cssOrigin: 'user' }).catch(() => {}))
  proxied.then(() => wc.loadURL(origin + query))
  return { view, webContents: wc, close: () => wc.close() }
}
