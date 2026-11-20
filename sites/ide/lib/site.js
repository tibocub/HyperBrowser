import { parse, renderPage, applyLayout, siteMenu, pageHref, parseManifest, pageTitle, utf8 } from '../vendor/hmd.js'

/**
 * @typedef {Hyper.Site['projects']} Projects
 * @typedef {{ label: string, files: (title: string) => Record<string, string> }} Template
 */

/** @param {unknown} o */
const json = (o) => JSON.stringify(o, null, 2) + '\n'
/** @param {Uint8Array} bytes */
const text = (bytes) => utf8(bytes)

/** @type {Record<string, Template>} */
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

/** @param {unknown} s */
function escape (s) {
  return String(s).replace(/[&<>"]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/** @param {string} p */
const isPage = (p) => p.endsWith('.hmd') && !/** @type {string} */ (p.split('/').pop()).startsWith('_')
/** @param {string[]} paths */
export const isHyperMD = (paths) => paths.some(isPage)
/** @param {string} p */
const htmlOf = (p) => p.replace(/\.hmd$/, '.html')

/**
 * The HTML pages of a HyperMD site: each page in _layout.hmd, the menu made from them all.
 * @param {Record<string, string>} sources path -> its .hmd text
 * @param {string[]} [css] the stylesheets every page links to
 * @returns {Record<string, string>} path -> html
 */
export function buildPages (sources, css = []) {
  const entries = Object.keys(sources).filter(isPage).sort().map((p) => ({ path: p, doc: parse(sources[p]) }))
  const layout = sources['_layout.hmd'] !== undefined ? parse(sources['_layout.hmd']) : null
  const menu = siteMenu(entries)
  /** @type {Record<string, string>} */
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

/** @param {Projects} projects @param {string} name */
export async function create (projects, name, template = 'hypermd') {
  const t = TEMPLATES[template]
  if (!t) throw Object.assign(new Error('no template ' + template), { code: 'INVALID_PARAMS' })
  const p = await projects.create(name)
  for (const [path, body] of Object.entries(t.files(name))) await projects.write(p.key, path, body)
  if (template === 'hypermd') await build(projects, p.key)
  return p
}

/** @param {Projects} projects @param {string} key */
export const paths = async (projects, key) => (await projects.files(key)).map((f) => f.path)
/** @param {Projects} projects @param {string} key @param {string} path */
export const read = async (projects, key, path) => text(await projects.read(key, path))

/**
 * An .html the IDE once wrote beside its .hmd (exactly what the build makes) is removed;
 * any other .html of a page's name is the person's and wins over the built one.
 * @param {Projects} projects
 * @param {string} key
 * @returns {Promise<{ built: string[], hidden: string[] }>}
 */
export async function build (projects, key) {
  const all = await paths(projects, key)
  if (!isHyperMD(all)) return { built: [], hidden: [] }
  /** @type {Record<string, string>} */
  const sources = {}
  for (const p of all) if (p.endsWith('.hmd')) sources[p] = await read(projects, key, p)
  const css = all.filter((p) => !p.includes('/') && p.endsWith('.css')).sort()
  const pages = buildPages(sources, css)
  await projects.build(key, pages)
  /** @type {string[]} */
  const hidden = []
  for (const [p, html] of Object.entries(pages)) {
    if (!all.includes(p)) continue
    if ((await read(projects, key, p)) === html) await projects.remove(key, p) // ours, from an older IDE: never the person's
    else hidden.push(p)
  }
  return { built: Object.keys(pages), hidden }
}

/** @param {Projects} projects @param {string} key @param {string} path @param {string | Uint8Array} body */
export async function save (projects, key, path, body) {
  await projects.write(key, path, body)
  return /\.hmd$/.test(path) || (!path.includes('/') && path.endsWith('.css')) ? build(projects, key) : null
}

/** @param {Projects} projects @param {string} key */
export async function pages (projects, key) {
  /** @type {Array<{ path: string, doc: import('hypermd').HyperDocument }>} */
  const list = []
  for (const p of (await paths(projects, key)).filter(isPage)) list.push({ path: p, doc: parse(await read(projects, key, p)) })
  return siteMenu(list).map((m) => ({ path: m.path, title: m.title }))
}

/** @param {Projects} projects @param {string} key @param {string} title */
export async function addPage (projects, key, title) {
  const have = new Set(await paths(projects, key))
  const base = (title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page').slice(0, 40)
  let path = base + '.hmd'
  for (let n = 2; have.has(path) || have.has(path.replace(/\.hmd$/, '.html')); n++) path = `${base}-${n}.hmd`
  const order = (await pages(projects, key)).length + 1
  await save(projects, key, path, `::page{order=${order}}\n\n# ${title}\n\n`)
  return path
}

/** @param {Projects} projects @param {string} key @returns {Promise<Record<string, unknown>>} site.json as written, unchecked */
export async function manifest (projects, key) {
  try { return JSON.parse(await read(projects, key, 'site.json')) } catch { return {} }
}

/** @param {Projects} projects @param {string} key @param {Record<string, unknown>} change null removes a field */
export async function setManifest (projects, key, change) {
  const m = { ...await manifest(projects, key) }
  for (const [k, v] of Object.entries(change)) {
    if (v === null) delete m[k]
    else m[k] = v
  }
  return writeManifest(projects, key, json(m))
}

/** @param {Projects} projects @param {string} key @param {string} raw */
export async function writeManifest (projects, key, raw) {
  const checked = parseManifest(raw)
  const all = new Set(await paths(projects, key))
  for (const p of /** @type {string[]} */ ([checked.entry, checked.icon].filter(Boolean))) {
    const made = checked.entry === p && isPage(p.replace(/\.html$/, '.hmd')) && all.has(p.replace(/\.html$/, '.hmd'))
    if (!all.has(p) && !made) throw Object.assign(new Error(`site.json names ${p}, which isn't in the project`), { code: 'INVALID_MANIFEST' })
  }
  await projects.write(key, 'site.json', raw)
  return checked
}

/** @param {Projects} projects @param {string} key @param {string} name @param {Uint8Array} bytes */
export async function setIcon (projects, key, name, bytes) {
  const ext = (name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  for (const p of await paths(projects, key)) if (/^icon\.[a-z0-9]+$/.test(p) && p !== 'icon.' + ext) await projects.remove(key, p)
  await projects.write(key, 'icon.' + ext, bytes)
  return setManifest(projects, key, { icon: 'icon.' + ext })
}

/** @param {Projects} projects @param {string} key @param {string} name @param {Uint8Array} bytes */
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

// Every HyperMD page is built first, so site.json's entry (index.html) is there.
/** @param {Projects} projects @param {string} key */
export async function preview (projects, key, reset = false) {
  const { hidden } = await build(projects, key)
  return { ...(reset ? await projects.resetPreview(key) : await projects.preview(key)), hidden }
}

/** @param {Projects} projects @param {string} key */
export async function publish (projects, key) {
  const { hidden } = await build(projects, key)
  return { ...(await projects.publish(key)), hidden }
}

export { pageTitle, parse }
