// Projects (spec 024): a folder on disk backed by a private SwarmFS files space, read by its members only (the
// person's devices, co-authors). Saving syncs, never publishes; Publish copies the project into its site's pages
// as one version, kept on this device (specs/024-site-files/plan.md). A page reaches it with the `projects`
// permission only; every path stays inside the project folder.
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import { compile, ignored } from 'swarmfs/lib/ignore.js'
import { parseManifest, readManifest, sitePath } from './manifest.js'

const LIST = 'hyperbrowser/projects' // setting: { [space key]: { name } }, on every device of the person
const PROJECT = '.hyperbrowser.json' // in the project: { site }, synced, never published
const IGNORE = '.swarmfsignore' // SwarmFS's ignore file, also what Publish skips
const ALWAYS = ['.git/', 'node_modules/'] // D4: each device keeps its own
const NAME_MAX = 64
const WRITE_MAX = 32 * 1024 * 1024 // one write crossing from a page
const CATCH_UP = 60000 // a device publishing for the first time waits this long for the pages already there
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i // Windows device names

const error = (code, message) => Object.assign(new Error(message), { code })

// A hard link (versions never change once made); a copy where links fail (another drive, FAT).
export async function linkOrCopy (from, to, link = fs.promises.link) {
  try {
    await link(from, to)
  } catch {
    await fs.promises.copyFile(from, to)
  }
}

// sfs: the engine's SwarmFS; dir: its folder; root: where new projects go; visit(key): a site held or visited;
// tell(identity, text): a message to a friend (contacts); forget(key): the engine drops an open site (a draft reset).
export function projects ({ sfs, dir, root, visit, tell, forget }) {
  const hg = sfs.hg
  const me = hg.identity.publicKey
  const DRAFTS = path.join(dir, 'drafts.json') // this device's: { [project]: draft site key }
  let drafts = {}
  const folders = new Map() // draft key -> the project folder it shows
  const watched = new Set() // projects whose members this device follows (site owner: grants admin)
  let queue = Promise.resolve() // list writes, links and publishes, one at a time
  let following = Promise.resolve()
  let closed = false

  const one = (fn) => {
    const run = queue.then(fn)
    queue = run.catch(() => {})
    return run
  }
  const all = async () => (await hg.settings())[LIST] || {}
  const onChange = () => { follow().catch(() => {}) }

  async function start () {
    try { drafts = JSON.parse(await fs.promises.readFile(DRAFTS, 'utf-8')) } catch {}
    for (const [project, key] of Object.entries(drafts)) {
      const folder = await folderOf(project)
      if (folder) folders.set(key, folder)
    }
    hg.on('settings', onChange)
    hg.on('spaces', onChange)
    await follow()
  }

  // Every project of the person held here: linked to a folder of this device, and its members followed.
  function follow () {
    following = following.then(async () => {
      for (const [key, { name }] of Object.entries(await all())) {
        if (closed || !held(key)) continue
        if (!(await folderOf(key))) await one(() => attach(key, name)).catch(() => {}) // again at the next 'spaces' or 'settings'
        if (!watched.has(key)) {
          watched.add(key)
          hg.space(key).on('members', () => { grant(key).catch(() => {}) })
        }
        await grant(key).catch(() => {})
      }
    })
    return following
  }

  function held (key) {
    try { hg.space(key); return true } catch { return false }
  }

  async function folderOf (key) {
    return (await sfs.links()).find((l) => l.space === key && l.folder === key)?.path || null
  }

  // The project's space linked to a new folder under `root` (its name, made unique).
  async function attach (key, name) {
    if (await folderOf(key)) return
    const base = path.join(root, safe(name))
    let folder = base
    for (let n = 2; await taken(folder); n++) folder = `${base} (${n})`
    await fs.promises.mkdir(folder, { recursive: true })
    await ensureIgnore(folder)
    await hg.space(key).ready() // a space joined on another device stays closed until used (hypergraph 015); SwarmFS's link needs it open
    await sfs.space(key).link(key, folder)
  }

  async function taken (folder) {
    try { return (await fs.promises.readdir(folder)).length > 0 } catch { return false }
  }

  // Before every link: SwarmFS reads the rules when it starts following the folder.
  async function ensureIgnore (folder) {
    const file = path.join(folder, IGNORE)
    let text = ''
    try { text = await fs.promises.readFile(file, 'utf-8') } catch {}
    const lines = text.split(/\r?\n/).map((l) => l.trim())
    const missing = ALWAYS.filter((l) => !lines.includes(l))
    if (missing.length) await fs.promises.writeFile(file, missing.join('\n') + '\n' + text)
  }

  async function remember (key, name) {
    const list = await all()
    await hg.setSetting(LIST, { ...list, [key]: { name } })
  }

  // --- the page's calls ---

  async function call (method, [a, b, c]) {
    switch (method) {
      case 'list': return list()
      case 'create': return one(() => create(a))
      case 'openFolder': return one(() => openFolder(a))
      case 'openCopy': return openCopy(a)
      case 'join': return join(a)
      case 'files': return files(await project(a))
      case 'read': return readFile(await project(a), b)
      case 'write': return writeFile(await project(a), b, c)
      case 'rename': return rename(await project(a), b, c)
      case 'remove': return remove(await project(a), b)
      case 'publish': return one(() => publish(a))
      case 'versions': return versions(await project(a))
      case 'rollBack': return one(() => rollBack(a, b))
      case 'preview': return one(() => preview(a))
      case 'resetPreview': return one(() => preview(a, true))
      case 'invite': return invite(a)
      case 'inviteContact': return tell(b, `Edit "${(await all())[a]?.name}" with me in HyperBrowser: ${(await invite(a)).link}`)
      case 'members': await project(a); return sfs.space(a).members()
      case 'removeMember':
        await project(a)
        await sfs.space(a).removeMember(b)
        await grant(a)
        return true
      default: throw error('UNKNOWN_METHOD', 'no projects.' + method)
    }
  }

  async function list () {
    const out = []
    for (const [key, { name }] of Object.entries(await all())) {
      if (!held(key)) continue
      const folder = await folderOf(key)
      out.push({ key, name, folder, site: folder ? await siteKeyOf(folder) : null, role: await hg.space(key).getRole(me).catch(() => null) })
    }
    return out
  }

  async function view (key) {
    return (await list()).find((p) => p.key === key)
  }

  // A project of the person's, on this device: its folder.
  async function project (key) {
    if (typeof key !== 'string' || !KEY.test(key) || !(key in await all())) throw error('NOT_FOUND', 'not one of your projects')
    const folder = await folderOf(key)
    if (!folder) throw error('NOT_FOUND', 'this project is not on this device yet')
    return folder
  }

  async function create (name) {
    if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX) throw error('INVALID_PARAMS', `a project's name is 1 to ${NAME_MAX} characters`)
    const drive = await sfs.createSpace(name.trim())
    await remember(drive.key, name.trim())
    await attach(drive.key, name.trim())
    return view(drive.key)
  }

  // The folder the person picked (the shell's dialog: a page never names a path), as it is.
  async function openFolder (folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw error('INVALID_PARAMS', 'openFolder needs a folder')
    const full = path.resolve(folder)
    if (!(await fs.promises.stat(full).catch(() => null))?.isDirectory()) throw error('NOT_FOUND', 'no such folder')
    await sfs._overlaps(full) // EXISTS: already a project, or inside a synced folder
    const name = path.basename(full).slice(0, NAME_MAX) || 'Project'
    const drive = await sfs.createSpace(name)
    await ensureIgnore(full)
    await drive.link(drive.key, full) // its files are added as they are
    await remember(drive.key, name)
    return view(drive.key)
  }

  // A site's published files as a new project (no data, no site key: publishing it makes a new site).
  async function openCopy (key) {
    if (typeof key !== 'string' || !KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
    const site = await visit(key)
    const title = parseManifest(await site.read('site.json')).title
    const pages = []
    const walk = async (id, prefix) => {
      const { items } = await site.pages.list(id, { limit: Infinity, timeout: 10000 })
      for (const e of items) {
        if (e.kind === 'folder') await walk(e.id, prefix + e.name + '/')
        else pages.push(prefix + e.name)
      }
    }
    await walk(site.pages.top, '')
    const bytes = []
    for (const p of pages) if (sitePath(p)) bytes.push([p, await site.read(p)])
    const made = await one(() => create(`${title} (copy)`.slice(0, NAME_MAX)))
    for (const [p, b] of bytes) { // a page the project would never sync (.git/hooks/...): left out
      await writeFile(made.folder, p, b).catch((err) => { if (err.code !== 'NOT_ALLOWED') throw err })
    }
    return made
  }

  // A co-author's invite: a private files space (never a site or a circle, whose links have one use).
  async function join (link) {
    if (typeof link !== 'string' || !link.startsWith('hg:')) throw error('INVALID_PARAMS', "join takes a project's invite (hg:...)")
    const before = new Set(hg.spaces().map((x) => x.key))
    const drive = await sfs.join(link)
    const space = hg.space(drive.key)
    await space.ready()
    const site = await sfs.site(drive.key, { timeout: 0 }).then(() => true, () => false)
    if (!space.private || space.circle || site) {
      if (!before.has(drive.key)) await sfs.leave(drive.key).catch(() => {})
      throw error('NOT_ALLOWED', "that link is not a project's invite")
    }
    await one(async () => {
      await remember(drive.key, space.name || 'Project')
      await attach(drive.key, space.name || 'Project')
    })
    return view(drive.key)
  }

  async function invite (key) {
    await project(key)
    return { link: await sfs.space(key).invite({ role: 'editor' }) }
  }

  // --- files: every path checked ---

  // `p` inside `folder`: a clean relative path (no '..', no absolute path, no Windows short name like GIT~1, nothing
  // Windows reads otherwise), one the project syncs (never .git: git runs its hooks outside the sandbox; nor
  // node_modules or what the ignore file lists), and no link on the way out of the folder. Checked again on the path
  // as the disk resolves it (a link inside the project to its .git). `write`: not .hyperbrowser.json either.
  async function inside (folder, p, write = false) {
    const clean = typeof p === 'string' && !p.startsWith('/') ? sitePath(p) : null
    if (!clean || clean.split('/').some((s) => s === '.' || s.includes(':') || RESERVED.test(s) || /[. ]$/.test(s) || /~\d/.test(s))) throw error('INVALID_PATH', 'not a path inside the project: ' + JSON.stringify(p))
    await syncs(folder, clean, write)
    const real = await realpath(folder)
    const full = path.join(real, ...clean.split('/'))
    let probe = full
    let r
    for (;;) {
      try { r = await realpath(probe); break } catch {} // not there yet: its parent
      probe = path.dirname(probe)
    }
    if (r !== real && !r.startsWith(real + path.sep)) throw error('NOT_ALLOWED', 'that path leads out of the project')
    const resolved = path.relative(real, path.join(r, path.relative(probe, full))).split(path.sep).join('/')
    if (resolved !== clean) await syncs(folder, resolved, write)
    return full
  }

  // NOT_ALLOWED unless the project syncs `rel` (and, `write`, it isn't .hyperbrowser.json).
  async function syncs (folder, rel, write) {
    const lower = rel.toLowerCase() // Windows and macOS: .GIT is .git
    const rules = await rulesOf(folder)
    if (lower.split('/').some((s) => s === '.git' || s === 'node_modules') || [rel, lower].some((x) => ignored(rules, x, false) || ignored(rules, x, true))) {
      throw error('NOT_ALLOWED', 'the project does not sync ' + rel + ': a page may not reach it')
    }
    if (write && lower === PROJECT) throw error('NOT_ALLOWED', PROJECT + ' is written by HyperBrowser only')
  }

  async function rulesOf (folder) {
    return compile(await fs.promises.readFile(path.join(folder, IGNORE), 'utf-8').catch(() => ''))
  }

  // The ignore file changed by a page: .git/ and node_modules/ stay in it.
  async function kept (folder, ...paths) {
    if (paths.some((p) => p.toLowerCase() === IGNORE)) await ensureIgnore(folder)
  }

  async function files (folder) {
    const rules = await rulesOf(folder)
    const out = []
    const walk = async (d) => {
      for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        const rel = path.relative(folder, full).split(path.sep).join('/')
        if (ignored(rules, rel, e.isDirectory())) continue
        if (e.isDirectory()) await walk(full)
        else if (e.isFile()) {
          const st = await fs.promises.stat(full)
          out.push({ path: rel, size: st.size, mtime: st.mtimeMs })
        }
      }
    }
    await walk(folder)
    return out
  }

  async function readFile (folder, p) {
    const full = await inside(folder, p)
    if (!(await fs.promises.stat(full).catch(() => null))?.isFile()) throw error('NOT_FOUND', 'no file ' + p)
    return fs.promises.readFile(full)
  }

  async function writeFile (folder, p, data) {
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) throw error('INVALID_PARAMS', 'write takes text or bytes')
    if (data.length > WRITE_MAX) throw error('TOO_BIG', `at most ${WRITE_MAX} bytes a write`)
    const full = await inside(folder, p, true)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    await fs.promises.writeFile(full, data)
    await kept(folder, p)
    return true
  }

  async function rename (folder, from, to) {
    const a = await inside(folder, from, true)
    const b = await inside(folder, to, true)
    if (!(await fs.promises.stat(a).catch(() => null))) throw error('NOT_FOUND', 'no file ' + from)
    if (await fs.promises.stat(b).catch(() => null)) throw error('EXISTS', to + ' is there already')
    await fs.promises.mkdir(path.dirname(b), { recursive: true })
    await fs.promises.rename(a, b)
    await kept(folder, from, to)
    return true
  }

  // A file, or a folder with what the project syncs in it (what it ignores stays, e.g. a nested .git). A link is
  // unlinked, never followed.
  async function remove (folder, p) {
    const full = await inside(folder, p, true)
    if (!(await fs.promises.lstat(full).catch(() => null))) throw error('NOT_FOUND', 'no file ' + p)
    const rules = await rulesOf(folder)
    const rm = async (at) => {
      const st = await fs.promises.lstat(at)
      if (st.isSymbolicLink()) return fs.promises.rmdir(at).catch(() => fs.promises.unlink(at)) // a junction is a folder link
      if (!st.isDirectory()) return fs.promises.unlink(at)
      for (const e of await fs.promises.readdir(at)) {
        const child = path.join(at, e)
        const rel = path.relative(folder, child).split(path.sep).join('/')
        const lower = rel.toLowerCase()
        if (lower.split('/').some((s) => s === '.git' || s === 'node_modules') || ignored(rules, rel, true) || ignored(rules, rel, false)) continue
        await rm(child)
      }
      if (!(await fs.promises.readdir(at)).length) await fs.promises.rmdir(at)
    }
    await rm(full)
    await kept(folder, p)
    return true
  }

  // --- publish and versions ---

  async function siteKeyOf (folder) {
    try {
      const key = JSON.parse(await fs.promises.readFile(path.join(folder, PROJECT), 'utf-8')).site
      return typeof key === 'string' && KEY.test(key) ? key : null
    } catch { return null }
  }

  // What Publish takes from the project: everything synced, but the project's own files.
  async function publishable (folder) {
    return (await files(folder)).map((f) => f.path).filter((p) => p !== IGNORE && p !== PROJECT)
  }

  async function publish (key) {
    const folder = await project(key)
    const manifest = await readManifest(folder) // a broken site.json: refused before anything is written
    const known = await siteKeyOf(folder)
    const tmp = await snapshot(folder, await publishable(folder), false, known && await newest(known))
    try {
      const { site, created } = await siteFor(folder, manifest)
      const version = await keep(site.key, tmp)
      await toPages(site, created, path.join(dir, 'versions', site.key, String(version)))
      if (created) await grant(key)
      return { site: site.key, created, version }
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true })
    }
  }

  // The project's site, made on its first Publish; the person must be its owner or an admin (a co-author).
  async function siteFor (folder, manifest) {
    const known = await siteKeyOf(folder)
    if (!known) {
      const site = await sfs.createSite(manifest.title, { types: manifest.types })
      if (manifest.public !== false) await site.makePublic()
      await fs.promises.writeFile(path.join(folder, PROJECT), JSON.stringify({ site: site.key }, null, 2) + '\n')
      return { site, created: true }
    }
    const site = await visit(known)
    const role = await site.space.getRole(me)
    if (role !== 'owner' && role !== 'admin') throw error('NOT_ALLOWED', "only the site's owner and its co-authors publish it")
    if (manifest.public !== false && !site.isPublic) throw error('PRIVATE_SITE', `this project's site (${known}) is invite-only and site.json doesn't say "public": false`)
    if (manifest.types) await site.declareTypes(manifest.types)
    return { site, created: false }
  }

  // `list` files of `from` in a new folder: copied, or hard links (`link`: `from` is a version, never changed; or
  // equal to the file of the newest version `last`).
  async function snapshot (from, list, link, last) {
    const tmp = path.join(dir, 'versions', '.new')
    await fs.promises.rm(tmp, { recursive: true, force: true })
    await fs.promises.mkdir(tmp, { recursive: true })
    for (const p of list) {
      const src = path.join(from, ...p.split('/'))
      const to = path.join(tmp, ...p.split('/'))
      await fs.promises.mkdir(path.dirname(to), { recursive: true })
      const same = last && path.join(last, ...p.split('/'))
      if (link) await linkOrCopy(src, to)
      else if (same && await equal(src, same)) await linkOrCopy(same, to)
      else await fs.promises.copyFile(src, to)
    }
    return tmp
  }

  // The snapshot as the site's next version.
  async function keep (site, tmp) {
    const base = path.join(dir, 'versions', site)
    await fs.promises.mkdir(base, { recursive: true })
    const n = ((await numbers(base))[0] || 0) + 1
    await fs.promises.rename(tmp, path.join(base, String(n)))
    return n
  }

  // The newest version's folder here, or null.
  async function newest (site) {
    const base = path.join(dir, 'versions', site)
    const n = (await numbers(base))[0]
    return n ? path.join(base, String(n)) : null
  }

  async function numbers (base) {
    const names = await fs.promises.readdir(base).catch(() => [])
    return names.filter((n) => /^[1-9]\d*$/.test(n)).map(Number).sort((a, b) => b - a)
  }

  async function walkFiles (d, prefix = '') {
    const out = []
    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...await walkFiles(path.join(d, e.name), prefix + e.name + path.sep))
      else out.push(prefix + e.name)
    }
    return out
  }

  async function equal (a, b) {
    const [x, y] = await Promise.all([fs.promises.stat(a).catch(() => null), fs.promises.stat(b).catch(() => null)])
    if (!x || !y || x.size !== y.size) return false
    const [p, q] = await Promise.all([fs.promises.readFile(a), fs.promises.readFile(b)])
    return b4a.equals(p, q)
  }

  // The version's files become the site's pages: copied over this device's linked pages folder (changed files
  // only, removed ones deleted); SwarmFS publishes them as edits. A device publishing for the first time links the
  // folder and waits for the pages already there, so its files replace them (never conflict copies).
  async function toPages (site, created, version) {
    const live = path.join(dir, 'published', site.key)
    const linked = (await sfs.links()).some((l) => l.path === live)
    await fs.promises.mkdir(live, { recursive: true })
    if (!linked && created) { // a new site: its first pass publishes the files at once
      await mirror(version, live)
      return site.publish(live)
    }
    if (!linked) {
      await site.publish(live)
      await caughtUp(site, live)
    }
    await mirror(version, live)
  }

  async function mirror (version, live) {
    const want = new Set(await walkFiles(version))
    for (const p of want) {
      const to = path.join(live, p)
      if (await equal(path.join(version, p), to)) continue
      await fs.promises.mkdir(path.dirname(to), { recursive: true })
      await fs.promises.copyFile(path.join(version, p), to)
    }
    let removed = 0
    for (const p of await walkFiles(live)) {
      if (want.has(p) || p.startsWith('.swarmfs-trash' + path.sep)) continue
      await fs.promises.rm(path.join(live, p))
      removed++
    }
    await pruneEmpty(live, live)
    if (removed > 100) { // SwarmFS waits for a yes before deleting more than half of a folder (the person's yes: Publish)
      for (const until = Date.now() + 10000; Date.now() < until; await sleep(200)) {
        if ((await sfs.links()).some((l) => l.path === live && l.paused === 'mass-delete')) { await sfs.confirm(live); break }
      }
    }
  }

  async function caughtUp (site, live) {
    const pages = []
    const walk = async (id, prefix) => {
      const { items } = await site.pages.list(id, { limit: Infinity, timeout: 10000 })
      for (const e of items) {
        if (e.kind === 'folder') await walk(e.id, prefix + e.name + path.sep)
        else pages.push([prefix + e.name, e.size])
      }
    }
    await walk(site.pages.top, '')
    for (const until = Date.now() + CATCH_UP; ; await sleep(250)) {
      let here = true
      for (const [p, size] of pages) if ((await fs.promises.stat(path.join(live, p)).catch(() => null))?.size !== size) { here = false; break }
      if (here) return
      if (Date.now() > until) throw error('BUSY', "the site's pages are still arriving on this device: publish again in a moment")
    }
  }

  async function pruneEmpty (d, top) {
    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== '.swarmfs-trash') await pruneEmpty(path.join(d, e.name), top)
    }
    if (d !== top && !(await fs.promises.readdir(d)).length) await fs.promises.rmdir(d)
  }

  // This device's versions of the project's site, newest first.
  async function versions (folder) {
    const site = await siteKeyOf(folder)
    if (!site) return []
    const base = path.join(dir, 'versions', site)
    const out = []
    for (const n of await numbers(base)) out.push({ version: n, at: (await fs.promises.stat(path.join(base, String(n)))).mtimeMs })
    return out
  }

  // Version n's files published again, as a new version (hard links: no copy). The project's files stay.
  async function rollBack (key, n) {
    const folder = await project(key)
    const site = await siteKeyOf(folder)
    const from = site && Number.isSafeInteger(n) ? path.join(dir, 'versions', site, String(n)) : null
    if (!from || !(await fs.promises.stat(from).catch(() => null))) throw error('NOT_FOUND', 'no version ' + n + ' on this device')
    const { site: s } = await siteFor(folder, await readManifest(from))
    const tmp = await snapshot(from, (await walkFiles(from)).map((p) => p.split(path.sep).join('/')), true)
    try {
      const version = await keep(s.key, tmp)
      await toPages(s, false, path.join(dir, 'versions', s.key, String(version)))
      return { site: s.key, version }
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true })
    }
  }

  // --- the site owner's device: the project's members are the site's admins (D5) ---

  async function grant (key) {
    const folder = await folderOf(key)
    const siteKey = folder && await siteKeyOf(folder)
    if (!siteKey || !held(siteKey)) return
    const site = await sfs.site(siteKey, { timeout: 0 })
    if ((await site.space.getRole(me)) !== 'owner') return
    for (const m of await hg.space(key).members()) {
      if (m.identity === me) continue
      const want = !!m.role && !m.removed && !m.banned
      const has = await site.space.getRole(m.identity)
      if (want && has !== 'admin' && has !== 'owner') await site.space.setRole(m.identity, 'admin')
      if (!want && has === 'admin') await site.space.removeRole(m.identity)
    }
  }

  // --- preview (D7): the project's files as a draft site on this device, its data in a throwaway space ---

  async function preview (key, reset = false) {
    const folder = await project(key)
    const manifest = await readManifest(folder)
    const old = drafts[key]
    if (old && !reset && held(old)) {
      folders.set(old, folder)
      return { key: old }
    }
    if (old) {
      folders.delete(old)
      await forget(old)
      await sfs.leave(old).catch(() => {})
    }
    const site = await sfs.createSite(manifest.title + ' (draft)', { private: true, types: manifest.types })
    drafts = { ...drafts, [key]: site.key }
    await fs.promises.writeFile(DRAFTS, JSON.stringify(drafts))
    folders.set(site.key, folder)
    return { key: site.key }
  }

  // The folder a draft key shows, or null (sync: the engine asks on every open and read).
  function draft (key) {
    return folders.get(key) || null
  }

  function close () {
    closed = true
    hg.off('settings', onChange)
    hg.off('spaces', onChange)
  }

  return { start, call, draft, readDraft: readFile, close }
}

function safe (name) {
  const s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() // eslint-disable-line no-control-regex
  return !s || RESERVED.test(s) ? 'Project' : s
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The path as the disk names it: links resolved, and on Windows short names (GIT~1) made long (Node's native
// realpath; Bare's realpath is the native one).
const realpath = (p) => new Promise((resolve, reject) => (fs.realpath.native || fs.realpath)(p, (err, r) => err ? reject(err) : resolve(r)))
