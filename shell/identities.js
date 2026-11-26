// The identities on this computer, in identities.json in the data folder: outside every identity's own folder.
// Main, the engine folder of an install from before identities, keeps its desktop (shell.json) and its site
// sessions (persist:site-<key>) where they were: nothing is moved.
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'

/**
 * @typedef {{ id: string, name: string, dir: string, anonymous?: boolean }} Saved dir: relative to the data folder;
 *   anonymous: I2P only (its engine opens with transport 'i2p'), fixed for the identity's life
 * @typedef {{ current: string, list: Saved[] }} List
 * @typedef {{ id: string, name: string, dir: string, shell: string, prefix: string, anonymous: boolean }} Identity its paths, absolute
 */

const NAME_MAX = 64
const ID = /^[0-9a-f]{16}$/
const ENGINE = ['instance.json', 'cores'] // hypergraph's, in every engine folder it opened

/** @param {string} message @param {string} [code] */
const fail = (message, code = 'INVALID_PARAMS') => Object.assign(new Error(message), { code })

/**
 * @param {string} home the data folder
 * @param {string} [main] the engine folder from before identities
 */
export function identities (home, main = path.join(home, 'engine')) {
  const file = path.join(home, 'identities.json')
  const legacy = path.relative(home, main)
  /** @type {List} */
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    // a list that can't be read throws: starting with Main alone would hide the others
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw fail(file + " can't be read: " + /** @type {Error} */ (e).message, 'INVALID_LIST')
    const id = newId()
    data = { current: id, list: [{ id, name: 'Main', dir: legacy }] }
    save()
  }
  if (!Array.isArray(data.list) || !data.list.some((i) => i.id === data.current)) throw fail(file + ' lists no current identity', 'INVALID_LIST')

  function newId () { return randomBytes(8).toString('hex') }

  function save () {
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
    fs.renameSync(file + '.tmp', file)
  }

  /** @param {Saved} i @returns {Identity} */
  function full (i) {
    const old = i.dir === legacy
    return { id: i.id, name: i.name, dir: path.resolve(home, i.dir), shell: path.join(home, old ? 'shell.json' : 'shell-' + i.id + '.json'), prefix: old ? '' : i.id + '-', anonymous: !!i.anonymous }
  }

  /** @param {unknown} id */
  function find (id) {
    const i = data.list.find((x) => x.id === id)
    if (!i) throw fail('no such identity', 'NOT_FOUND')
    return i
  }

  /** @param {unknown} name @param {string | null} [self] */
  function checkName (name, self = null) {
    const n = typeof name === 'string' ? name.trim() : ''
    if (!n || n.length > NAME_MAX) throw fail('A name of 1 to ' + NAME_MAX + ' characters.')
    if (data.list.some((x) => x.id !== self && x.name.toLowerCase() === n.toLowerCase())) throw fail('Another identity has that name.')
    return n
  }

  return {
    current: () => full(find(data.current)),
    list: () => data.list.map((i) => ({ id: i.id, name: i.name, current: i.id === data.current, anonymous: !!i.anonymous })),
    /** @param {unknown} id */
    get: (id) => full(find(id)),
    /** @param {unknown} name @param {{ anonymous?: unknown }} [opts] anonymous: I2P only, for good */
    create (name, { anonymous = false } = {}) {
      const n = checkName(name)
      const id = newId()
      data.list.push({ id, name: n, dir: 'identity-' + id, ...(anonymous === true ? { anonymous: true } : {}) })
      save()
      return id
    },
    /** @param {unknown} id @param {unknown} name */
    rename (id, name) {
      const i = find(id)
      i.name = checkName(name, i.id)
      save()
    },
    /** @param {unknown} id */
    use (id) {
      data.current = find(id).id
      save()
    },
    /**
     * Its folder and desktop, then the entry: a folder that can't go yet (a file open) throws, and it stays listed.
     * The site sessions are the caller's (Electron's).
     * @param {unknown} id
     */
    remove (id) {
      const i = find(id)
      if (i.id === data.current) throw fail('Open another identity first: this one is open.', 'NOT_ALLOWED')
      const gone = full(i)
      // the list is a file anyone can edit, and Main's dir comes from --dir: refuse anything but one engine folder
      /** @param {string} child */
      const holds = (child) => { const r = path.relative(gone.dir, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)) }
      const unsafe = holds(home) ? 'it is the data folder or holds it'
        : holds(full(find(data.current)).dir) ? "it holds the open identity's folder"
          : data.list.some((x) => x !== i && holds(full(x).dir)) ? "it holds another identity's folder"
            : fs.existsSync(gone.dir) && !ENGINE.some((f) => fs.existsSync(path.join(gone.dir, f))) ? 'it is not an engine folder'
              : null
      if (unsafe) throw fail('Not deleted: ' + gone.dir + ' (' + unsafe + ').', 'UNSAFE_FOLDER')
      fs.rmSync(gone.dir, { recursive: true, force: true, maxRetries: 10 })
      fs.rmSync(gone.shell, { force: true })
      data.list = data.list.filter((x) => x !== i)
      save()
      return gone
    },
    /**
     * Site session folders of deleted identities that were still open when they were deleted. Before any session
     * opens. Only an id neither listed nor with a folder: a lost list never costs a listed identity's data.
     * @param {string} partitions Electron's Partitions folder
     */
    sweep (partitions) {
      let names = /** @type {string[]} */ ([])
      try { names = fs.readdirSync(partitions) } catch {}
      for (const name of names) {
        const id = name.split('-')[0]
        if (!ID.test(id) || !name.startsWith(id + '-site-') || data.list.some((x) => x.id === id) || fs.existsSync(path.join(home, 'identity-' + id))) continue
        try { fs.rmSync(path.join(partitions, name), { recursive: true, force: true }) } catch {}
      }
    },
    save
  }
}
