// A page reaches projects only with the `projects` permission; every path stays inside the project folder.
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import { compile, ignored } from 'swarmfs/lib/ignore.js'
import { rootOf, BIN } from 'swarmfs/lib/types.js'
import { parseManifest, readManifest, sitePath } from './manifest.js'

const LIST = 'hyperbrowser/projects'
const PROJECT = '.hyperbrowser.json'
const IGNORE = '.swarmfsignore'
const ALWAYS = ['.git/', 'node_modules/'] // each device keeps its own
const NAME_MAX = 64
const WRITE_MAX = 32 * 1024 * 1024
const BUILD_MAX = 64 * 1024 * 1024
const CATCH_UP = 60000
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const GIT_MAX = 500
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i // Windows device names

/**
 * @typedef {import('./types.js').Site} Site
 * @typedef {import('./types.js').CodedError} CodedError
 * @typedef {import('./types.js').Manifest} Manifest
 * @typedef {{ name: string, left?: true }} Listed A project as the person's settings list it.
 * @typedef {{ key: string, name: string, folder: string | null, site: string | null, role: string | null }} Project
 * @typedef {{ path: string, size: number, mtime: number } | { path: string, folder: true }} FileEntry
 * @typedef {{ path: string, state: 'new' | 'modified' | 'deleted' }} GitChange
 */

/** @param {string} code @param {string} message */
const error = (code, message) => Object.assign(new Error(message), { code })

/**
 * A hard link (versions never change once made); a copy where links fail (another drive, FAT).
 * @param {string} from
 * @param {string} to
 * @param {(from: string, to: string) => Promise<void>} [link]
 */
export async function linkOrCopy (from, to, link = fs.promises.link) {
  try {
    await link(from, to)
  } catch {
    await fs.promises.copyFile(from, to)
  }
}

/**
 * The IDE's projects: a private files space per project, linked to a folder; published to a site of its own.
 * @param {object} opts
 * @param {import('./types.js').SwarmFS} opts.sfs
 * @param {string} opts.dir the engine folder
 * @param {string} opts.root where new projects' folders go
 * @param {(key: string, timeout?: number) => Promise<Site>} opts.visit
 * @param {(identity: string, text: string) => Promise<unknown>} opts.tell a message to a friend's conversation
 * @param {(key: string) => Promise<void>} opts.forget a draft site let go: the engine closes it
 */
export function projects ({ sfs, dir, root, visit, tell, forget }) {
  const hg = sfs.hg
  const me = hg.identity.publicKey
  const DRAFTS = path.join(dir, 'drafts.json')
  /** @type {Record<string, string>} project key -> its draft site's key */
  let drafts = {}
  /** @type {Map<string, string>} draft site key -> project key */
  const folders = new Map()
  /** @type {Set<string>} */
  const watched = new Set()
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve() // list writes, links and publishes, one at a time
  /** @type {Promise<unknown>} */
  let following = Promise.resolve()
  let closed = false

  /**
   * @template T
   * @param {() => T | Promise<T>} fn
   * @returns {Promise<T>}
   */
  const one = (fn) => {
    const run = queue.then(fn)
    queue = run.catch(() => {})
    return run
  }
  /** @returns {Promise<Record<string, Listed>>} */
  const all = async () => (await hg.settings())[LIST] || {}
  const onChange = () => { follow().catch(() => {}) }

  async function start () {
    try { drafts = JSON.parse(await fs.promises.readFile(DRAFTS, 'utf-8')) } catch {}
    for (const [project, key] of Object.entries(drafts)) folders.set(key, project)
    hg.on('settings', onChange)
    hg.on('spaces', onChange)
    await follow()
  }

  function follow () {
    following = following.then(async () => {
      for (const [key, { name, left }] of Object.entries(await all())) {
        if (closed || !held(key)) continue
        if (left) {
          await one(() => sfs.leave(key)).catch(() => {})
          continue
        }
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

  /** @param {string} key */
  function held (key) {
    try { hg.space(key); return true } catch { return false }
  }

  /** @param {string} key */
  async function folderOf (key) {
    return (await sfs.links()).find((l) => l.space === key && l.folder === key)?.path || null
  }

  /** @param {string} key @param {string} name */
  async function attach (key, name) {
    if (await folderOf(key)) return
    const base = path.join(root, safe(name))
    let folder = base
    for (let n = 2; await taken(folder); n++) folder = `${base} (${n})`
    await fs.promises.mkdir(folder, { recursive: true })
    await ensureIgnore(folder)
    await hg.space(key).ready() // a space joined on another device stays closed until used; SwarmFS's link needs it open
    await sfs.space(key).link(key, folder)
  }

  /** @param {string} folder */
  async function taken (folder) {
    try { return (await fs.promises.readdir(folder)).length > 0 } catch { return false }
  }

  // Before every link: SwarmFS reads the rules when it starts following the folder.
  /** @param {string} folder */
  async function ensureIgnore (folder) {
    const file = path.join(folder, IGNORE)
    let text = ''
    try { text = await fs.promises.readFile(file, 'utf-8') } catch {}
    const lines = text.split(/\r?\n/).map((l) => l.trim())
    const missing = ALWAYS.filter((l) => !lines.includes(l))
    if (missing.length) await fs.promises.writeFile(file, missing.join('\n') + '\n' + text)
  }

  /** @param {string} key @param {string} name */
  async function remember (key, name) {
    const list = await all()
    await hg.setSetting(LIST, { ...list, [key]: { name } })
  }

  /**
   * A page's projects.* call.
   * @param {string} method
   * @param {any[]} args the page's: checked here
   */
  async function call (method, [a, b, c]) {
    switch (method) {
      case 'list': return list()
      case 'create': return one(() => create(a))
      case 'openFolder': return one(() => openFolder(a))
      case 'openCopy': return openCopy(a)
      case 'join': return join(a)
      case 'files': return files(await project(a), b?.folders === true)
      case 'build': await project(a); return one(() => build(a, b))
      case 'mkdir': return mkdir(await project(a), b)
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
      case 'status': return status(a)
      case 'leave': return one(() => leave(a, b))
      case 'removeMember':
        await project(a)
        await sfs.space(a).removeMember(b)
        await grant(a)
        return true
      default: throw error('UNKNOWN_METHOD', 'no projects.' + method)
    }
  }

  async function list () {
    /** @type {Project[]} */
    const out = []
    for (const [key, { name, left }] of Object.entries(await all())) {
      if (left || !held(key)) continue
      const folder = await folderOf(key)
      out.push({ key, name, folder, site: folder ? await siteKeyOf(folder) : null, role: await hg.space(key).getRole(me).catch(() => null) })
    }
    return out
  }

  /** @param {string} key */
  async function view (key) {
    return (await list()).find((p) => p.key === key)
  }

  /**
   * The project's folder, if it is one of the person's here.
   * @param {unknown} key
   * @returns {Promise<string>}
   */
  async function project (key) {
    const known = typeof key === 'string' && KEY.test(key) ? (await all())[key] : null
    if (!known || known.left) throw error('NOT_FOUND', 'not one of your projects')
    const folder = await folderOf(/** @type {string} */ (key))
    if (!folder) throw error('NOT_FOUND', 'this project is not on this device yet')
    return folder
  }

  /** @param {unknown} name */
  async function create (name) {
    if (typeof name !== 'string' || !name.trim() || name.length > NAME_MAX) throw error('INVALID_PARAMS', `a project's name is 1 to ${NAME_MAX} characters`)
    const drive = await sfs.createSpace(name.trim())
    await remember(drive.key, name.trim())
    await attach(drive.key, name.trim())
    return view(drive.key)
  }

  // The folder the person picked (the shell's dialog: a page never names a path), as it is.
  /** @param {unknown} folder */
  async function openFolder (folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw error('INVALID_PARAMS', 'openFolder needs a folder')
    const full = path.resolve(folder)
    if (!(await fs.promises.stat(full).catch(() => null))?.isDirectory()) throw error('NOT_FOUND', 'no such folder')
    await sfs._overlaps(full) // EXISTS: already a project, or inside a synced folder
    const name = path.basename(full).slice(0, NAME_MAX) || 'Project'
    const drive = await sfs.createSpace(name)
    await ensureIgnore(full)
    await drive.link(drive.key, full)
    await remember(drive.key, name)
    return view(drive.key)
  }

  /** @param {unknown} key */
  async function openCopy (key) {
    if (typeof key !== 'string' || !KEY.test(key)) throw error('INVALID_KEY', 'not a site key')
    const site = await visit(key)
    const title = parseManifest(await site.read('site.json')).title
    /** @type {string[]} */
    const pages = []
    /** @param {string} id @param {string} prefix @returns {Promise<void>} */
    const walk = async (id, prefix) => {
      const { items } = await site.pages.list(id, { limit: Infinity, timeout: 10000 })
      for (const e of items) {
        if (e.kind === 'folder') await walk(e.id, prefix + e.name + '/')
        else pages.push(prefix + e.name)
      }
    }
    await walk(site.pages.top, '')
    /** @type {Array<[string, Uint8Array]>} */
    const bytes = []
    for (const p of pages) if (sitePath(p)) bytes.push([p, await site.read(p)])
    const made = /** @type {Project} */ (await one(() => create(`${title} (copy)`.slice(0, NAME_MAX))))
    for (const [p, b] of bytes) { // a page the project would never sync (.git/hooks/...): left out
      await writeFile(/** @type {string} */ (made.folder), p, b).catch((err) => { if (err.code !== 'NOT_ALLOWED') throw err })
    }
    return made
  }

  // A co-author's invite: a private files space (never a site or a circle, whose links have one use).
  /** @param {unknown} link */
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

  /** @param {string} key */
  async function invite (key) {
    await project(key)
    return { link: await sfs.space(key).invite({ role: 'editor' }) }
  }

  // Synced paths only: never .git (git runs its hooks outside the sandbox), node_modules or ignored paths. No link
  // out of the folder: checked again on the path as the disk resolves it (a link to .git, a short name like GIT~1).
  /**
   * @param {string} folder
   * @param {unknown} p a page's path
   * @param {boolean} [write]
   * @returns {Promise<string>} the full path
   */
  async function inside (folder, p, write = false) {
    const clean = typeof p === 'string' && !p.startsWith('/') ? sitePath(p) : null
    if (!clean || clean.split('/').some((s) => s === '.' || s.includes(':') || RESERVED.test(s) || /[. ]$/.test(s) || /~\d/.test(s))) throw error('INVALID_PATH', 'not a path inside the project: ' + JSON.stringify(p))
    await syncs(folder, clean, write)
    const real = await realpath(folder)
    const full = path.join(real, ...clean.split('/'))
    let probe = full
    /** @type {string} */
    let r
    for (;;) {
      try { r = await realpath(probe); break } catch {}
      probe = path.dirname(probe)
    }
    if (r !== real && !r.startsWith(real + path.sep)) throw error('NOT_ALLOWED', 'that path leads out of the project')
    const resolved = path.relative(real, path.join(r, path.relative(probe, full))).split(path.sep).join('/')
    if (resolved !== clean) await syncs(folder, resolved, write)
    return full
  }

  /** @param {string} folder @param {string} rel @param {boolean} write */
  async function syncs (folder, rel, write) {
    const lower = rel.toLowerCase() // Windows and macOS: .GIT is .git
    const rules = await rulesOf(folder)
    if (lower.split('/').some((s) => s === '.git' || s === 'node_modules') || [rel, lower].some((x) => ignored(rules, x, false) || ignored(rules, x, true))) {
      throw error('NOT_ALLOWED', 'the project does not sync ' + rel + ': a page may not reach it')
    }
    if (write && lower === PROJECT) throw error('NOT_ALLOWED', PROJECT + ' is written by HyperBrowser only')
  }

  /** @param {string} folder */
  async function rulesOf (folder) {
    return compile(await fs.promises.readFile(path.join(folder, IGNORE), 'utf-8').catch(() => ''))
  }

  // The ignore file changed by a page: .git/ and node_modules/ stay in it.
  /** @param {string} folder @param {string[]} paths */
  async function kept (folder, ...paths) {
    if (paths.some((p) => p.toLowerCase() === IGNORE)) await ensureIgnore(folder)
  }

  /** @param {string} folder */
  async function files (folder, folders = false) {
    const rules = await rulesOf(folder)
    /** @type {FileEntry[]} */
    const out = []
    /** @param {string} d @returns {Promise<void>} */
    const walk = async (d) => {
      for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        const rel = path.relative(folder, full).split(path.sep).join('/')
        if (ignored(rules, rel, e.isDirectory())) continue
        if (e.isDirectory() && folders) out.push({ path: rel, folder: true })
        if (e.isDirectory()) await walk(full)
        else if (e.isFile()) {
          const st = await fs.promises.stat(full).catch(() => null) // gone meanwhile: SwarmFS replaces a file by trash, then rename
          if (st) out.push({ path: rel, size: st.size, mtime: st.mtimeMs })
        }
      }
    }
    await walk(folder)
    return out
  }

  /** @param {string} folder @param {unknown} p */
  async function readFile (folder, p) {
    const full = await inside(folder, p)
    if (!(await fs.promises.stat(full).catch(() => null))?.isFile()) throw error('NOT_FOUND', 'no file ' + p)
    return fs.promises.readFile(full)
  }

  /** @param {string} folder @param {string} p @param {unknown} data */
  async function writeFile (folder, p, data) {
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) throw error('INVALID_PARAMS', 'write takes text or bytes')
    if (data.length > WRITE_MAX) throw error('TOO_BIG', `at most ${WRITE_MAX} bytes a write`)
    const full = await inside(folder, p, true)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    await fs.promises.writeFile(full, data)
    await kept(folder, p)
    return true
  }

  /** @param {string} folder @param {string} p */
  async function mkdir (folder, p) {
    const full = await inside(folder, p, true)
    if (await fs.promises.lstat(full).catch(() => null)) throw error('EXISTS', p + ' is there already')
    await fs.promises.mkdir(full, { recursive: true })
    return true
  }

  /** @param {string} folder @param {string} from @param {string} to */
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

  // Links are unlinked, never followed; what the project ignores stays (a nested .git).
  /** @param {string} folder @param {string} p */
  async function remove (folder, p) {
    const full = await inside(folder, p, true)
    if (!(await fs.promises.lstat(full).catch(() => null))) throw error('NOT_FOUND', 'no file ' + p)
    await rmSynced(folder, full)
    await kept(folder, p)
    return true
  }

  /** @param {string} folder @param {string} at */
  async function rmSynced (folder, at) {
    const rules = await rulesOf(folder)
    /** @param {string} at @returns {Promise<void>} */
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
    await rm(at)
  }

  /** @param {string} key @param {{ deleteFiles?: boolean } | undefined} opts */
  async function leave (key, opts) {
    const folder = await project(key)
    const deleteFiles = opts?.deleteFiles === true
    const list = await all()
    await hg.setSetting(LIST, { ...list, [key]: { ...list[key], left: true } })
    if (drafts[key]) {
      folders.delete(drafts[key])
      await forget(drafts[key])
      await sfs.leave(drafts[key]).catch(() => {})
      const rest = { ...drafts }
      delete rest[key]
      drafts = rest
      await fs.promises.writeFile(DRAFTS, JSON.stringify(drafts))
    }
    await sfs.leave(key)
    await fs.promises.rm(builtDir(key), { recursive: true, force: true })
    if (deleteFiles) await rmSynced(folder, folder)
    return true
  }

  /** @param {string} key */
  async function status (key) {
    const folder = await project(key)
    const peers = hg.space(key).peers()
    return {
      devices: new Set(peers.filter((x) => x.identity === me).map((x) => x.device)).size,
      coauthors: new Set(peers.filter((x) => x.identity && x.identity !== me).map((x) => x.identity)).size,
      git: await gitState(folder)
    }
  }

  // As git's first check (size and mtime): a file touched but unchanged reads as modified.
  // shortcut: an index v4 (path-compressed) or a worktree's .git file gives changed: null; read them if anyone uses them.
  /**
   * @param {string} folder
   * @returns {Promise<{ branch: string, changed: GitChange[] | null } | null>}
   */
  async function gitState (folder) {
    const git = path.join(folder, '.git')
    let head
    try { head = (await fs.promises.readFile(path.join(git, 'HEAD'), 'utf-8')).trim() } catch { return null }
    const branch = head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7) + ' (detached)'
    /** @type {Uint8Array | null} */
    let bytes = null
    try { bytes = await fs.promises.readFile(path.join(git, 'index')) } catch {}
    const tracked = bytes ? readIndex(bytes) : new Map()
    if (!tracked) return { branch, changed: null }
    /** @type {GitChange[]} */
    const changed = []
    for (const [p, { size, mtime }] of tracked) {
      const st = await fs.promises.stat(path.join(folder, ...p.split('/'))).catch(() => null)
      if (!st) changed.push({ path: p, state: 'deleted' })
      else if (st.size !== size || Math.floor(st.mtimeMs / 1000) !== mtime) changed.push({ path: p, state: 'modified' })
    }
    const gitignore = compile(await fs.promises.readFile(path.join(folder, '.gitignore'), 'utf-8').catch(() => ''))
    for (const f of await files(folder)) if (!tracked.has(f.path) && !ignored(gitignore, f.path, false)) changed.push({ path: f.path, state: 'new' })
    return { branch, changed: changed.sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, GIT_MAX) }
  }

  /** @param {string} folder @returns {Promise<string | null>} */
  async function siteKeyOf (folder) {
    try {
      const key = JSON.parse(await fs.promises.readFile(path.join(folder, PROJECT), 'utf-8')).site
      return typeof key === 'string' && KEY.test(key) ? key : null
    } catch { return null }
  }

  /** @param {string} folder */
  async function publishable (folder) {
    return (await files(folder)).map((f) => f.path).filter((p) => p !== IGNORE && p !== PROJECT)
  }

  // Built pages live outside the project: they never sync, never reach git, never meet a co-author's.

  /** @param {string} key */
  const builtDir = (key) => path.join(dir, 'builds', key)
  /** @param {string} p */
  const slash = (p) => p.split(path.sep).join('/')

  /** @param {string} key @param {unknown} pages a page's { path: html } */
  async function build (key, pages) {
    if (!pages || typeof pages !== 'object' || Array.isArray(pages)) throw error('INVALID_PARAMS', 'build takes { path: html }')
    let size = 0
    for (const [p, html] of Object.entries(pages)) {
      if (!sitePath(p) || !p.endsWith('.html') || p.split('/').some((s) => s.includes(':') || RESERVED.test(s))) throw error('INVALID_PATH', 'a built page is a .html path inside the site: ' + JSON.stringify(p))
      if (typeof html !== 'string') throw error('INVALID_PARAMS', 'a built page is text')
      size += html.length
    }
    if (size > BUILD_MAX) throw error('TOO_BIG', `at most ${BUILD_MAX} bytes of built pages`)
    const to = builtDir(key)
    const tmp = to + '.new'
    await fs.promises.rm(tmp, { recursive: true, force: true })
    for (const [p, html] of Object.entries(pages)) {
      const file = path.join(tmp, ...p.split('/'))
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await fs.promises.writeFile(file, html)
    }
    await fs.promises.mkdir(tmp, { recursive: true })
    await fs.promises.rm(to, { recursive: true, force: true })
    await fs.promises.rename(tmp, to)
    return true
  }

  /** @param {string} key */
  async function builtPages (key) {
    return (await walkFiles(builtDir(key)).catch(() => [])).map(slash)
  }

  /** @param {string} key @param {string} folder @param {string} p */
  async function readSite (key, folder, p) {
    try {
      return await readFile(folder, p)
    } catch (err) {
      if (/** @type {CodedError} */ (err).code !== 'NOT_FOUND' || !(await builtPages(key)).includes(p)) throw err
      return fs.promises.readFile(path.join(builtDir(key), ...p.split('/')))
    }
  }

  /** @param {string} key */
  async function publish (key) {
    const folder = await project(key)
    const manifest = await readManifest(folder, builtDir(key)) // a broken site.json: refused before anything is written
    const known = await siteKeyOf(folder)
    const mine = await publishable(folder)
    const have = new Set(mine)
    const built = new Set((await builtPages(key)).filter((p) => !have.has(p)))
    /** @param {string} p */
    const src = (p) => path.join(built.has(p) ? builtDir(key) : folder, ...p.split('/'))
    const tmp = await snapshot(src, [...mine, ...built], false, known && await newest(known))
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

  /** @param {string} folder @param {Manifest} manifest @returns {Promise<{ site: Site, created: boolean }>} */
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

  /**
   * A new version's files, in versions/.new.
   * @param {string | ((p: string) => string)} from a folder, or each path's source
   * @param {string[]} list
   * @param {boolean} link hard-link every file (a roll back: the files are a version already)
   * @param {string | null} [last] the latest version: a file the same there is linked to it
   */
  async function snapshot (from, list, link, last) {
    const tmp = path.join(dir, 'versions', '.new')
    await fs.promises.rm(tmp, { recursive: true, force: true })
    await fs.promises.mkdir(tmp, { recursive: true })
    for (const p of list) {
      const src = typeof from === 'function' ? from(p) : path.join(from, ...p.split('/'))
      const to = path.join(tmp, ...p.split('/'))
      await fs.promises.mkdir(path.dirname(to), { recursive: true })
      const same = last && path.join(last, ...p.split('/'))
      if (link) await linkOrCopy(src, to)
      else if (same && await equal(src, same)) await linkOrCopy(same, to)
      else await fs.promises.copyFile(src, to)
    }
    return tmp
  }

  /** @param {string} site @param {string} tmp */
  async function keep (site, tmp) {
    const base = path.join(dir, 'versions', site)
    await fs.promises.mkdir(base, { recursive: true })
    const n = ((await numbers(base))[0] || 0) + 1
    await fs.promises.rename(tmp, path.join(base, String(n)))
    return n
  }

  /** @param {string} site */
  async function newest (site) {
    const base = path.join(dir, 'versions', site)
    const n = (await numbers(base))[0]
    return n ? path.join(base, String(n)) : null
  }

  /** @param {string} base */
  async function numbers (base) {
    const names = await fs.promises.readdir(base).catch(() => /** @type {string[]} */ ([]))
    return names.filter((n) => /^[1-9]\d*$/.test(n)).map(Number).sort((a, b) => b - a)
  }

  /** @param {string} d @returns {Promise<string[]>} */
  async function walkFiles (d, prefix = '') {
    /** @type {string[]} */
    const out = []
    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...await walkFiles(path.join(d, e.name), prefix + e.name + path.sep))
      else out.push(prefix + e.name)
    }
    return out
  }

  /** @param {string} a @param {string} b */
  async function equal (a, b) {
    const [x, y] = await Promise.all([fs.promises.stat(a).catch(() => null), fs.promises.stat(b).catch(() => null)])
    if (!x || !y || x.size !== y.size) return false
    const [p, q] = await Promise.all([fs.promises.readFile(a), fs.promises.readFile(b)])
    return b4a.equals(p, q)
  }

  // A first publish here waits for the pages already there, so its files replace them instead of making conflict copies.
  /** @param {Site} site @param {boolean} created @param {string} version the version's folder */
  async function toPages (site, created, version) {
    const live = path.join(dir, 'published', site.key)
    const linked = (await sfs.links()).some((l) => l.path === live)
    await fs.promises.mkdir(live, { recursive: true })
    if (!linked && created) { // a new site: its first pass publishes the files at once
      await mirror(version, live)
      return site.publish(live)
    }
    if (!linked) await site.publish(live)
    await caughtUp(site)
    await mirror(version, live)
  }

  /** @param {string} version @param {string} live */
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

  // Wait until every page is here at its current version, else the files written next become conflict copies.
  // One query of file records and one of `held` records: a listing with holders costs seconds for 1000 pages.
  // shortcut: reads SwarmFS's own records (requests-to-swarmfs F9: a linked folder's "in step" wanted).
  /** @param {Site} site */
  async function caughtUp (site) {
    for (const until = Date.now() + CATCH_UP; ; await sleep(250)) {
      const pages = await site.pages.space.query('file').latest(100000)
      const { items } = await hg.personal.query('held').fromDevice(hg.device.publicKey).latest(100000) // no index on space
      const held = /** @type {import('swarmfs/lib/types.js').HeldRecord[]} */ (items)
      const here = new Map(held.filter((h) => h.space === site.pages.key).map((h) => [h.entry, h.root]))
      const files = /** @type {import('swarmfs/lib/types.js').FileRecord[]} */ (pages.items)
      if (pages.complete && files.every((r) => r.parent === BIN || here.get(r.id) === rootOf(r.content))) return
      if (Date.now() > until) throw error('BUSY', "the site's pages are still arriving on this device: publish again in a moment")
    }
  }

  /** @param {string} d @param {string} top */
  async function pruneEmpty (d, top) {
    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== '.swarmfs-trash') await pruneEmpty(path.join(d, e.name), top)
    }
    if (d !== top && !(await fs.promises.readdir(d)).length) await fs.promises.rmdir(d)
  }

  /** @param {string} folder */
  async function versions (folder) {
    const site = await siteKeyOf(folder)
    if (!site) return []
    const base = path.join(dir, 'versions', site)
    /** @type {Array<{ version: number, at: number }>} */
    const out = []
    for (const n of await numbers(base)) out.push({ version: n, at: (await fs.promises.stat(path.join(base, String(n)))).mtimeMs })
    return out
  }

  /** @param {string} key @param {unknown} n */
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

  /** @param {string} key */
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

  /** @param {string} key */
  async function preview (key, reset = false) {
    const folder = await project(key)
    const manifest = await readManifest(folder, builtDir(key))
    const old = drafts[key]
    if (old && !reset && held(old)) {
      folders.set(old, key)
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
    folders.set(site.key, key)
    return { key: site.key }
  }

  // Synchronous: the engine asks on every open and read.
  /** @param {string} key */
  function draft (key) {
    return folders.get(key) || null
  }

  /** @param {string} key */
  async function draftManifest (key) {
    const p = folders.get(key)
    return readManifest(await project(p), builtDir(/** @type {string} */ (p)))
  }

  /** @param {string} key @param {string} p */
  async function readDraft (key, p) {
    const shown = folders.get(key)
    return readSite(/** @type {string} */ (shown), await project(shown), p)
  }

  function close () {
    closed = true
    hg.off('settings', onChange)
    hg.off('spaces', onChange)
  }

  /** @param {(change: { project: string }) => void} fn */
  function watchFiles (fn) {
    /** @param {import('swarmfs').SyncEvent} e */
    const each = async (e) => {
      const p = e.space && (await all())[e.space]
      if (p && !p.left) fn({ project: /** @type {string} */ (e.space) })
    }
    /** @param {import('swarmfs').SyncEvent} e */
    const listener = (e) => { each(e).catch(() => {}) }
    sfs.on('sync', listener)
    return () => sfs.off('sync', listener)
  }

  return { start, call, draft, draftManifest, readDraft, onChange: watchFiles, close }
}

/**
 * A git index's paths, sizes and mtimes (s); null for a version this doesn't read.
 * @param {Uint8Array} bytes
 * @returns {Map<string, { size: number, mtime: number }> | null}
 */
function readIndex (bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 12 || v.getUint32(0) !== 0x44495243) return null // 'DIRC'
  const version = v.getUint32(4)
  if (version !== 2 && version !== 3) return null
  const out = new Map()
  let at = 12
  for (let n = v.getUint32(8); n > 0; n--) {
    const mtime = v.getUint32(at + 8)
    const size = v.getUint32(at + 36)
    const flags = v.getUint16(at + 60)
    const start = at + 62 + (version === 3 && (flags & 0x4000) ? 2 : 0)
    let end = start
    while (bytes[end] !== 0) end++
    out.set(b4a.toString(bytes.subarray(start, end)), { size, mtime })
    at += Math.ceil((end - at + 1) / 8) * 8 // padded to 8 bytes, at least one NUL
  }
  return out
}

/** @param {string} name */
function safe (name) {
  const s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim() // eslint-disable-line no-control-regex
  return !s || RESERVED.test(s) ? 'Project' : s
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/**
 * Node's realpath resolves links and Windows short names (GIT~1); Bare's is the native one.
 * @param {string} p
 * @returns {Promise<string>}
 */
const realpath = (p) => new Promise((resolve, reject) => (fs.realpath.native || fs.realpath)(p, (err, r) => err ? reject(err) : resolve(r)))
