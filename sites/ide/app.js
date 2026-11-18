// HyperBrowser's IDE (spec 025): make sites and apps. Beginners see pages by their titles and a toolbar (D1, D6);
// developers see files, code (CodeMirror, loaded when first needed: D3) and the site's setup (D7). The project's
// preview sits beside the page (HyperBrowser docks it: hyper.projects.preview), reloaded on save (D5). No stylesheet:
// HyperBrowser's default theme (CodeMirror's styles are adopted sheets, so it stays). The work itself: lib/site.js.
import * as ide from './lib/site.js'
import { fileTree } from './lib/tree.js'

const hyper = window.hyper
const root = document.getElementById('app')
const projects = hyper?.projects
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i
const TEXT = /\.(hmd|md|html?|css|m?js|json|txt|svg|xml|wat)$|^[^.]+$/i
const PERMISSIONS = ['space', 'contacts', 'notifications', 'projects']
const KINDS = ['string', 'text', 'number', 'boolean']

let list = []
let cur = null // the open project (from list)
let mode = 'pages' // 'pages' (beginners) or 'files' (developers)
let files = []
let pageList = []
let open = null // the open file's path
let panel = null // null (the editor), 'settings', 'versions', 'people'
let notice = ''
let menu = null // the "…" menu open (its id)
let previewing = false
let status = null
let editor = null // CodeMirror's, once loaded
let area = null // the beginners' text area
let dirty = false
let saving = null
let timer = null
let lastText = ''
let image = null // the open picture's blob URL
let box = null // the editor's place, kept across redraws (its undo history with it)
let folders = [] // spec 026: the project's folders (empty ones too), for the tree
let tree = null // the file tree (lib/tree.js), and its place: kept across redraws
let treeBox = null
let treeShown = true // spec 026 I2: the list beside the editor shown (hyper.mine 'tree')
let clip = null // cut or copied: { op: 'cut' | 'copy', path, kind }
// spec 026 I3: the editor's settings (hyper.mine 'editor'), per person
const DEFAULTS = { wrap: false, tabSize: 2, fontSize: 14, lineNumbers: true }
let prefs = { ...DEFAULTS }

start().catch((err) => {
  root.replaceChildren(h('p', {}, err.code === 'NOT_ALLOWED' ? 'The IDE needs your projects. Reload the page to be asked again.' : 'The IDE could not start: ' + err.message))
})

async function start () {
  if (!projects) return root.replaceChildren(h('p', {}, 'Open the IDE in HyperBrowser.'))
  document.addEventListener('click', (e) => { if (menu && !e.target.closest('[data-menu]')) { menu = null; draw() } })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) {
      const id = menu
      menu = null
      draw()
      root.querySelector('[data-menu="' + id + '"] > button')?.focus()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && cur && open) { e.preventDefault(); save() }
  })
  projects.on(({ project }) => { if (cur?.key === project) changed() })
  setInterval(() => { // who is online (the line under the title): no event tells it
    if (cur) projects.status(cur.key).then((st) => { status = st; drawState() }, () => {})
  }, 5000)
  const mine = await hyper.mine.all().catch(() => ({}))
  treeShown = mine.tree !== false
  prefs = { ...DEFAULTS, ...(mine.editor || {}) }
  list = await projects.list()
  draw()
}

// --- acting, with what went wrong said in words ---

async function act (fn, done) {
  notice = ''
  try {
    const r = await fn()
    if (done) notice = typeof done === 'function' ? done(r) : done
  } catch (err) {
    notice = (err.code === 'INVALID_MANIFEST' ? 'The site setup has a problem: ' : '') + err.message + (err.code ? ' (' + err.code + ')' : '')
  }
  draw()
}

// --- projects ---

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
  cur = list.find((p) => p.key === cur.key) || null
  if (!cur) return
  const all = await projects.files(cur.key, { folders: true })
  files = all.filter((f) => !f.folder).sort((a, b) => (a.path < b.path ? -1 : 1))
  folders = all.filter((f) => f.folder)
  pageList = await ide.pages(projects, cur.key)
  status = await projects.status(cur.key).catch(() => null)
}

// A co-author's edit, another device's, or our own save arrived: the lists again; the open file too if untouched.
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
  cur = null
  open = null
  previewing = false
  editor?.destroy()
  editor = null
  list = await projects.list()
  draw()
}

// --- the open file ---

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
    image = URL.createObjectURL(new Blob([await projects.read(cur.key, open)]))
  } else if (open) {
    lastText = await ide.read(projects, cur.key, open)
  }
  draw()
}

function newBox () {
  return h('div', { id: 'editor', style: `flex:1; min-height:0; overflow:auto; border:1px solid; font-size:${prefs.fontSize}px` })
}

// The editor made again with the settings (its text and its "not saved" kept).
function remount () {
  lastText = current()
  editor?.destroy()
  editor = null
  area = null
  box = newBox()
  draw()
}

function setText (text) {
  lastText = text
  if (editor) editor.set(text)
  if (area) area.value = text
  dirty = false
}

function edited () {
  dirty = true
  clearTimeout(timer)
  if (open?.endsWith('.hmd')) timer = setTimeout(save, 700) // HyperMD: as you type (D5)
  drawState()
}

// Saved now (HyperMD pages built again); the preview reloaded.
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
  })().catch((err) => { dirty = true; notice = 'Not saved: ' + err.message; draw() })
  drawState()
  return saving
}

async function flush () {
  if (dirty) await save()
  await saving
}

async function choose (path) {
  await flush()
  open = path
  panel = null
  await load()
}

// --- drawing ---

function draw () {
  const inMenu = document.activeElement?.closest?.('[data-menu]')?.dataset.menu
  const typing = !!box && (box.contains(document.activeElement) || document.activeElement === box) // a redraw keeps the writer's place
  root.replaceChildren(cur ? project() : home())
  if (inMenu) root.querySelector('[data-menu="' + inMenu + '"] > button')?.focus()
  if (typing) (area || editor)?.focus()
  if (tree && root.contains(treeBox)) {
    tree.set([...files, ...folders])
    tree.select(open)
  }
  mountEditor()
}

function home () {
  return h('div', { style: 'overflow:auto; flex:1; min-height:0; padding:8px' },
    h('h1', {}, 'IDE'),
    notice ? h('p', { role: 'alert' }, notice) : null,
    h('section', {}, h('h2', {}, 'Your projects'), list.length
      ? h('ul', {}, list.map((p) => h('li', {}, h('button', { onclick: () => act(() => openProject(p)) }, p.name), ' ',
        h('span', { class: 'small' }, p.site ? 'published' : 'not published yet', p.role === 'editor' ? ', co-author' : ''))))
      : h('p', {}, 'No project yet: make one below.')),
    h('section', {}, h('h2', {}, 'New project'),
      h('form', { onsubmit: (e) => { e.preventDefault(); const f = e.target; act(async () => openProject(await ide.create(projects, f.name.value.trim(), f.kind.value))) } },
        h('p', {}, h('label', {}, 'Name ', h('input', { name: 'name', required: '', maxlength: 64 }))),
        h('p', {}, h('label', {}, 'Kind ', h('select', { name: 'kind' }, Object.entries(ide.TEMPLATES).map(([k, t]) => h('option', { value: k }, t.label))))),
        h('p', {}, h('button', {}, 'Make it'), ' ', more('home', [
          ['Open a copy of a site…', async () => { const key = await ask("The site's key"); if (key) act(async () => openProject(await projects.openCopy(key.trim()))) }],
          ['Open a folder…', () => act(async () => openProject(await projects.openFolder()))],
          ['Join with an invite…', async () => { const link = await ask('The invite link (hg:…)'); if (link) act(async () => openProject(await projects.join(link.trim()))) }]
        ])))))
}

function project () {
  return h('div', { style: 'display:grid; grid-template-rows:auto auto 1fr; flex:1; min-height:0; gap:6px' }, // spec 026: fits the window (body.hb-app)
    h('header', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap' },
      h('button', { onclick: () => act(closeProject), 'aria-label': 'Back to your projects' }, '←'),
      h('h1', { style: 'margin:0; font-size:1.2em' }, cur.name),
      h('span', { style: 'flex:1' }),
      h('button', { onclick: toggleTree, 'aria-pressed': String(treeShown), title: 'More room for the editor' }, treeShown ? 'Hide the list' : 'Show the list'),
      h('button', { onclick: () => act(async () => { await flush(); previewing = !previewing; if (previewing) await ide.preview(projects, cur.key); else await projects.closePreview() }), 'aria-pressed': String(previewing) }, 'Preview'),
      h('button', { onclick: () => act(async () => { await flush(); const r = await ide.publish(projects, cur.key); await reload(); return r }, (r) => `Published: version ${r.version}. Its address: ${r.site}`) }, 'Publish'),
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
      h('main', { style: 'display:flex; flex-direction:column; min-height:0; min-width:0' }, panel ? panelView() : fileView())))
}

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
  const m = manifestOf()
  const icon = files.find((f) => f.path === m.icon)
  return h('div', {},
    h('p', {}, h('label', {}, 'Title', h('br'), h('input', { value: m.title || '', maxlength: 200, style: 'width:100%', onchange: (e) => act(() => ide.setManifest(projects, cur.key, { title: e.target.value })) }))),
    h('p', {}, 'Icon: ', icon ? m.icon : 'none', ' ', pick('Choose a picture', 'image/*', (name, bytes) => ide.setIcon(projects, cur.key, name, bytes))),
    h('p', {}, h('label', {}, h('input', { type: 'checkbox', checked: m.public === false ? '' : null, onchange: (e) => act(() => ide.setManifest(projects, cur.key, { public: e.target.checked ? false : null })) }), ' Invite-only (else anyone with its address)')))
}

let manifestCache = { key: null, at: 0, m: {} }
function manifestOf () {
  const f = files.find((x) => x.path === 'site.json')
  if (manifestCache.key !== cur.key || manifestCache.at !== f?.mtime) {
    manifestCache = { key: cur.key, at: f?.mtime, m: manifestCache.key === cur.key ? manifestCache.m : {} } // another project: nothing of the last one shown
    ide.manifest(projects, cur.key).then((m) => { if (JSON.stringify(m) !== JSON.stringify(manifestCache.m)) { manifestCache.m = m; draw() } }, () => {})
  }
  return manifestCache.m
}

// spec 026 I1: the files as a tree (lib/tree.js): right-click (or the Menu key, Shift+F10) for its actions.
function filesNav () {
  return [
    h('div', { style: 'display:flex; flex-wrap:wrap; gap:2px; padding:2px 0 4px' },
      h('button', { onclick: () => newFile(dirOf(tree?.selected)) }, 'New file'),
      h('button', { onclick: () => newFolder(dirOf(tree?.selected)) }, 'New folder'),
      pick('Upload', '', async (name, bytes) => { const p = await ide.upload(projects, cur.key, name, bytes); await reload(); return p })),
    treeBox
  ]
}

const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)
const join = (dir, name) => (dir ? dir + '/' + name : name)
// A new file goes into the selected folder, or beside the selected file.
const dirOf = (p) => (!p ? '' : folders.some((f) => f.path === p) ? p : parentOf(p))

// The tree's context menu for a row (or the empty area): its actions, then the clipboard's, then new ones.
function treeMenu (path, kind) {
  const dir = !path ? '' : kind === 'folder' ? path : parentOf(path)
  const items = []
  if (kind === 'file') items.push(['Open', () => choose(path)])
  if (path) items.push(['Rename', () => tree.rename(path)], ['Delete…', () => remove(path)], null,
    ['Cut', () => { clip = { op: 'cut', path, kind } }], ['Copy', () => { clip = { op: 'copy', path, kind } }])
  if (clip) items.push(['Paste ' + nameOf(clip.path), () => act(() => paste(dir))])
  items.push(null, ['New file…', () => newFile(dir)], ['New folder…', () => newFolder(dir)])
  return items.filter((x, i, all) => x || (i > 0 && all[i - 1] && i < all.length - 1))
}

async function renameTo (from, to) {
  try {
    await projects.rename(cur.key, from, to)
  } catch (err) {
    notice = err.message + (err.code ? ' (' + err.code + ')' : '')
    draw()
    throw err
  }
  if (open === from || open?.startsWith(from + '/')) open = to + open.slice(from.length)
  await reload()
  draw()
}

async function remove (path) {
  if (!(await sure('Delete ' + path + '?' + (folders.some((f) => f.path === path) ? ' And what is in it.' : ''), 'Delete'))) return
  act(async () => {
    await projects.remove(cur.key, path)
    if (open === path || open?.startsWith(path + '/')) { open = null; await load() }
    await reload()
  })
}

async function newFile (dir) {
  const name = await ask('The new file’s name' + (dir ? ' (in ' + dir + ')' : ''))
  if (name) act(async () => { const p = join(dir, name.trim()); await projects.write(cur.key, p, ''); await reload(); await choose(p) })
}

async function newFolder (dir) {
  const name = await ask('The new folder’s name' + (dir ? ' (in ' + dir + ')' : ''))
  if (name) act(async () => { const p = join(dir, name.trim()); await projects.mkdir(cur.key, p); tree.expanded.add(p); await reload() })
}

// The clipboard's file or folder into `dir`: moved (cut) or copied, under a free name.
async function paste (dir) {
  const { op, path } = clip
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

// A button that picks a file from the computer, then `fn(name, bytes)`.
function pick (label, accept, fn) {
  const input = h('input', { type: 'file', accept, style: 'display:none', onchange: () => {
    const f = input.files[0]
    if (f) act(async () => { await fn(f.name, new Uint8Array(await f.arrayBuffer())); await reload() })
  } })
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

// D6: what a page needs, in plain words; images picked from the computer.
function toolbar () {
  const wrap = (before, after = before, empty = '') => () => {
    const { selectionStart: s, selectionEnd: e, value } = area
    const sel = value.slice(s, e) || empty
    area.setRangeText(before + sel + after, s, e, 'select')
    area.focus()
    edited()
  }
  const line = (prefix) => () => {
    const { selectionStart: s, value } = area
    const at = value.lastIndexOf('\n', s - 1) + 1
    area.setRangeText(prefix, at, at, 'end')
    area.focus()
    edited()
  }
  return h('div', { role: 'toolbar', 'aria-label': 'Formatting', style: 'display:flex; gap:4px; flex-wrap:wrap' },
    h('button', { onclick: line('## ') }, 'Heading'),
    h('button', { onclick: wrap('**', '**', 'bold'), style: 'font-weight:bold' }, 'Bold'),
    h('button', { onclick: wrap('*', '*', 'italic'), style: 'font-style:italic' }, 'Italic'),
    h('button', { onclick: async () => { const url = await ask('The link’s address (https://…, or another page’s title)'); if (url) wrap('[', '](' + linkTo(url) + ')', 'link')() } }, 'Link'),
    pick('Image', 'image/*', async (name, bytes) => {
      const p = await ide.upload(projects, cur.key, name, bytes, 'images')
      const { selectionStart: s, selectionEnd: e } = area
      area.setRangeText('![' + name.replace(/\.[^.]+$/, '') + '](' + p + ')', s, e, 'end')
      edited()
    }),
    h('button', { onclick: line('- ') }, 'List'),
    h('button', { onclick: line('> ') }, 'Quote'))
}

// A page's title → its file (beginners never type one); anything else as typed.
function linkTo (what) {
  const page = pageList.find((p) => p.title.toLowerCase() === what.trim().toLowerCase())
  return page ? page.path : what.trim()
}

// The editor in #editor: a text area for a beginner's page; CodeMirror (loaded the first time) for code.
async function mountEditor () {
  const slot = box
  if (!slot || !root.contains(slot) || slot.firstChild || slot.shadowRoot?.firstChild) return // there already: kept as it is
  const text = current()
  if (mode === 'pages' && open?.endsWith('.hmd')) {
    editor?.destroy()
    editor = null
    area = h('textarea', { 'aria-label': 'The page', style: 'width:100%; height:100%; box-sizing:border-box; border:0; resize:none; font:inherit; padding:6px', oninput: edited })
    area.value = text
    slot.replaceChildren(area)
    return
  }
  area = null
  const { editor: make } = await import('./vendor/editor.js')
  if (!root.contains(slot)) return
  editor?.destroy()
  editor = make(slot, { name: open, doc: text, label: open, onChange: edited, wrap: prefs.wrap, tabSize: prefs.tabSize, lineNumbers: prefs.lineNumbers })
}

// --- panels ---

let versions = []
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

// spec 026 I3: a small first set, saved per person (on every device of theirs).
function editorSettings () {
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
    people.link ? h('p', {}, h('code', { style: 'word-break:break-all' }, people.link), ' ', h('button', { onclick: () => navigator.clipboard.writeText(people.link) }, 'Copy'), h('br'), h('span', { class: 'small' }, 'One use. They paste it in the IDE: … → Join with an invite.')) : null,
    people.friends ? (people.friends.length
      ? h('ul', {}, people.friends.map((c) => h('li', {}, c.name || c.identity.slice(0, 8) + '…', ' ', h('button', { onclick: () => act(() => projects.inviteContact(cur.key, c.identity), 'Invite sent in your chat with ' + (c.name || 'them') + '.') }, 'Invite'))))
      : h('p', {}, 'No friends yet: add some in Contacts.')) : null)
}

// D7: site.json as a form, or as JSON; checked as the engine checks it before it is written.
let raw = null
function setupView () {
  const m = manifestOf()
  const set = (change) => act(() => ide.setManifest(projects, cur.key, change), 'Saved.')
  const pages = files.map((f) => f.path).filter((p) => /\.html?$/.test(p))
  const images = files.map((f) => f.path).filter((p) => IMAGE.test(p))
  const types = m.types || {}
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
          h('button', { 'aria-label': 'Add a field to ' + name, onclick: async () => { const f = await ask('Field name'); const k = f && await ask('Kind', 'string', KINDS); if (f && KINDS.includes(k)) setTypes({ ...types, [name]: { ...t, fields: { ...t.fields, [f]: k } } }) } }, '+ field'))),
        h('p', {}, h('button', { onclick: async () => { const n = await ask('Type name'); if (n) setTypes({ ...types, [n]: { fields: {} } }) } }, 'Add a type')),
        h('p', { class: 'small' }, 'Types and fields can be added, never removed, once published. Roles are made by the app at run time (hyper.defineRole).')),
      h('p', {}, h('button', { onclick: () => act(async () => { raw = await ide.read(projects, cur.key, 'site.json') }) }, 'Edit as JSON'))
    ] : [
      h('textarea', { 'aria-label': 'site.json', id: 'raw', style: 'width:100%; height:50vh; font-family:monospace', value: raw }),
      h('p', {}, h('button', { onclick: () => { const v = root.querySelector('#raw').value; act(async () => { await ide.writeManifest(projects, cur.key, v); raw = null }, 'Saved.') } }, 'Save'), ' ',
        h('button', { onclick: () => { raw = null; draw() } }, 'Back to the form'))
    ])
}

// --- small helpers ---

// A question in a modal dialog (Electron has no prompt()): the text typed, or one of `choices`; null if cancelled.
function ask (label, value = '', choices = null) {
  const field = choices
    ? h('select', { name: 'v' }, choices.map((c) => h('option', { value: c, selected: c === value ? '' : null }, c)))
    : h('input', { name: 'v', value, required: '', style: 'width:100%' })
  return modal(h('label', {}, label, h('br'), field), 'OK', () => field.value)
}

// Yes or no, in a modal dialog: true for `yes`.
function sure (text, yes) {
  return modal(h('p', {}, text), yes, () => true).then((r) => r === true)
}

function modal (body, yes, value) {
  return new Promise((resolve) => {
    const done = (answer) => { d.close(); d.remove(); resolve(answer) }
    const d = h('dialog', { 'aria-label': yes, style: 'max-width:480px', oncancel: (e) => { e.preventDefault(); done(null) } }, // Escape
      h('form', { onsubmit: (e) => { e.preventDefault(); done(value()) } }, body,
        h('p', {}, h('button', {}, yes), ' ', h('button', { type: 'button', onclick: () => done(null) }, 'Cancel'))))
    document.body.append(d)
    d.showModal()
  })
}

// A "…" button and its menu, floating under it (moves nothing): [[label, fn]].
function more (id, items) {
  const isOpen = menu === id
  return h('span', { 'data-menu': id, style: 'position:relative; display:inline-block' },
    h('button', { 'aria-label': 'More', 'aria-haspopup': 'menu', 'aria-expanded': String(isOpen), onclick: () => { menu = isOpen ? null : id; draw() } }, '…'),
    isOpen
      ? h('div', { role: 'menu', style: 'position:absolute; top:100%; right:0; z-index:10; margin-top:2px; padding:4px; display:flex; flex-direction:column; gap:2px; white-space:nowrap; background:var(--paper, Canvas); color:var(--ink, CanvasText); border:1px solid; box-shadow:2px 2px 0 var(--ink, CanvasText)' },
        items.map(([label, fn]) => h('button', { role: 'menuitem', style: 'text-align:left', onclick: () => { menu = null; draw(); fn() } }, label)))
      : null)
}

function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'value') el.value = v
    else el.setAttribute(k, v)
  }
  for (const x of children.flat(Infinity)) if (x !== null && x !== undefined && x !== false) el.append(x instanceof Node ? x : String(x))
  return el
}
