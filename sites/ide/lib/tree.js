// No framework and nothing of the IDE's: the file manager will take a copy (a site loads only its own files).

/**
 * @typedef {{ name: string, path: string, folder: boolean, children: TreeNode[] }} TreeNode
 * @typedef {TreeNode & { level: number }} Shown
 * @typedef {[string, () => void] | null} MenuItem null: a separator
 */

/** @type {Record<string, string>} */
const ICON = {
  folder: '<path d="M1 3h4l1 1h5v7H1z" fill="var(--paper, Canvas)" stroke="currentColor"/>',
  open: '<path d="M1 3h4l1 1h5v2H3l-2 5z" fill="var(--paper, Canvas)" stroke="currentColor"/><path d="M3 6h9l-2 5H1z" fill="var(--paper, Canvas)" stroke="currentColor"/>',
  file: '<path d="M2.5 1.5h5l3 3v8h-8z" fill="var(--paper, Canvas)" stroke="currentColor"/><path d="M7.5 1.5v3h3" fill="none" stroke="currentColor"/>'
}

/**
 * The tree of a project's paths, folders first, by name.
 * @param {Array<{ path: string, folder?: boolean }>} items
 * @returns {TreeNode[]}
 */
export function nest (items) {
  /** @typedef {{ name?: string, path: string, folder: boolean, children: Map<string, Building> }} Building */
  /** @type {Building} */
  const root = { path: '', folder: true, children: new Map() }
  /** @param {string} path @param {boolean} folder */
  const at = (path, folder) => {
    let node = root
    const parts = path.split('/').filter(Boolean)
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join('/')
      const isFolder = i < parts.length - 1 || folder
      if (!node.children.has(name)) node.children.set(name, { name, path: p, folder: isFolder, children: new Map() })
      node = /** @type {Building} */ (node.children.get(name))
      if (isFolder) node.folder = true
    })
  }
  for (const it of items) at(it.path, !!it.folder)
  /** @param {Building} n @returns {TreeNode[]} */
  const order = (n) => [...n.children.values()]
    .sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : /** @type {string} */ (a.name).localeCompare(/** @type {string} */ (b.name))))
    .map((c) => ({ name: /** @type {string} */ (c.name), path: c.path, folder: c.folder, children: c.folder ? order(c) : [] }))
  return order(root)
}

/**
 * A file tree in `el`: keys as WAI-ARIA's tree, a right-click (or Shift+F10) menu, rename in place.
 * @param {HTMLElement} el
 * @param {object} [opts]
 * @param {string} [opts.label]
 * @param {(path: string) => void} [opts.open] a file chosen
 * @param {((from: string, to: string) => Promise<unknown>) | null} [opts.rename]
 * @param {(path: string | null, kind: string | null) => MenuItem[]} [opts.menu]
 * @param {(path: string) => string} [opts.mark] git's mark for a path, or ''
 */
export function fileTree (el, { label = 'Files', open = () => {}, rename = null, menu = () => [], mark = () => '' } = {}) {
  /** @type {TreeNode[]} */
  let nodes = []
  /** @type {string | null} */
  let selected = null
  /** @type {string | null} */
  let renaming = null
  /** @type {string | null} */
  let focused = null
  /** @type {Set<string>} */
  const expanded = new Set()
  // divs, not ul/li: the theme's list style (a bullet, text-indent: -2ch) cut the names' first letters
  const list = document.createElement('div')
  list.setAttribute('role', 'tree')
  list.setAttribute('aria-label', label)
  list.style.cssText = 'margin:0; padding:2px 0; min-height:100%; box-sizing:border-box; outline:none'
  el.replaceChildren(list)
  list.addEventListener('contextmenu', (e) => {
    if (/** @type {Element} */ (e.target).closest('input')) return
    e.preventDefault()
    const row = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[role=treeitem]'))
    if (row) choose(/** @type {string} */ (row.dataset.path), false)
    showMenu(row ? /** @type {string} */ (row.dataset.path) : null, row ? /** @type {string} */ (row.dataset.kind) : null, e.clientX, e.clientY)
  })

  /** @param {TreeNode[]} [list] @param {Shown[]} [out] @returns {Shown[]} */
  function visible (list = nodes, level = 1, out = []) {
    for (const n of list) {
      out.push({ ...n, level })
      if (n.folder && expanded.has(n.path)) visible(n.children, level + 1, out)
    }
    return out
  }

  function draw () {
    const rows = visible()
    if (!rows.some((r) => r.path === focused)) focused = rows.find((r) => r.path === selected)?.path ?? rows[0]?.path ?? null
    list.replaceChildren(...rows.map(row))
    if (!rows.length) list.append(Object.assign(document.createElement('div'), { textContent: 'No files yet.', style: 'padding:2px 8px; opacity:.7' }))
    const field = list.querySelector('input')
    if (field) { field.focus(); field.setSelectionRange(0, field.value.lastIndexOf('.') > 0 ? field.value.lastIndexOf('.') : field.value.length) }
  }

  /** @param {Shown} r */
  function row (r) {
    const li = document.createElement('div')
    li.setAttribute('role', 'treeitem')
    li.dataset.path = r.path
    li.dataset.kind = r.folder ? 'folder' : 'file'
    li.setAttribute('aria-level', String(r.level))
    li.setAttribute('aria-selected', String(r.path === selected))
    if (r.folder) li.setAttribute('aria-expanded', String(expanded.has(r.path)))
    li.tabIndex = r.path === focused ? 0 : -1
    const on = r.path === selected
    // rows, not buttons: no press shift, so nothing ever covers the row below
    li.style.cssText = `display:flex; align-items:center; gap:4px; padding:1px 8px 1px ${4 + (r.level - 1) * 14}px; cursor:default; white-space:nowrap;` +
      (on ? ' background:var(--ink, CanvasText); color:var(--paper, Canvas);' : '')
    const twisty = document.createElement('span')
    twisty.textContent = r.folder ? (expanded.has(r.path) ? '▾' : '▸') : ''
    twisty.style.cssText = 'width:1ch; flex:none'
    twisty.setAttribute('aria-hidden', 'true')
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 13 13')
    icon.setAttribute('width', '13')
    icon.setAttribute('height', '13')
    icon.setAttribute('aria-hidden', 'true')
    icon.style.cssText = 'flex:none; shape-rendering:crispEdges'
    icon.innerHTML = ICON[r.folder ? (expanded.has(r.path) ? 'open' : 'folder') : 'file']
    li.append(twisty, icon)
    if (renaming === r.path) {
      const field = document.createElement('input')
      field.value = r.name
      field.setAttribute('aria-label', 'New name for ' + r.name)
      field.style.cssText = 'flex:1; min-width:0; padding:0 4px; font:inherit'
      /** @param {boolean} commit */
      const done = async (commit) => {
        if (renaming !== r.path) return
        renaming = null
        const name = field.value.trim()
        if (commit && name && name !== r.name && !name.includes('/')) {
          const to = r.path.slice(0, r.path.length - r.name.length) + name
          try { await /** @type {NonNullable<typeof rename>} */ (rename)(r.path, to) } catch { draw(); return }
        } else draw()
        const now = /** @type {HTMLElement | null} */ (list.querySelector('[tabindex="0"]'))
        now?.focus()
      }
      field.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); done(true) }
        if (e.key === 'Escape') { e.preventDefault(); done(false) }
      })
      field.addEventListener('blur', () => done(true))
      li.append(field)
    } else {
      const name = document.createElement('span')
      name.textContent = r.name
      name.style.cssText = 'flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis'
      li.title = r.path
      li.append(name)
      const m = mark(r.path)
      if (m) li.append(Object.assign(document.createElement('span'), { textContent: ' ' + m, title: 'Changed since the last git commit' }))
    }
    li.addEventListener('click', (e) => {
      if (/** @type {Element} */ (e.target).closest('input')) return
      if (r.folder) toggle(r.path)
      choose(r.path, !r.folder)
    })
    li.addEventListener('keydown', key)
    return li
  }

  /** @param {string} path @param {boolean} opening */
  function choose (path, opening) {
    selected = path
    focused = path
    draw()
    const now = /** @type {HTMLElement | null} */ (list.querySelector(`[data-path="${CSS.escape(path)}"]`))
    now?.focus()
    if (opening) open(path)
  }

  /** @param {string} path */
  function toggle (path) {
    if (expanded.has(path)) expanded.delete(path)
    else expanded.add(path)
  }

  // WAI-ARIA tree keys: Up, Down, Home, End, Right (open, then into), Left (close, then up), Enter, F2, the menu.
  /** @param {KeyboardEvent} e */
  function key (e) {
    const rows = visible()
    const i = rows.findIndex((r) => r.path === /** @type {HTMLElement} */ (e.currentTarget).dataset.path)
    const r = rows[i]
    /** @param {number} j */
    const go = (j) => { if (rows[j]) { focused = rows[j].path; draw(); /** @type {HTMLElement | null} */ (list.querySelector('[tabindex="0"]'))?.focus() } }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(rows.length - 1)
    else if (e.key === 'ArrowRight' && r.folder) { if (!expanded.has(r.path)) { expanded.add(r.path); go(i) } else go(i + 1) }
    else if (e.key === 'ArrowLeft') {
      if (r.folder && expanded.has(r.path)) { expanded.delete(r.path); go(i) } else if (r.path.includes('/')) go(rows.findIndex((x) => x.path === r.path.slice(0, r.path.lastIndexOf('/'))))
    } else if (e.key === 'Enter' || e.key === ' ') { if (r.folder) toggle(r.path); choose(r.path, !r.folder) }
    else if (e.key === 'F2' && rename) startRename(r.path)
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      choose(r.path, false)
      const box = /** @type {Element} */ (list.querySelector('[tabindex="0"]')).getBoundingClientRect()
      showMenu(r.path, r.folder ? 'folder' : 'file', box.left + 24, box.bottom)
    } else return
    e.preventDefault()
  }

  /** @param {string} path */
  function startRename (path) {
    renaming = path
    draw()
  }

  /** @param {string | null} path @param {string | null} kind @param {number} x @param {number} y */
  function showMenu (path, kind, x, y) {
    const items = menu(path, kind)
    if (!items.length) return
    const back = /** @type {HTMLElement | null} */ (document.activeElement)
    const box = document.createElement('div')
    box.setAttribute('role', 'menu')
    box.setAttribute('aria-label', path ? 'Actions for ' + path : 'Actions')
    box.style.cssText = 'position:fixed; z-index:1000; padding:4px; display:flex; flex-direction:column; gap:2px; white-space:nowrap; background:var(--paper, Canvas); color:var(--ink, CanvasText); border:1px solid; box-shadow:2px 2px 0 var(--ink, CanvasText)'
    const close = (refocus = true) => {
      box.remove()
      document.removeEventListener('mousedown', outside, true)
      if (refocus) back?.focus?.()
    }
    /** @param {MouseEvent} e */
    const outside = (e) => { if (!box.contains(/** @type {Node | null} */ (e.target))) close(false) }
    for (const it of items) {
      if (!it) { box.append(Object.assign(document.createElement('hr'), { style: 'margin:2px 0; border:0; border-top:1px solid' })); continue }
      const b = document.createElement('button')
      b.setAttribute('role', 'menuitem')
      b.textContent = it[0]
      b.style.cssText = 'text-align:left'
      b.addEventListener('click', () => { close(); it[1]() })
      box.append(b)
    }
    box.addEventListener('keydown', (e) => {
      const all = [.../** @type {NodeListOf<HTMLElement>} */ (box.querySelectorAll('[role=menuitem]'))]
      const i = all.indexOf(/** @type {HTMLElement} */ (document.activeElement))
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus() }
    })
    document.body.append(box)
    const w = box.offsetWidth
    const h = box.offsetHeight
    box.style.left = Math.max(0, Math.min(x, innerWidth - w - 4)) + 'px'
    box.style.top = Math.max(0, Math.min(y, innerHeight - h - 4)) + 'px'
    document.addEventListener('mousedown', outside, true)
    const first = /** @type {HTMLElement} */ (box.querySelector('[role=menuitem]'))
    first.focus()
  }

  return {
    /** @param {Array<{ path: string, folder?: boolean }>} items */
    set (items) { nodes = nest(items); if (!renaming) draw() }, // a rename being typed stays as it is
    /** @param {string | null} path */
    select (path) {
      selected = path
      focused = path ?? focused
      const parts = path ? path.split('/') : []
      for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'))
      draw()
    },
    rename: startRename,
    get selected () { return selected },
    expanded
  }
}
