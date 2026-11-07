// The official site (spec 005): sites/home, written in HyperMD, builds to plain HTML where every page, link
// and file resolves; that built folder, published, loads page by page on a second engine.
import test from 'brittle'
import fs from 'fs'
import b4a from 'b4a'
import path from 'path'
import { fileURLToPath } from 'url'
import { build } from 'hypermd/src/build.js'
import { engine, tmpDir, text } from './helpers.js'

const HOME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'home')

// Site-relative paths of every file under dir, with '/'.
function files (dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const child = rel ? rel + '/' + e.name : e.name
    return e.isDirectory() ? files(dir, child) : [child]
  })
}

// A reference from `from` (a site path) to `ref`, as the site path it points at, or null when it leaves the site.
function target (from, ref) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) return null
  const [file] = ref.split(/[?#]/)
  if (!file) return from
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), file))
}

test('sites/home builds: every page, every link and file resolves', async (t) => {
  const out = tmpDir(t, 'home')
  const { pages } = build(HOME, out)
  const sources = files(HOME).filter((f) => f.endsWith('.hmd') && !f.split('/').pop().startsWith('_'))
  t.ok(sources.length >= 4, sources.join(', '))
  for (const s of sources) t.ok(pages.includes(s.replace(/\.hmd$/, '.html')), s + ' is built')

  const built = new Set(files(out))
  const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  let checked = 0
  for (const f of built) {
    const body = fs.readFileSync(path.join(out, f), 'utf-8')
    const refs = f.endsWith('.html')
      ? [...body.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
      : f.endsWith('.css') ? [...body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]) : []
    for (const ref of refs) {
      const to = target(f, ref)
      if (to === null) continue
      checked++
      if (!built.has(to)) { t.fail(`${f}: ${ref} is not in the built site`); continue }
      const hash = ref.split('#')[1]
      if (hash && !ids(fs.readFileSync(path.join(out, to), 'utf-8')).has(decodeURIComponent(hash))) t.fail(`${f}: ${ref}: no such anchor`)
    }
  }
  t.ok(checked > 20, `${checked} links and files checked`)
  t.ok(fs.readFileSync(path.join(out, 'style.css'), 'utf-8').includes('fonts/cozette.woff2'), 'the fonts are bundled')

  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'site.json'), 'utf-8'))
  t.ok(built.has(manifest.entry), 'the entry page is built')
  t.ok(built.has(manifest.icon) && fs.readFileSync(path.join(out, manifest.icon), 'utf-8').startsWith('<svg'), 'the icon is there')
})

test('the built sites/home, published, loads on a second engine', async (t) => {
  const out = tmpDir(t, 'home')
  build(HOME, out)
  const owner = await engine(t)
  const visitor = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: out })

  const opened = await visitor.rpc.request('site.open', { key })
  t.is(opened.manifest.title, 'HyperBrowser')
  t.is(opened.dynamic, false, 'a static site: no API')
  const entry = await visitor.rpc.request('site.read', { key, path: '' })
  t.ok(text(entry.bytes).includes('<title>HyperBrowser</title>'), 'the entry page')
  // every page and file the build wrote, byte for byte (dotfiles aren't part of the site)
  const all = files(out).filter((f) => !f.split('/').some((p) => p.startsWith('.')))
  for (const f of all) {
    const { bytes } = await visitor.rpc.request('site.read', { key, path: f })
    if (!b4a.equals(bytes, fs.readFileSync(path.join(out, f)))) t.fail(f + ' differs')
  }
  t.pass(`${all.length} files read from the visitor`)
})
