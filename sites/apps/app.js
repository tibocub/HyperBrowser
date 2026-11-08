// Apps' page (spec 014): the store's `app` entries (written by its owner with `npm run apps:publish`), each with
// Install or Open. Installing goes through HyperBrowser (hyper.apps): a click here, then the person's yes in
// HyperBrowser's own dialog. No stylesheet: HyperBrowser's default theme.

const hyper = window.hyper
const root = document.getElementById('app')
let apps = []
const installed = new Map() // key -> boolean
let notice = ''

if (!hyper) root.replaceChildren(h('p', {}, 'Open Apps in HyperBrowser.'))
else {
  hyper.query('app').live(({ items }) => {
    apps = items.slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.title).localeCompare(b.title))
    refresh()
  })
}

async function refresh () {
  for (const a of apps) installed.set(a.key, await hyper.apps.installed(a.key).catch(() => false))
  draw()
}

async function act (fn) {
  notice = ''
  try { await fn() } catch (err) { notice = (err.code === 'NOT_ALLOWED' ? 'Not installed: ' : '') + err.message }
  await refresh()
}

function draw () {
  root.replaceChildren(h('div', { style: 'max-width:720px; margin:0 auto; padding:8px' },
    h('h1', {}, 'Apps'),
    notice ? h('p', { role: 'alert' }, notice) : null,
    apps.length ? null : h('p', {}, 'No apps listed yet (or nobody who has the list is online).'),
    h('ul', { style: 'list-style:none; padding:0' }, apps.map((a) => h('li', { style: 'display:flex; gap:12px; align-items:center; margin:12px 0' },
      String(a.icon).startsWith('data:image/') ? h('img', { src: a.icon, alt: '', width: 32, height: 32, style: 'image-rendering:pixelated; flex:none' }) : h('span', { style: 'width:32px; flex:none' }),
      h('div', { style: 'flex:1; min-width:0' }, h('b', {}, a.title), h('br'), h('span', { class: 'small' }, a.about || '')),
      installed.get(a.key)
        ? h('button', { onclick: () => act(() => hyper.apps.open(a.key)) }, 'Open')
        : h('button', { onclick: () => act(() => hyper.apps.install(a.key)) }, 'Install'))))))
}

function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v)
  }
  for (const x of children.flat(Infinity)) if (x !== null && x !== undefined && x !== false) el.append(x instanceof Node ? x : String(x))
  return el
}
