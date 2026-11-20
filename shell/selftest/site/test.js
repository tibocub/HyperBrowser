// The shell reads window.__results: no test-only API in the page.
const me = location.host
const params = new URLSearchParams(location.search)
const other = /** @type {string} */ (params.get('other')) // the shell always names one
const isStatic = params.has('static')
const meLine = /** @type {HTMLElement} */ (document.getElementById('me'))
meLine.textContent = (isStatic ? 'static ' : 'site ') + me.slice(0, 8)

/** @param {Promise<unknown>} p */
const refused = (p) => p.then(() => false, () => true)
/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const API = ['apps', 'circles', 'completeFrom', 'contacts', 'copies', 'count', 'createInvite', 'createSubspace', 'decisions', 'defineRole', 'del', 'edges',
  'edit', 'get', 'getByTag', 'getRole', 'info', 'instance', 'instances', 'isComplete', 'linked', 'members', 'mine', 'moderateAction', 'notifications', 'on', 'peers', 'people',
  'projects', 'put', 'query', 'redemptions', 'relate', 'removeRole', 'report', 'reports', 'revokeInvite', 'roles', 'rotateKey', 'secure', 'setRole',
  'since', 'status', 'subspace', 'subspaces', 'sum', 'tag', 'tags', 'trimHistory', 'types', 'unrelate', 'untag']

/** @type {Array<[string, () => Promise<unknown>]>} */
const common = [
  ['no Node: require/process/module/Buffer undefined', async () =>
    // @ts-expect-error: the check is that a page has none of these
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
    refused(fetch('hyper://' + other + '/test.js').then((r) => { if (!r.ok) throw new Error(String(r.status)) }))],
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
  ['wasm: WebAssembly.instantiateStreaming(fetch("add.wasm")) adds 2 + 3', async () =>
    /** @type {(a: number, b: number) => number} */ ((await WebAssembly.instantiateStreaming(fetch('add.wasm'))).instance.exports.add)(2, 3) === 5],
  ['wasm: WebAssembly.compile of bytes the page holds', async () => {
    const bytes = new Uint8Array(await (await fetch('add.wasm')).arrayBuffer())
    return /** @type {(a: number, b: number) => number} */ (new WebAssembly.Instance(await WebAssembly.compile(bytes)).exports.add)(40, 2) === 42
  }],
  ["wasm: another site's add.wasm is refused", () =>
    refused(WebAssembly.instantiateStreaming(fetch('hyper://' + other + '/add.wasm')))]
]

/** @type {Array<[string, () => Promise<unknown>]>} */
const statics = [
  ['a static site has no API: window.hyper is undefined', async () => typeof window.hyper === 'undefined']
]

const name = 'me-' + me.slice(0, 8)
const hyper = /** @type {Hyper.Site} */ (window.hyper) // a dynamic site's: only its checks below use it
/** @type {Array<[string, () => Promise<unknown>]>} */
const dynamics = [
  ['the site API is hypergraph\'s site handle, nothing more', async () =>
    Object.keys(hyper).sort().join() === API.join()],
  ['own space: info() names this site', async () => (await hyper.info()).key === me],
  ['own space: put then query reads it back, and only its own', async () => {
    await hyper.put('profile', { name })
    const { items } = await hyper.query('profile').latest(10)
    return items.length === 1 && items[0].name === name
  }],
  ['own space: a live view gets its record', () => new Promise((resolve) => {
    const stop = hyper.query('profile').live(({ items }) => {
      if (items.some((r) => r.name === name)) { stop(); resolve(true) }
    })
    setTimeout(() => resolve(false), 5000)
  })],
  ['the page names no space: hyper.subspace(<other site>) is refused', () =>
    refused(hyper.subspace(other).query('profile').latest(10))],
  ['the page names no space: hyper.instance(<other site>) is refused', () =>
    refused(hyper.instance(other).query('profile').latest(10))],
  ["contacts: a site whose site.json doesn't ask for them gets NOT_ALLOWED", () =>
    hyper.contacts.list().then(() => false, (err) => err.code === 'NOT_ALLOWED')],
  ["projects: a site whose site.json doesn't ask for them gets NOT_ALLOWED (spec 024)", () =>
    hyper.projects.list().then(() => false, (err) => err.code === 'NOT_ALLOWED')],
  ['people: opening a chat without a click opens nothing', async () => (await hyper.people.chat(other)) === false],
  ['people: a friend request the person refused is NOT_ALLOWED', () =>
    hyper.people.request(other, 'Someone').then(() => false, (err) => err.code === 'NOT_ALLOWED')],
  ['apps: installing a site without a click installs nothing', async () => (await hyper.apps.install(other)) === false],
  ['apps: opening a site without a click opens nothing', async () => (await hyper.apps.open(other)) === false],
  ['copies: hyper.subspace(<other site>).copies() is refused', () => refused(hyper.subspace(other).copies())],
  ['circles: joining without a click joins nothing', async () => (await hyper.circles.join('hg:x')).joined === false],
  ['its own instance: created, then reached', async () => {
    const f = await hyper.instances.create('Self-test ' + me.slice(0, 4))
    await hyper.instance(f.key).put('profile', { name })
    return (await hyper.instance(f.key).query('profile').latest(10)).items.some((r) => r.name === name)
  }]
]

;(async () => {
  /** @type {Array<{ site: string, name: string, pass: boolean }>} */
  const results = []
  for (const [label, fn] of [...common, ...(isStatic ? statics : dynamics)]) {
    let pass = false
    try { pass = !!(await fn()) } catch { pass = false }
    results.push({ site: me.slice(0, 8), name: label, pass })
    const li = document.createElement('li')
    li.className = pass ? 'pass' : 'fail'
    li.textContent = (pass ? 'PASS ' : 'FAIL ') + label
    const out = /** @type {HTMLElement} */ (document.getElementById('out'))
    out.append(li)
  }
  window.__results = results
})()
