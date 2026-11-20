// Each dithered background must be a clean checkerboard of whole device pixels and must not move on scroll.
// Run with --force-device-scale-factor=1.25 (or 1, 1.5…); used by test/sandbox.electron.js.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
/** @param {string} p */
const css = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8')
const TALL = '<div style="height:3000px"></div>'
const AREA = { x: 40, y: 120, width: 40, height: 40 }
/** @type {Array<[string, string, string | null, import('electron').Rectangle]>} */
const PAGES = [
  ['the shell desktop', `<style>${css('shell/ui/ui.css')}</style><main id="desktop">${TALL}</main>`, null, AREA],
  ['sites/home', `<style>${css('sites/home/style.css')}</style>${TALL}`, null, AREA],
  ['sites/forum', `<style>${css('sites/forum/style.css')}</style>${TALL}`, null, AREA],
  // the page is a window 16 px from the edges at this width: look left of it
  ['the default theme', `<h1>Plain</h1>${TALL}`, css('shell/ui/theme.css'), { x: 0, y: 120, width: 12, height: 40 }]
]

// cell: a dither dot in device pixels (1 up to 199 %, 2 from 200 %: still one CSS pixel there)
/** @param {import('electron').BrowserWindow} w @param {import('electron').Rectangle} area @param {number} cell */
async function grab (w, area, cell) {
  const img = await w.webContents.capturePage(area)
  const { width, height } = img.getSize()
  const px = img.toBitmap()
  let bad = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = px[(y * width + x) * 4]
      const want = px[0] ^ ((Math.floor(x / cell) + Math.floor(y / cell)) & 1 ? 255 : 0)
      if (Math.abs(v - want) > 8) bad++
    }
  }
  return { bad, bytes: px }
}

app.whenReady().then(async () => {
  let ok = true
  const w = new BrowserWindow({ width: 400, height: 300, show: false, useContentSize: true })
  for (const [name, html, user, area] of PAGES) {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html>' + html))
    if (user) await w.webContents.insertCSS(user, { cssOrigin: 'user' })
    const frame = () => w.webContents.executeJavaScript('new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 150))')
    await frame()
    const dpr = await w.webContents.executeJavaScript('devicePixelRatio')
    const before = await grab(w, area, Math.floor(dpr))
    await w.webContents.executeJavaScript("(document.getElementById('desktop') || document.scrollingElement).scrollTop = 7")
    await frame()
    const after = await grab(w, area, Math.floor(dpr))
    for (const [label, pass] of /** @type {Array<[string, boolean]>} */ ([
      [`${name} at ${dpr * 100} %: whole device pixels, no gray`, before.bad === 0],
      [`${name} at ${dpr * 100} %: still after scrolling 7 px`, after.bytes.equals(before.bytes)]
    ])) {
      console.log((pass ? 'PASS ' : 'FAIL ') + 'pixels  ' + label)
      ok = ok && pass
    }
  }
  console.log(ok ? 'PIXELS PASS' : 'PIXELS FAIL')
  app.exit(ok ? 0 : 1)
}).catch((err) => { console.error(err); app.exit(1) })
