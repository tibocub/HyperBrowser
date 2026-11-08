// The one interface a site's view sits behind (desktop: an Electron WebContentsView; mobile later: a native
// WebView with the same rules). Each site: its own session (cookies, storage, cache), hyper://<its key>/
// only, nothing else loads, no pop-ups, no navigation away, no device permissions. A static site gets no
// preload, so no API at all. `guards: false` is the self-test's control run only.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebContentsView, session } from 'electron'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRELOAD = path.join(HERE, 'site-preload.cjs')
// wasm-unsafe-eval: WebAssembly compiles (spec 008); it runs in the same sandbox as the page's JS
const CSP = "default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:"
// the default theme (spec 008, ui/theme.css), its fonts inlined: a site's CSP loads data: but not the shell's files
const THEME = fs.readFileSync(path.join(HERE, 'ui', 'theme.css'), 'utf-8')
  .replace(/url\(fonts\/([\w.-]+)\)/g, (m, f) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(HERE, 'ui', 'fonts', f)).toString('base64') + ')')

// serve(key, path) → { bytes, type } or throws with a code; returns { view, webContents, close }.
export function createSiteView (key, { dynamic, serve, guards = true, persist = true, query = '' }) {
  const ses = session.fromPartition((persist ? 'persist:' : '') + 'site-' + key)
  const origin = 'hyper://' + key + '/'
  if (ses.protocol.isProtocolHandled('hyper')) ses.protocol.unhandle('hyper') // the site opened again
  ses.protocol.handle('hyper', async (req) => {
    const url = new URL(req.url)
    if (guards && url.host !== key) return new Response('not this site', { status: 404 })
    try {
      const { bytes, type } = await serve(guards ? key : url.host, decodeURIComponent(url.pathname))
      const headers = { 'content-type': type }
      if (guards) headers['content-security-policy'] = CSP
      return new Response(bytes, { headers })
    } catch (err) {
      const status = err.code === 'NOT_FOUND' || err.code === 'INVALID_KEY' ? 404 : err.code === 'NOT_AVAILABLE' ? 503 : 500
      return new Response(err.code || 'error', { status })
    }
  })
  if (guards) ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(origin) && !d.url.startsWith('devtools:') }))
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
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) e.preventDefault() })
  // as a user stylesheet: the page's own CSS always wins (and theme.css applies only to pages without any)
  wc.on('dom-ready', () => wc.insertCSS(THEME, { cssOrigin: 'user' }).catch(() => {}))
  wc.loadURL(origin + query)
  return { view, webContents: wc, close: () => wc.close() }
}
