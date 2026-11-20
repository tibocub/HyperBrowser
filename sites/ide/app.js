// No stylesheet: the default theme stays because CodeMirror's styles are adopted sheets.
import * as ide from './lib/site.js'
import { fileTree } from './lib/tree.js'

/**
 * @typedef {Hyper.Site['projects']} Projects
 * @typedef {{ path: string, size: number, mtime: number }} File
 * @typedef {{ path: string, folder: true }} Folder
 * @typedef {[string, () => void]} Item a "…" menu's entry
 * @typedef {{ wrap: boolean, tabSize: number, fontSize: number, lineNumbers: boolean }} Prefs
 */

const hyper = /** @type {Hyper.Site} */ (window.hyper) // undefined outside HyperBrowser: start() checks
const root = /** @type {HTMLElement} */ (document.getElementById('app'))
const projects = /** @type {Projects} */ (hyper?.projects)
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i
const TEXT = /\.(hmd|md|html?|css|m?js|json|txt|svg|xml|wat)$|^[^.]+$/i
const PERMISSIONS = ['space', 'contacts', 'notifications', 'projects']
const KINDS = ['string', 'text', 'number', 'boolean']

/** @type {Hyper.Project[]} */
let list = []
// null on the home page: what runs there checks
let cur = /** @type {Hyper.Project} */ (/** @type {unknown} */ (null))
/** @type {'pages' | 'files'} */
let mode = 'pages'
/** @type {File[]} */
let files = []
/** @type {Array<{ path: string, title: string }>} */
let pageList = []
/** @type {string | null} */
let open = null
/** @type {string | null} */
let panel = null
let notice = ''
/** @type {string | null} the "…" menu open */
let menu = null
let previewing = false
/** @type {Awaited<ReturnType<Projects['status']>> | null} */
let status = null
/** @type {import('./vendor/editor.js').Editor | null} */
let editor = null
/** @type {HTMLTextAreaElement | null} */
let area = null
let dirty = false
/** @type {Promise<void> | null} */
let saving = null
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null
let lastText = ''
/** @type {string | null} */
let image = null
/** @type {HTMLElement | null} */
let box = null // the editor's place, kept across redraws (its undo history with it)
/** @type {Folder[]} */
let folders = []
/** @type {ReturnType<typeof fileTree> | null} */
let tree = null
/** @type {HTMLElement | null} */
let treeBox = null
let treeShown = true
/** @type {{ op: 'cut' | 'copy', path: string, kind: string | null } | null} */
let clip = null
/** @type {Prefs} */
const DEFAULTS = { wrap: false, tabSize: 2, fontSize: 14, lineNumbers: true }
let prefs = { ...DEFAULTS }

start().catch((err) => {
  root.replaceChildren(h('p', {}, err.code === 'NOT_ALLOWED' ? 'The IDE needs your projects. Reload the page to be asked again.' : 'The IDE could not start: ' + err.message))
})

async function start () {
  if (!projects) return root.replaceChildren(h('p', {}, 'Open the IDE in HyperBrowser.'))
  document.addEventListener('click', (e) => { if (menu && !/** @type {Element} */ (e.target).closest('[data-menu]')) { menu = null; draw() } })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) {
      const id = menu
      menu = null
      draw()
      const button = /** @type {HTMLElement | null} */ (root.querySelector('[data-menu="' + id + '"] > button'))
      button?.focus()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && cur && open) { e.preventDefault(); save() }
  })
  projects.on(({ project }) => { if (cur?.key === project) changed() })
  setInterval(() => { // who is online (the line under the title): no event tells it
    if (cur) projects.status(cur.key).then((st) => { status = st; drawState() }, () => {})
  }, 5000)
  const mine = await hyper.mine.all().catch(() => /** @type {{ [name: string]: unknown }} */ ({}))
  treeShown = mine.tree !== false
  prefs = { ...DEFAULTS, .../** @type {Partial<Prefs>} */ (mine.editor || {}) }
  list = await projects.list()
  draw()
}

/**
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {string | ((r: T) => string)} [done] what to say once done
 */
async function act (fn, done) {
  notice = ''
  try {
    const r = await fn()
    if (done) notice = typeof done === 'function' ? done(r) : done
  } catch (e) {
    const err = /** @type {Hyper.Failure} */ (e)
    notice = (err.code === 'INVALID_MANIFEST' ? 'The site setup has a problem: ' : '') + err.message + (err.code ? ' (' + err.code + ')' : '')
  }
  draw()
}

/** @param {Hyper.Project} p */
async function openProject (p) {
  await flush()
  cur = p
  open = null
  panel = null
  previewing = false
  clip = null
  treeBox = h('div', { style: 'min-height:100%' })
  tree = fileTree(treeBox, { label: 'Files', open: (path) => choose(path), rename: renameTo, menu: treeMenu, mark: (path) => (status?.git?.changed || []).some((c) => c.path === path) ? '•' : '' })
  await reload()
  mode = ide.isHyperMD(files.map((f) => f.path)) ? 'pages' : 'files'
  open = mode === 'pages' ? pageList[0]?.path || null : (files.find((f) => f.path === 'index.html') || files[0])?.path || null
  await load()
}

async function reload () {
  list = await projects.list()
  cur = /** @type {Hyper.Project} */ (list.find((p) => p.key === cur.key) || null)
  if (!cur) return
  const all = await projects.files(cur.key, { folders: true })
  files = /** @type {File[]} */ (all.filter((f) => !(/** @type {{ folder?: true }} */ (f)).folder)).sort((a, b) => (a.path < b.path ? -1 : 1))
  folders = /** @type {Folder[]} */ (all.filter((f) => (/** @type {{ folder?: true }} */ (f)).folder))
  pageList = await ide.pages(projects, cur.key)
  status = await projects.status(cur.key).catch(() => null)
}

/** @type {ReturnType<typeof setTimeout> | null} */
let changing = null
function changed () {
  clearTimeout(changing)
  changing = setTimeout(async () => {
    if (!cur) return
    await reload()
    if (open && !dirty && files.some((f) => f.path === open)) {
      const now = await ide.read(projects, cur.key, open).catch(() => null)
      if (now !== null && now !== current() && !IMAGE.test(open)) setText(now)
    }
    draw()
  }, 300)
}

async function closeProject () {
  await flush()
  if (previewing) await projects.closePreview().catch(() => {})
  cur = /** @type {Hyper.Project} */ (/** @type {unknown} */ (null))
  open = null
  previewing = false
  editor?.destroy()
  editor = null
  list = await projects.list()
  draw()
}

const current = () => (editor ? editor.get() : area ? area.value : lastText)

async function load () {
  editor?.destroy()
  editor = null
  area = null
  box = newBox()
  if (image) URL.revokeObjectURL(image)
  image = null
  dirty = false
  lastText = ''
  if (open && IMAGE.test(open) && !open.endsWith('.svg')) {
    image = URL.createObjectURL(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (await projects.read(cur.key, open))]))
  } else if (open) {
    lastText = await ide.read(projects, cur.key, open)
  }
  draw()
}

function newBox () {
  return h('div', { id: 'editor', style: `flex:1; min-height:0; overflow:auto; border:1px solid; font-size:${prefs.fontSize}px` })
}

function remount () {
  lastText = current()
  editor?.destroy()
  editor = null
  area = null
  box = newBox()
  draw()
}

/** @param {string} text */
function setText (text) {
  lastText = text
  if (editor) editor.set(text)
  if (area) area.value = text
  dirty = false
}

function edited () {
  dirty = true
  clearTimeout(timer)
  if (open?.endsWith('.hmd')) timer = setTimeout(save, 700)
  drawState()
}

function save () {
  clearTimeout(timer)
  if (!cur || !open || !dirty) return saving
  const key = cur.key
  const path = open
  const text = current()
  dirty = false
  saving = (async () => {
    await saving
    await ide.save(projects, key, path, text)
    if (previewing && cur?.key === key) await ide.preview(projects, key)
  })().catch((/** @type {Hyper.Failure} */ err) => { dirty = true; notice = 'Not saved: ' + err.message; draw() })
  drawState()
  return saving
}

async function flush () {
  if (dirty) await save()
  await saving
}

/** @param {string} path */
async function choose (path) {
  await flush()
  open = path
  panel = null
  await load()
}

// A hand-written x.html wins over the page x.hmd: said, so the person knows why an edit doesn't show.
/** @param {string[] | undefined} hidden */
const hiding = (hidden) => hidden?.length ? ` ${hidden.join(', ')} ${hidden.length > 1 ? 'are' : 'is'} your own, so used instead of the page${hidden.length > 1 ? 's' : ''} built from .hmd.` : ''

function draw () {
  const inMenu = /** @type {HTMLElement | null | undefined} */ (document.activeElement?.closest?.('[data-menu]'))?.dataset.menu
  const typing = !!box && (box.contains(document.activeElement) || document.activeElement === box)
  root.replaceChildren(cur ? project() : home())
  if (inMenu) /** @type {HTMLElement | null} */ (root.querySelector('[data-menu="' + inMenu + '"] > button'))?.focus()
  if (typing) (area || editor)?.focus()
  fitMenu()
  if (tree && root.contains(treeBox)) {
    tree.set([...files, ...folders])
    tree.select(open)
  }
  mountEditor()
}

function home () {
  return h('div', { style: 'overflow:auto; flex:1; min-height:0; padding:8px' },
    h('h1', {}, 'Hyper IDE'),
    notice ? h('p', { role: 'alert' }, notice) : null,
    h('section', {}, h('h2', {}, 'Your projects'), list.length
      ? h('ul', {}, list.map((p) => h('li', {}, h('button', { onclick: () => act(() => openProject(p)) }, p.name), ' ',
        h('span', { class: 'small' }, p.site ? 'published' : 'not published yet', p.role === 'editor' ? ', co-author' : ''))))
      : h('p', {}, 'No project yet: make one below.')),
    h('section', {}, h('h2', {}, 'New project'),
      h('form', { onsubmit: (e) => { e.preventDefault(); const f = e.target; act(async () => openProject(/** @type {Hyper.Project} */ (await ide.create(projects, f.name.value.trim(), f.kind.value)))) } },
        h('p', {}, h('label', {}, 'Name ', h('input', { name: 'name', required: '', maxlength: 64 }))),
        h('p', {}, h('label', {}, 'Kind ', h('select', { name: 'kind' }, Object.entries(ide.TEMPLATES).map(([k, t]) => h('option', { value: k }, t.label))))),
        h('p', {}, h('button', {}, 'Make it'), ' ', more('home', [
          ['Open a copy of a site…', async () => { const key = await ask("The site's key"); if (key) act(async () => openProject(await projects.openCopy(key.trim()))) }],
          ['Open a folder…', () => act(async () => openProject(await projects.openFolder()))],
          ['Join with an invite…', async () => { const link = await ask('The invite link (hg:…)'); if (link) act(async () => openProject(await projects.join(link.trim()))) }]
        ])))))
}

function project () {
  return h('div', { style: 'display:grid; grid-template-rows:auto auto 1fr; flex:1; min-height:0; gap:6px' },
    h('header', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap' },
      h('button', { onclick: () => act(closeProject), 'aria-label': 'Back to your projects' }, '←'),
      h('h1', { style: 'margin:0; font-size:1.2em' }, cur.name),
      h('span', { style: 'flex:1' }),
      h('button', { onclick: toggleTree, 'aria-pressed': String(treeShown), title: 'More room for the editor' }, treeShown ? 'Hide file explorer' : 'Show file explorer'),
      h('button', { onclick: () => act(async () => { await flush(); previewing = !previewing; if (previewing) return ide.preview(projects, cur.key); else await projects.closePreview() }, (/** @type {{ hidden?: string[] } | undefined} */ r) => hiding(r?.hidden)), 'aria-pressed': String(previewing) }, 'Preview'),
      h('button', { onclick: () => act(async () => { await flush(); const r = await ide.publish(projects, cur.key); await reload(); return r }, (r) => `Published: version ${r.version}. Its address: ${r.site}` + hiding(r.hidden)) }, 'Publish'),
      more('project', [
        [mode === 'pages' ? 'Show the files' : 'Show the pages', () => act(async () => { await flush(); mode = mode === 'pages' ? 'files' : 'pages'; await load() })],
        ['Site setup', () => { panel = 'settings'; draw() }],
        ['Editor settings', () => { panel = 'editor'; draw() }],
        ['Versions', () => { panel = 'versions'; act(async () => { versions = await projects.versions(cur.key) }) }],
        ['People', () => { panel = 'people'; act(loadPeople) }],
        ['Reset the preview’s data', () => act(async () => { await ide.preview(projects, cur.key, true); previewing = true }, 'The preview starts again with no data.')],
        ['Leave this project…', async () => (await sure('Leave "' + cur.name + '"? Its folder stays on this computer.', 'Leave')) && act(async () => { await projects.leave(cur.key); await closeProject() })],
        ['Delete this project…', async () => (await sure('Delete "' + cur.name + '"? Its files are deleted from this computer (a .git folder stays), and it leaves your list on every device.', 'Delete')) && act(async () => { await projects.leave(cur.key, { deleteFiles: true }); await closeProject() })]
      ])),
    h('p', { id: 'state', class: 'small', style: 'margin:0; min-height:1.3em', role: 'status' }, stateLine()),
    h('div', { style: 'display:grid; grid-template-columns:' + (treeShown ? '240px ' : '') + '1fr; gap:6px; min-height:0' },
      treeShown ? h('nav', { 'aria-label': mode === 'pages' ? 'Pages' : 'Files', style: 'overflow:auto; min-height:0' }, mode === 'pages' ? pagesNav() : filesNav()) : null,
      // a div, not <main>: the theme gives <main> a HyperMD page's window (1140px at most, margins)
      h('div', { role: 'main', style: 'display:flex; flex-direction:column; min-height:0; min-width:0' }, panel ? panelView() : fileView())))
}

/** @returns {string} */
function stateLine () {
  const parts = [notice, open ? (dirty ? 'Not saved yet' : 'Saved') : '']
  if (status) {
    parts.push(status.devices ? `${status.devices} other device${status.devices > 1 ? 's' : ''} online` : 'no other device online')
    if (status.coauthors) parts.push(`${status.coauthors} co-author${status.coauthors > 1 ? 's' : ''} online`)
    if (status.git) parts.push(`git: ${status.git.branch}` + (status.git.changed ? `, ${status.git.changed.length} changed` : ''))
  }
  return parts.filter(Boolean).join(' · ')
}

function drawState () {
  const el = root.querySelector('#state')
  if (el) el.textContent = stateLine()
}

function pagesNav () {
  return [
    h('ul', { style: 'padding-left:1.2em' }, pageList.map((p) => h('li', {},
      h('button', { onclick: () => choose(p.path), 'aria-current': open === p.path ? 'page' : null, style: open === p.path ? 'font-weight:bold' : null }, p.title)))),
    h('p', {}, h('button', { onclick: async () => { const title = await ask('The new page’s title'); if (title) act(async () => { const p = await ide.addPage(projects, cur.key, title); await reload(); await choose(p) }) } }, 'New page')),
    h('h2', { style: 'font-size:1em' }, 'The site'),
    siteBasics()
  ]
}

function siteBasics () {
  const m = /** @type {{ title?: string, icon?: string, public?: boolean }} */ (manifestOf())
  const icon = files.find((f) => f.path === m.icon)
  return h('div', {},
    h('p', {}, h('label', {}, 'Title', h('br'), h('input', { value: m.title || '', maxlength: 200, style: 'width:100%; box-sizing:border-box', onchange: (e) => act(() => ide.setManifest(projects, cur.key, { title: e.target.value })) }))),
    h('p', {}, 'Icon: ', icon ? m.icon : 'none', ' ', pick('Choose a picture', 'image/*', (name, bytes) => ide.setIcon(projects, cur.key, name, bytes))),
    h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: m.public === false ? '' : null, onchange: (e) => act(() => ide.setManifest(projects, cur.key, { public: e.target.checked ? false : null })) }), ' Invite-only (else anyone with its address)')))
}

/** @type {{ key: string | null, at: number | undefined, m: Record<string, unknown> }} */
let manifestCache = { key: null, at: 0, m: {} }
function manifestOf () {
  const f = files.find((x) => x.path === 'site.json')
  if (manifestCache.key !== cur.key || manifestCache.at !== f?.mtime) {
    manifestCache = { key: cur.key, at: f?.mtime, m: manifestCache.key === cur.key ? manifestCache.m : {} }
    ide.manifest(projects, cur.key).then((m) => { if (JSON.stringify(m) !== JSON.stringify(manifestCache.m)) { manifestCache.m = m; draw() } }, () => {})
  }
  return manifestCache.m
}

function filesNav () {
  return [
    h('div', { style: 'display:flex; flex-wrap:wrap; gap:2px; padding:2px 0 4px' },
      h('button', { onclick: () => newFile(dirOf(tree?.selected)) }, 'New file'),
      h('button', { onclick: () => newFolder(dirOf(tree?.selected)) }, 'New folder'),
      pick('Upload', '', async (name, bytes) => { const p = await ide.upload(projects, cur.key, name, bytes); await reload(); return p })),
    treeBox
  ]
}

/** @param {string} p */
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** @param {string} p */
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)
/** @param {string} dir @param {string} name */
const join = (dir, name) => (dir ? dir + '/' + name : name)
/** @param {string | null | undefined} p */
const dirOf = (p) => (!p ? '' : folders.some((f) => f.path === p) ? p : parentOf(p))

/**
 * @param {string | null} path
 * @param {string | null} kind
 * @returns {Array<Item | null>}
 */
function treeMenu (path, kind) {
  const dir = !path ? '' : kind === 'folder' ? path : parentOf(path)
  /** @type {Array<Item | null>} */
  const items = []
  if (kind === 'file') items.push(['Open', () => choose(/** @type {string} */ (path))]) // a file's menu has its path
  if (path) items.push(['Rename', () => /** @type {NonNullable<typeof tree>} */ (tree).rename(path)], ['Delete…', () => remove(path)], null,
    ['Cut', () => { clip = { op: 'cut', path, kind } }], ['Copy', () => { clip = { op: 'copy', path, kind } }])
  if (clip) items.push(['Paste ' + nameOf(clip.path), () => act(() => paste(dir))])
  items.push(null, ['New file…', () => newFile(dir)], ['New folder…', () => newFolder(dir)])
  return items.filter((x, i, all) => x || (i > 0 && all[i - 1] && i < all.length - 1))
}

/** @param {string} from @param {string} to */
async function renameTo (from, to) {
  try {
    await projects.rename(cur.key, from, to)
  } catch (e) {
    const err = /** @type {Hyper.Failure} */ (e)
    notice = err.message + (err.code ? ' (' + err.code + ')' : '')
    draw()
    throw err
  }
  if (open === from || open?.startsWith(from + '/')) open = to + open.slice(from.length)
  await reload()
  draw()
}

/** @param {string} path */
async function remove (path) {
  if (!(await sure('Delete ' + path + '?' + (folders.some((f) => f.path === path) ? ' And what is in it.' : ''), 'Delete'))) return
  act(async () => {
    await projects.remove(cur.key, path)
    if (open === path || open?.startsWith(path + '/')) { open = null; await load() }
    await reload()
  })
}

/** @param {string} dir */
async function newFile (dir) {
  const name = await ask('The new file’s name' + (dir ? ' (in ' + dir + ')' : ''))
  if (name) act(async () => { const p = join(dir, name.trim()); await projects.write(cur.key, p, ''); await reload(); await choose(p) })
}

/** @param {string} dir */
async function newFolder (dir) {
  const name = await ask('The new folder’s name' + (dir ? ' (in ' + dir + ')' : ''))
  if (name) act(async () => { const p = join(dir, name.trim()); await projects.mkdir(cur.key, p); /** @type {NonNullable<typeof tree>} */ (tree).expanded.add(p); await reload() })
}

/** @param {string} dir */
async function paste (dir) {
  const { op, path } = /** @type {NonNullable<typeof clip>} */ (clip) // its menu item is there only with something cut or copied
  if (op === 'cut' && (dir === path || dir.startsWith(path + '/'))) throw Object.assign(new Error('a folder can’t go inside itself'), { code: 'INVALID_PATH' })
  const have = new Set([...files, ...folders].map((f) => f.path))
  const name = nameOf(path)
  const dot = folders.some((f) => f.path === path) ? -1 : name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let to = join(dir, name)
  if (op === 'cut' && to === path) return
  for (let n = 1; have.has(to); n++) to = join(dir, `${stem} copy${n > 1 ? ' ' + n : ''}${ext}`)
  if (op === 'cut') {
    await renameTo(path, to)
    clip = null
    return
  }
  /** @param {string} p */
  const under = (p) => p === path || p.startsWith(path + '/')
  for (const f of folders.filter((f) => under(f.path))) await projects.mkdir(cur.key, to + f.path.slice(path.length)).catch(() => {})
  for (const f of files.filter((f) => under(f.path))) await projects.write(cur.key, to + f.path.slice(path.length), await projects.read(cur.key, f.path))
  await reload()
}

function toggleTree () {
  treeShown = !treeShown
  hyper.mine.set('tree', treeShown).catch(() => {})
  draw()
}

/** @param {string} label @param {string} accept @param {(name: string, bytes: Uint8Array) => Promise<unknown>} fn */
function pick (label, accept, fn) {
  const input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept, style: 'display:none', onchange: () => {
    const f = /** @type {FileList} */ (input.files)[0]
    if (f) act(async () => { await fn(f.name, new Uint8Array(await f.arrayBuffer())); await reload() })
  } }))
  return h('span', {}, h('button', { onclick: () => input.click() }, label), input)
}

function fileView () {
  if (!open) return h('p', {}, mode === 'pages' ? 'Choose a page, or make a new one.' : 'Choose a file.')
  if (image) return h('p', {}, h('img', { src: image, alt: open, style: 'max-width:100%' }))
  if (!TEXT.test(open)) return h('p', {}, open + ' is not text: it is published as it is.')
  const beginner = mode === 'pages' && open.endsWith('.hmd')
  return [
    beginner ? toolbar() : h('div', { style: 'display:flex; flex-wrap:wrap; gap:4px; align-items:center' }, h('code', { style: 'overflow-wrap:anywhere' }, open), h('span', { style: 'flex:1' }),
      h('button', { onclick: () => editor?.undo() }, 'Undo'), h('button', { onclick: () => editor?.redo() }, 'Redo'),
      h('button', { onclick: () => editor?.search() }, 'Search'), h('button', { onclick: () => save() }, 'Save')),
    box
  ]
}

function toolbar () {
  /** @param {string} before */
  const wrap = (before, after = before, empty = '') => () => {
    const a = /** @type {HTMLTextAreaElement} */ (area) // the page's: there while this toolbar is
    const { selectionStart: s, selectionEnd: e, value } = a
    const sel = value.slice(s, e) || empty
    a.setRangeText(before + sel + after, s, e, 'select')
    a.focus()
    edited()
  }
  /** @param {string} prefix */
  const line = (prefix) => () => {
    const a = /** @type {HTMLTextAreaElement} */ (area)
    const { selectionStart: s, value } = a
    const at = value.lastIndexOf('\n', s - 1) + 1
    a.setRangeText(prefix, at, at, 'end')
    a.focus()
    edited()
  }
  return h('div', { role: 'toolbar', 'aria-label': 'Formatting', style: 'display:flex; gap:4px; flex-wrap:wrap' },
    h('button', { onclick: line('## ') }, 'Heading'),
    h('button', { onclick: wrap('**', '**', 'bold'), style: 'font-weight:bold' }, 'Bold'),
    h('button', { onclick: wrap('*', '*', 'italic'), style: 'font-style:italic' }, 'Italic'),
    h('button', { onclick: async () => { const url = await ask('The link’s address (https://…, or another page’s title)'); if (url) wrap('[', '](' + linkTo(url) + ')', 'link')() } }, 'Link'),
    pick('Image', 'image/*', async (name, bytes) => {
      const p = await ide.upload(projects, cur.key, name, bytes, 'images')
      const a = /** @type {HTMLTextAreaElement} */ (area)
      const { selectionStart: s, selectionEnd: e } = a
      a.setRangeText('![' + name.replace(/\.[^.]+$/, '') + '](' + p + ')', s, e, 'end')
      edited()
    }),
    h('button', { onclick: line('- ') }, 'List'),
    h('button', { onclick: line('> ') }, 'Quote'))
}

/** @param {string} what */
function linkTo (what) {
  const page = pageList.find((p) => p.title.toLowerCase() === what.trim().toLowerCase())
  return page ? page.path : what.trim()
}

async function mountEditor () {
  const slot = box
  if (!slot || !root.contains(slot) || slot.firstChild || slot.shadowRoot?.firstChild) return
  const text = current()
  if (mode === 'pages' && open?.endsWith('.hmd')) {
    editor?.destroy()
    editor = null
    area = /** @type {HTMLTextAreaElement} */ (h('textarea', { 'aria-label': 'The page', style: 'display:block; width:100%; height:100%; box-sizing:border-box; border:0; resize:none; font:inherit; padding:6px', oninput: edited }))
    area.value = text
    slot.replaceChildren(area)
    return
  }
  area = null
  const { editor: make } = await import('./vendor/editor.js')
  if (!root.contains(slot)) return
  editor?.destroy()
  editor = make(slot, { name: /** @type {string} */ (open), doc: text, label: /** @type {string} */ (open), onChange: edited, wrap: prefs.wrap, tabSize: prefs.tabSize, lineNumbers: prefs.lineNumbers })
}

/** @type {Awaited<ReturnType<Projects['versions']>>} */
let versions = []
/** @type {{ members: Awaited<ReturnType<Projects['members']>>, friends: Hyper.Contact[] | null, link: string | null }} */
let people = { members: [], friends: null, link: null }

function panelView () {
  const back = h('p', {}, h('button', { onclick: () => { panel = null; draw() } }, '← Back to the editor'))
  if (panel === 'versions') {
    return [back, h('h2', {}, 'Versions'), h('p', { class: 'small' }, 'The versions published from this computer. Publishing an older one again makes it the newest.'),
      versions.length
        ? h('ul', {}, versions.map((v, i) => h('li', {}, `Version ${v.version}, ${new Date(v.at).toLocaleString()}`, i === 0 ? ' (now)' : ' ',
          i ? more('v' + v.version, [['Publish this version again', () => act(async () => { const r = await projects.rollBack(cur.key, v.version); versions = await projects.versions(cur.key); return r }, (r) => `Version ${v.version} published again (now version ${r.version}).`)]]) : null)))
        : h('p', {}, 'Not published from this computer yet.')]
  }
  if (panel === 'people') return [back, peopleView()]
  if (panel === 'editor') return [back, editorSettings()]
  return [back, setupView()]
}

function editorSettings () {
  /** @param {Partial<Prefs>} change */
  const set = (change) => {
    prefs = { ...prefs, ...change }
    hyper.mine.set('editor', prefs).catch(() => {})
    remount()
  }
  return h('div', { style: 'overflow:auto' },
    h('h2', {}, 'Editor settings'),
    h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: prefs.wrap ? '' : null, onchange: (e) => set({ wrap: e.target.checked }) }), ' Wrap long lines (code)')),
    h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: prefs.lineNumbers ? '' : null, onchange: (e) => set({ lineNumbers: e.target.checked }) }), ' Line numbers')),
    h('p', {}, h('label', {}, 'Tab size ', h('select', { onchange: (e) => set({ tabSize: Number(e.target.value) }) }, [2, 4, 8].map((n) => h('option', { value: n, selected: n === prefs.tabSize ? '' : null }, n + ' spaces'))))),
    h('p', {}, h('label', {}, 'Text size ', h('select', { onchange: (e) => set({ fontSize: Number(e.target.value) }) }, [12, 13, 14, 16, 18, 20].map((n) => h('option', { value: n, selected: n === prefs.fontSize ? '' : null }, n + ' px'))))),
    h('p', {}, h('button', { onclick: () => set({ ...DEFAULTS }) }, 'Back to the defaults')))
}

async function loadPeople () {
  people = { ...people, members: await projects.members(cur.key) }
}

function peopleView () {
  const owner = cur.role === 'owner'
  return h('div', {},
    h('h2', {}, 'People'),
    h('p', { class: 'small' }, 'Co-authors edit the files and publish the site. Their files reach your computer like yours: invite only people whose code you would run.'),
    h('ul', {}, people.members.filter((m) => !m.removed && !m.banned).map((m) => h('li', {},
      (m.name || m.identity.slice(0, 8) + '…') + (m.you ? ' (you)' : ''), ' ', h('span', { class: 'small' }, m.role === 'owner' ? 'owner' : 'co-author', m.online ? ', online' : ''), ' ',
      owner && !m.you ? more('m' + m.identity, [['Remove from the project', () => act(async () => { await projects.removeMember(cur.key, m.identity); await loadPeople() })]]) : null))),
    owner ? h('p', {},
      h('button', { onclick: () => act(async () => { people.link = (await projects.invite(cur.key)).link }) }, 'Make an invite link'), ' ',
      h('button', { onclick: () => act(async () => { people.friends = (await hyper.contacts.list()).filter((c) => c.state === 'friend') }) }, 'Invite a contact…')) : null,
    people.link ? h('p', {}, h('code', { style: 'word-break:break-all' }, people.link), ' ', h('button', { onclick: () => navigator.clipboard.writeText(/** @type {string} */ (people.link)) }, 'Copy'), h('br'), h('span', { class: 'small' }, 'One use. They paste it in the IDE: … → Join with an invite.')) : null,
    people.friends ? (people.friends.length
      ? h('ul', {}, people.friends.map((c) => h('li', {}, c.name || c.identity.slice(0, 8) + '…', ' ', h('button', { onclick: () => act(() => projects.inviteContact(cur.key, c.identity), 'Invite sent in your chat with ' + (c.name || 'them') + '.') }, 'Invite'))))
      : h('p', {}, 'No friends yet: add some in Contacts.')) : null)
}

/** @type {string | null} site.json being edited as JSON */
let raw = null
function setupView () {
  const m = /** @type {{ title?: string, entry?: string, icon?: string, public?: boolean, permissions?: string[], types?: Record<string, { fields?: Record<string, string> }> }} */ (manifestOf())
  /** @param {Record<string, unknown>} change */
  const set = (change) => act(() => ide.setManifest(projects, cur.key, change), 'Saved.')
  const pages = files.map((f) => f.path).filter((p) => /\.html?$/.test(p))
  const images = files.map((f) => f.path).filter((p) => IMAGE.test(p))
  const types = m.types || {}
  /** @param {Record<string, unknown>} t */
  const setTypes = (t) => set({ types: Object.keys(t).length ? t : null })
  return h('div', { style: 'overflow:auto' },
    h('h2', {}, 'Site setup'),
    raw === null ? [
      h('p', {}, h('label', {}, 'Title ', h('input', { value: m.title || '', maxlength: 200, onchange: (e) => set({ title: e.target.value }) }))),
      h('p', {}, h('label', {}, 'First page ', h('select', { onchange: (e) => set({ entry: e.target.value }) }, pages.map((p) => h('option', { value: p, selected: p === (m.entry || 'index.html') ? '' : null }, p))))),
      h('p', {}, h('label', {}, 'Icon ', h('select', { onchange: (e) => set({ icon: e.target.value || null }) }, h('option', { value: '' }, 'none'), images.map((p) => h('option', { value: p, selected: p === m.icon ? '' : null }, p))))),
      h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: m.public === false ? '' : null, onchange: (e) => set({ public: e.target.checked ? false : null }) }), ' Invite-only')),
      h('fieldset', {}, h('legend', {}, 'Permissions (what the site asks the person for)'), PERMISSIONS.map((p) => h('label', { style: 'margin-right:1em' },
        h('input', { type: 'checkbox', checked: (m.permissions || []).includes(p) ? '' : null, onchange: (e) => set({ permissions: [...new Set([...(m.permissions || []).filter((x) => x !== p), ...(e.target.checked ? [p] : [])])] }) }), ' ', p))),
      h('fieldset', {}, h('legend', {}, 'Record types (an app’s data in its space)'),
        Object.entries(types).map(([name, t]) => h('div', {}, h('b', {}, name), ' ',
          Object.entries(t.fields || {}).map(([f, k]) => h('span', { class: 'small', style: 'margin-right:8px' }, f + ': ' + k)), ' ',
          h('button', { 'aria-label': 'Add a field to ' + name, onclick: async () => { const f = await ask('Field name'); const k = f && await ask('Kind', 'string', KINDS); if (f && KINDS.includes(/** @type {string} */ (k))) setTypes({ ...types, [name]: { ...t, fields: { ...t.fields, [f]: k } } }) } }, '+ field'))),
        h('p', {}, h('button', { onclick: async () => { const n = await ask('Type name'); if (n) setTypes({ ...types, [n]: { fields: {} } }) } }, 'Add a type')),
        h('p', { class: 'small' }, 'Types and fields can be added, never removed, once published. Roles are made by the app at run time (hyper.defineRole).')),
      h('p', {}, h('button', { onclick: () => act(async () => { raw = await ide.read(projects, cur.key, 'site.json') }) }, 'Edit as JSON'))
    ] : [
      h('textarea', { 'aria-label': 'site.json', id: 'raw', style: 'width:100%; box-sizing:border-box; height:50vh; font-family:monospace', value: raw }),
      h('p', {}, h('button', { onclick: () => { const v = /** @type {HTMLTextAreaElement} */ (root.querySelector('#raw')).value; act(async () => { await ide.writeManifest(projects, cur.key, v); raw = null }, 'Saved.') } }, 'Save'), ' ',
        h('button', { onclick: () => { raw = null; draw() } }, 'Back to the form'))
    ])
}

/**
 * Electron has no prompt(): a modal dialog instead.
 * @param {string} label
 * @param {string[] | null} [choices]
 * @returns {Promise<string | null>} null: cancelled
 */
function ask (label, value = '', choices = null) {
  const field = /** @type {HTMLInputElement | HTMLSelectElement} */ (choices
    ? h('select', { name: 'v' }, choices.map((c) => h('option', { value: c, selected: c === value ? '' : null }, c)))
    : h('input', { name: 'v', value, required: '', style: 'width:100%; box-sizing:border-box' }))
  return modal(h('label', {}, label, h('br'), field), 'OK', () => field.value)
}

/** @param {string} text @param {string} yes */
function sure (text, yes) {
  return modal(h('p', {}, text), yes, () => true).then((r) => r === true)
}

/**
 * @template T
 * @param {HTMLElement} body
 * @param {string} yes
 * @param {() => T} value the answer on yes
 * @returns {Promise<T | null>}
 */
function modal (body, yes, value) {
  return new Promise((resolve) => {
    /** @param {T | null} answer */
    const done = (answer) => { d.close(); d.remove(); resolve(answer) }
    const d = /** @type {HTMLDialogElement} */ (h('dialog', { 'aria-label': yes, style: 'max-width:480px', oncancel: (e) => { e.preventDefault(); done(null) } },
      h('form', { onsubmit: (e) => { e.preventDefault(); done(value()) } }, body,
        h('p', {}, h('button', {}, yes), ' ', h('button', { type: 'button', onclick: () => done(null) }, 'Cancel')))))
    document.body.append(d)
    d.showModal()
  })
}

/** @param {string} id @param {Item[]} items */
function more (id, items) {
  const isOpen = menu === id
  return h('span', { 'data-menu': id, style: 'position:relative; display:inline-block' },
    h('button', { 'aria-label': 'More', 'aria-haspopup': 'menu', 'aria-expanded': String(isOpen), onclick: () => { menu = isOpen ? null : id; draw() } }, '…'),
    isOpen
      ? h('div', { role: 'menu', style: 'position:absolute; top:100%; right:0; z-index:10; margin-top:2px; padding:4px; display:flex; flex-direction:column; gap:2px; white-space:nowrap; background:var(--paper, Canvas); color:var(--ink, CanvasText); border:1px solid; box-shadow:2px 2px 0 var(--ink, CanvasText)' },
        items.map(([label, fn]) => h('button', { role: 'menuitem', style: 'text-align:left', onclick: () => { menu = null; draw(); fn() } }, label)))
      : null)
}

function fitMenu () {
  const m = /** @type {HTMLElement | null} */ (root.querySelector('[data-menu] [role=menu]'))
  if (!m) return
  if (m.getBoundingClientRect().left < 0) Object.assign(m.style, { right: 'auto', left: '0' })
  if (m.getBoundingClientRect().right > innerWidth) Object.assign(m.style, { left: 'auto', right: '0' })
  if (m.getBoundingClientRect().bottom > innerHeight) Object.assign(m.style, { top: 'auto', bottom: '100%', marginTop: '0', marginBottom: '2px' })
}

/**
 * @param {string} tag
 * @param {{ [name: string]: string | number | boolean | null | undefined | ((e: any) => void) } | null} [attrs]
 *   attribute values, `value`, and on* listeners (each gets its event: input, change, submit...)
 * @param {...unknown} children nodes, text and lists of them; null, undefined and false are left out
 */
function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), /** @type {EventListener} */ (v))
    else if (k === 'value') /** @type {HTMLInputElement} */ (el).value = /** @type {string} */ (v)
    else el.setAttribute(k, /** @type {string} */ (v))
  }
  for (const x of children.flat(Infinity)) if (x !== null && x !== undefined && x !== false) el.append(x instanceof Node ? x : String(x))
  return el
}
