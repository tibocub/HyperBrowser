// A static site gets no preload, so no API at all. `guards: false` is the self-test's control run only.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebContentsView, session } from 'electron'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PRELOAD = path.join(HERE, 'site-preload.cjs')
// wasm-unsafe-eval: WebAssembly compiles; it runs in the same sandbox as the page's JS
const CSP = "default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:"
// the default theme (ui/theme.css), its fonts inlined: a site's CSP loads data: but not the shell's files
const THEME = fs.readFileSync(path.join(HERE, 'ui', 'theme.css'), 'utf-8')
  .replace(/url\(fonts\/([\w.-]+)\)/g, (m, f) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(HERE, 'ui', 'fonts', f)).toString('base64') + ')')

export function createSiteView (key, { dynamic, serve, guards = true, persist = true, query = '' }) {
  const ses = session.fromPartition((persist ? 'persist:' : '') + 'site-' + key)
  const origin = 'hyper://' + key + '/'
  if (ses.protocol.isProtocolHandled('hyper')) ses.protocol.unhandle('hyper')
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
