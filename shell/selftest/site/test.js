// Runs in each site's view: what it must reach (its own space, if dynamic; WebAssembly) and must not (Node,
// files, the other site, the web). The shell reads window.__results (no test-only API in the page).
const me = location.host
const params = new URLSearchParams(location.search)
const other = params.get('other')
const isStatic = params.has('static')
document.getElementById('me').textContent = (isStatic ? 'static ' : 'site ') + me.slice(0, 8)

const refused = (p) => p.then(() => false, () => true)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// mine: the person's own data for this site (spec 006), on their settings, not a space
// instance, instances: the app's instances (spec 009), checked by the engine
// contacts (only with the permission), people: through HyperBrowser (spec 013); apps: the same (spec 014)
const API = ['apps', 'completeFrom', 'contacts', 'count', 'createInvite', 'createSubspace', 'decisions', 'defineRole', 'del', 'edges',
  'edit', 'get', 'getByTag', 'getRole', 'info', 'instance', 'instances', 'isComplete', 'linked', 'members', 'mine', 'moderateAction', 'on', 'peers', 'people',
  'put', 'query', 'redemptions', 'relate', 'removeRole', 'report', 'reports', 'revokeInvite', 'roles', 'setRole',
  'status', 'subspace', 'subspaces', 'sum', 'tag', 'tags', 'types', 'unrelate', 'untag']

const common = [
  ['no Node: require/process/module/Buffer undefined', async () =>
    [typeof require, typeof process, typeof module, typeof Buffer].every((t) => t === 'undefined')],
  ['no file system: fetch file:///C:/Windows/win.ini', () => refused(fetch('file:///C:/Windows/win.ini'))],
  ['no file system: fetch file:///etc/hostname', () => refused(fetch('file:///etc/hostname'))],
  ['no file system: an iframe of file:// shows nothing', async () => {
    const f = document.createElement('iframe')
    f.src = 'file:///C:/Windows/win.ini'
    document.body.append(f)
    await wait(1000)
    let blank
    try { blank = !f.contentDocument || !f.contentDocument.body.textContent } catch { blank = true }
    f.remove()
    return blank
  }],
  ["other site's files: fetch hyper://<other>/test.js", () =>
    refused(fetch('hyper://' + other + '/test.js').then((r) => { if (!r.ok) throw new Error(r.status) }))],
  ["other site's files: <script src=hyper://<other>/probe.js> doesn't run", async () => {
    const el = document.createElement('script')
    el.src = 'hyper://' + other + '/probe.js'
    document.body.append(el)
    await wait(1000)
    return window.leaked === undefined
  }],
  ['no web: fetch https://example.com', () => refused(fetch('https://example.com'))],
  ['no web: <img src=https://...> fails to load (needs internet to mean anything)', () => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(false)
    img.onerror = () => resolve(true)
    img.src = 'https://www.google.com/favicon.ico?' + Math.random()
  })],
  ["other site's storage: localStorage holds only this site's keys", async () => {
    localStorage.setItem('secret-' + me, '1')
    await wait(1500) // the other views have written theirs by now
    return Object.keys(localStorage).every((k) => k === 'secret-' + me)
  }],
  ["other site's cookies: document.cookie holds only this site's", async () => {
    const mine = 'c' + me.slice(0, 6)
    document.cookie = mine + '=1; path=/'
    await wait(500)
    return document.cookie.split('; ').filter(Boolean).every((c) => c.startsWith(mine + '='))
  }],
  ['its own files load: fetch probe.js from its own site', async () => (await fetch('probe.js')).ok],
  // WebAssembly (spec 008): it compiles and runs, in the page's sandbox (the checks above still hold for it)
  ['wasm: WebAssembly.instantiateStreaming(fetch("add.wasm")) adds 2 + 3', async () =>
    (await WebAssembly.instantiateStreaming(fetch('add.wasm'))).instance.exports.add(2, 3) === 5],
  ['wasm: WebAssembly.compile of bytes the page holds', async () => {
    const bytes = new Uint8Array(await (await fetch('add.wasm')).arrayBuffer())
    return new WebAssembly.Instance(await WebAssembly.compile(bytes)).exports.add(40, 2) === 42
  }],
  ["wasm: another site's add.wasm is refused", () =>
    refused(WebAssembly.instantiateStreaming(fetch('hyper://' + other + '/add.wasm')))]
]

const statics = [
  ['a static site has no API: window.hyper is undefined', async () => typeof window.hyper === 'undefined']
]

const name = 'me-' + me.slice(0, 8)
const dynamics = [
  ['the site API is hypergraph\'s site handle, nothing more', async () =>
    Object.keys(window.hyper).sort().join() === API.join()],
  ['own space: info() names this site', async () => (await window.hyper.info()).key === me],
  ['own space: put then query reads it back, and only its own', async () => {
    await window.hyper.put('profile', { name })
    const { items } = await window.hyper.query('profile').latest(10)
    return items.length === 1 && items[0].name === name
  }],
  ['own space: a live view gets its record', () => new Promise((resolve) => {
    const stop = window.hyper.query('profile').live(({ items }) => {
      if (items.some((r) => r.name === name)) { stop(); resolve(true) }
    })
    setTimeout(() => resolve(false), 5000)
  })],
  ['the page names no space: hyper.subspace(<other site>) is refused', () =>
    refused(window.hyper.subspace(other).query('profile').latest(10))],
  ['the page names no space: hyper.instance(<other site>) is refused', () =>
    refused(window.hyper.instance(other).query('profile').latest(10))],
  ["contacts: a site whose site.json doesn't ask for them gets NOT_ALLOWED", () =>
    window.hyper.contacts.list().then(() => false, (err) => err.code === 'NOT_ALLOWED')],
  ['people: opening a chat without a click opens nothing', async () => (await window.hyper.people.chat(other)) === false],
  ['people: a friend request the person refused is NOT_ALLOWED', () =>
    window.hyper.people.request(other, 'Someone').then(() => false, (err) => err.code === 'NOT_ALLOWED')],
  ['apps: installing a site without a click installs nothing', async () => (await window.hyper.apps.install(other)) === false], // spec 014
  ['apps: opening a site without a click opens nothing', async () => (await window.hyper.apps.open(other)) === false],
  ['its own instance: created, then reached', async () => {
    const f = await window.hyper.instances.create('Self-test ' + me.slice(0, 4))
    await window.hyper.instance(f.key).put('profile', { name })
    return (await window.hyper.instance(f.key).query('profile').latest(10)).items.some((r) => r.name === name)
  }]
]

;(async () => {
  const results = []
  for (const [label, fn] of [...common, ...(isStatic ? statics : dynamics)]) {
    let pass = false
    try { pass = !!(await fn()) } catch { pass = false }
    results.push({ site: me.slice(0, 8), name: label, pass })
    const li = document.createElement('li')
    li.className = pass ? 'pass' : 'fail'
    li.textContent = (pass ? 'PASS ' : 'FAIL ') + label
    document.getElementById('out').append(li)
  }
  window.__results = results
})()
