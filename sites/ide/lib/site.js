// The IDE's work on a project, with no page around it (spec 025): templates, HyperMD built here (D4), pages by title for
// beginners, site.json changed and checked as the engine checks it (D7), Publish. `projects` is window.hyper.projects
// (or the tests' copy of it). The page (app.js) only draws and calls these.
import { parse, renderPage, applyLayout, siteMenu, pageHref, parseManifest, pageTitle, utf8 } from '../vendor/hmd.js'

const json = (o) => JSON.stringify(o, null, 2) + '\n'
const text = (bytes) => utf8(bytes)

export const TEMPLATES = {
  hypermd: {
    label: 'A site with pages',
    files: (title) => ({
      'site.json': json({ title, entry: 'index.html' }),
      '_layout.hmd': '::menu\n\n::content\n',
      'index.hmd': `::page{order=1}\n\n# ${title}\n\nWrite your first page here.\n`
    })
  },
  static: {
    label: 'A blank site (HTML)',
    files: (title) => ({
      'site.json': json({ title, entry: 'index.html' }),
      'index.html': `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<title>${escape(title)}</title>\n<h1>${escape(title)}</h1>\n<p>Hello.</p>\n</html>\n`
    })
  },
  app: {
    label: 'An app with its own space (JavaScript)',
    files: (title) => ({
      'site.json': json({ title, entry: 'index.html', permissions: ['space'], types: { note: { fields: { text: 'text' } } } }),
      'index.html': `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<title>${escape(title)}</title>\n<h1>${escape(title)}</h1>\n<form id="add"><input name="text" aria-label="A note" required> <button>Add</button></form>\n<ul id="notes"></ul>\n<script type="module" src="app.js"></script>\n</html>\n`,
      'app.js': `// Notes in this app's own space (window.hyper: docs/site-api.md).
const list = document.getElementById('notes')
window.hyper.query('note').live(({ items }) => {
  list.replaceChildren(...items.map((n) => Object.assign(document.createElement('li'), { textContent: n.text })))
})
document.getElementById('add').onsubmit = async (e) => {
  e.preventDefault()
  await window.hyper.put('note', { text: e.target.text.value })
  e.target.reset()
}
`
    })
  }
}

function escape (s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

// --- HyperMD (as `hypermd build`, in the page): every page .hmd → .html beside it, the root's .css on every page,
// `_layout.hmd` around each, its ::menu listing the pages ---

const isPage = (p) => p.endsWith('.hmd') && !p.split('/').pop().startsWith('_')
export const isHyperMD = (paths) => paths.some(isPage)
const htmlOf = (p) => p.replace(/\.hmd$/, '.html')

// sources: { path: text } of the project's .hmd files; css: the root's .css paths → { path.html: html }
export function buildPages (sources, css = []) {
  const entries = Object.keys(sources).filter(isPage).sort().map((p) => ({ path: p, doc: parse(sources[p]) }))
  const layout = sources['_layout.hmd'] !== undefined ? parse(sources['_layout.hmd']) : null
  const menu = siteMenu(entries)
  const out = {}
  for (const { path: rel, doc } of entries) {
    const up = '../'.repeat(rel.split('/').length - 1)
    const full = layout ? applyLayout(layout, doc, { menu, current: rel }) : doc
    out[htmlOf(rel)] = renderPage(full, {
      styles: css.map((c) => up + c),
      scripts: full.scripts.filter((s) => s.props.src).map((s) => pageHref(String(s.props.src), up)),
      href: (url) => pageHref(url, up)
    })
  }
  return out
}

// --- a project, through hyper.projects ---

export async function create (projects, name, template = 'hypermd') {
  const t = TEMPLATES[template]
  if (!t) throw Object.assign(new Error('no template ' + template), { code: 'INVALID_PARAMS' })
  const p = await projects.create(name)
  for (const [path, body] of Object.entries(t.files(name))) await projects.write(p.key, path, body)
  if (template === 'hypermd') await build(projects, p.key)
  return p
}

export const paths = async (projects, key) => (await projects.files(key)).map((f) => f.path)
export const read = async (projects, key, path) => text(await projects.read(key, path))

// The HyperMD pages written again from their sources; → the paths written. Nothing for a project without pages.
export async function build (projects, key) {
  const all = await paths(projects, key)
  if (!isHyperMD(all)) return []
  const sources = {}
  for (const p of all) if (p.endsWith('.hmd')) sources[p] = await read(projects, key, p)
  const css = all.filter((p) => !p.includes('/') && p.endsWith('.css')).sort()
  const pages = buildPages(sources, css)
  for (const [p, html] of Object.entries(pages)) await projects.write(key, p, html)
  return Object.keys(pages)
}

// A file saved; its pages built again when it is HyperMD's or a root stylesheet. → the paths written.
export async function save (projects, key, path, body) {
  await projects.write(key, path, body)
  return /\.hmd$/.test(path) || (!path.includes('/') && path.endsWith('.css')) ? build(projects, key) : []
}

// Beginners' pages: [{ path, title }] in menu order, no file names.
export async function pages (projects, key) {
  const list = []
  for (const p of (await paths(projects, key)).filter(isPage)) list.push({ path: p, doc: parse(await read(projects, key, p)) })
  return siteMenu(list).map((m) => ({ path: m.path, title: m.title }))
}

// A new page titled `title`: its file named after it (never shown), last in the menu. → its path.
export async function addPage (projects, key, title) {
  const have = new Set(await paths(projects, key))
  const base = (title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page').slice(0, 40)
  let path = base + '.hmd'
  for (let n = 2; have.has(path) || have.has(path.replace(/\.hmd$/, '.html')); n++) path = `${base}-${n}.hmd`
  const order = (await pages(projects, key)).length + 1
  await save(projects, key, path, `::page{order=${order}}\n\n# ${title}\n\n`)
  return path
}

// site.json read, or {} when it isn't JSON yet.
export async function manifest (projects, key) {
  try { return JSON.parse(await read(projects, key, 'site.json')) } catch { return {} }
}

// site.json with `change` applied (null removes a field), checked as the engine checks it (INVALID_MANIFEST) before
// it is written. → the checked manifest.
export async function setManifest (projects, key, change) {
  const m = { ...await manifest(projects, key) }
  for (const [k, v] of Object.entries(change)) {
    if (v === null) delete m[k]
    else m[k] = v
  }
  return writeManifest(projects, key, json(m))
}

// site.json's raw text (the developers' view), checked before it is written.
export async function writeManifest (projects, key, raw) {
  const checked = parseManifest(raw)
  const all = new Set(await paths(projects, key))
  for (const p of [checked.entry, checked.icon].filter(Boolean)) {
    const made = checked.entry === p && isPage(p.replace(/\.html$/, '.hmd')) && all.has(p.replace(/\.html$/, '.hmd'))
    if (!all.has(p) && !made) throw Object.assign(new Error(`site.json names ${p}, which isn't in the project`), { code: 'INVALID_MANIFEST' })
  }
  await projects.write(key, 'site.json', raw)
  return checked
}

// A picture as the site's icon: written as icon.<ext>, named in site.json.
export async function setIcon (projects, key, name, bytes) {
  const ext = (name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  for (const p of await paths(projects, key)) if (/^icon\.[a-z0-9]+$/.test(p) && p !== 'icon.' + ext) await projects.remove(key, p)
  await projects.write(key, 'icon.' + ext, bytes)
  return setManifest(projects, key, { icon: 'icon.' + ext })
}

// A picked file added under `folder` with a name free there. → its path.
export async function upload (projects, key, name, bytes, folder = '') {
  const have = new Set(await paths(projects, key))
  const clean = name.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '') || 'file'
  const dot = clean.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, '']
  let path = (folder ? folder + '/' : '') + clean
  for (let n = 2; have.has(path); n++) path = (folder ? folder + '/' : '') + `${stem}-${n}${ext}`
  await projects.write(key, path, bytes)
  return path
}

// The preview (spec 026 B1): every HyperMD page built first, so site.json's entry (index.html) is there. `reset`: a new
// throwaway space.
export async function preview (projects, key, reset = false) {
  await build(projects, key)
  return reset ? projects.resetPreview(key) : projects.preview(key)
}

// Publish: the pages built first, so what is published is what the project says.
export async function publish (projects, key) {
  await build(projects, key)
  return projects.publish(key)
}

export { pageTitle, parse }
