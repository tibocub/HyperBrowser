// Who sent a request is read from the invite's signature, never from the message.
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import FramedStream from 'framed-stream'
import b4a from 'b4a'
import z32 from 'z32'
import invites from 'hypergraph/lib/invites.js'
import { parseManifest } from './manifest.js'

const CONTACTS = 'hyperbrowser/contacts'
const LINKS = 'hyperbrowser/contact-links'
const FINDABLE = 'hyperbrowser/findable'
const NAME = 'name'
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const CONTACTS_MAX = 1000
const INCOMING_MAX = 100 // requests anyone can send: the rest are dropped until some are answered
const FRAME_MAX = 4096
const WATCH = 2000
const LOOKUP = 15000

/**
 * @typedef {import('./types.js').Site} Site
 * @typedef {import('./types.js').Space} Space
 * @typedef {import('./types.js').CodedError} CodedError
 * @typedef {import('./types.js').TypeDeclarations} TypeDeclarations
 * @typedef {'incoming' | 'outgoing' | 'friend'} ContactState
 * @typedef {object} Contact As kept in the person's settings.
 * @property {string} name
 * @property {ContactState} state
 * @property {string} chat the conversation's key
 * @property {number} at
 * @property {string} [link] the invite to the conversation, while a request is open
 * @property {boolean} [named] the name came from their profile (or was given by the person)
 * @property {boolean} [delivered] an outgoing request reached them
 * @typedef {{ identity: string, name: string, state: ContactState, chat: string, at: number }} ContactView What a page gets.
 * @typedef {Record<string, Contact>} Contacts By identity.
 * @typedef {import('hyperswarm').Connection & { info: import('hyperswarm').PeerInfo, framed: FramedStream }} Conn
 */

/** @param {string} code @param {string} message */
const error = (code, message) => Object.assign(new Error(message), { code })
/** @param {unknown} n @returns {n is string} */
const validName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 64 && !/[\x00-\x1f\x7f]/.test(n) // eslint-disable-line no-control-regex
/** @param {string} identity */
const topicOf = (identity) => crypto.hash(b4a.from('hyperbrowser/contacts/1/' + identity))
const noop = () => {}

/**
 * The person's contacts: requests over the DHT, a private Chat conversation per friend.
 * @param {object} opts
 * @param {import('./types.js').SwarmFS} opts.sfs
 * @param {Array<{ host: string, port: number }>} [opts.bootstrap]
 * @param {(app: string, link: string) => Promise<Site>} opts.joinInstance
 * @param {(app: string, key: string, on: boolean) => Promise<void>} opts.listInstance
 * @param {(app: string, key: string) => Promise<boolean>} opts.leaveInstance
 * @param {(method: string, p?: import('./types.js').Params) => Promise<any>} opts.circles the circles module's call: its answer depends on the method
 */
export function contacts ({ sfs, bootstrap, joinInstance, listInstance, leaveInstance, circles }) {
  /** @type {string | null} */
  let chat = null
  /** @type {TypeDeclarations | null} */
  let types = null
  /** @type {Promise<unknown>} */
  let writing = Promise.resolve()
  /** @type {import('hyperswarm') | null} */
  let swarm = null
  let announced = false
  /** @type {Map<string, string>} */
  const wanted = new Map()
  /** @type {Map<string, import('hyperswarm').Discovery>} */
  const lookups = new Map()
  /** @type {Map<Conn, Set<string>>} */
  const sent = new Map()
  let watching = false
  let closed = false
  const me = sfs.hg.identity.publicKey
  const timer = setInterval(() => watch().catch(noop), WATCH)
  const again = setInterval(() => { for (const d of lookups.values()) d.refresh().catch(noop) }, LOOKUP)
  const onSettings = () => { if (!closed) refresh().catch(noop) }
  sfs.hg.on('settings', onSettings)
  refresh().catch(noop)

  const settings = () => sfs.hg.settings()
  /** @returns {Promise<Contacts>} */
  const all = async () => (await settings())[CONTACTS] || {}

  // One read-and-write at a time: concurrent writers would drop each other's changes.
  /**
   * @template T
   * @param {(list: Contacts) => T | Promise<T>} fn
   * @returns {Promise<T>}
   */
  function update (fn) {
    const write = writing.then(async () => {
      const list = await all()
      const out = await fn(list)
      await sfs.hg.setSetting(CONTACTS, list)
      return out
    })
    writing = write.catch(noop)
    return write
  }

  /** @param {string} identity @param {Contact} c @returns {ContactView} */
  const view = (identity, c) => ({ identity, name: c.name, state: c.state, chat: c.chat, at: c.at })

  function needChat () {
    if (!chat) throw error('NOT_READY', 'no chat app yet')
  }

  /** @param {unknown} identity @returns {asserts identity is string} */
  function checkKey (identity) {
    if (typeof identity !== 'string' || !KEY.test(identity)) throw error('INVALID_PARAMS', 'not a person\'s key')
    if (identity === me) throw error('ALREADY', 'that is you')
  }

  async function myName () {
    const n = (await settings())[NAME]
    return validName(n) ? n : ''
  }

  async function conversation () {
    needChat() // chat is set from here on
    if (!types) {
      let app
      try { sfs.hg.space(/** @type {string} */ (chat)); app = await sfs.site(/** @type {string} */ (chat)) } catch { app = await sfs.visit('hg:' + chat) }
      types = parseManifest(await app.read('site.json')).types || {}
    }
    const site = await sfs.createSite((await myName()) || 'Chat', { app: /** @type {string} */ (chat), types, private: true })
    await site.space.setHistory('hidden') // encrypted: each message its own key; a new device reads from its join on
    await listInstance(/** @type {string} */ (chat), site.key, true)
    await putName(site.space)
    return site
  }

  /** @param {Space} space */
  async function putName (space) {
    const name = await myName()
    if (name) await space.put('profile', { name })
  }

  /** @param {string} key @param {string} identity */
  async function nameIn (key, identity) {
    try {
      const { items } = await sfs.hg.space(key).query('profile').by(identity).latest(1)
      return validName(items[0]?.name) ? /** @type {string} */ (items[0].name) : null
    } catch { return null }
  }

  /**
   * @param {string} method
   * @param {any[]} args a page's: checked here
   */
  async function call (method, args) {
    const [a, b] = args
    switch (method) {
      case 'me': {
        const s = await settings()
        return { identity: me, name: validName(s[NAME]) ? s[NAME] : null, findable: s[FINDABLE] !== false }
      }
      case 'setMe': {
        const { name, findable } = a || {}
        if (name !== undefined && !validName(name)) throw error('INVALID_PARAMS', 'a name is 1 to 64 characters')
        if (findable !== undefined && typeof findable !== 'boolean') throw error('INVALID_PARAMS', 'findable is true or false')
        if (name !== undefined) await sfs.hg.setSetting(NAME, name)
        if (findable !== undefined) await sfs.hg.setSetting(FINDABLE, findable)
        return true
      }
      case 'list': return Object.entries(await all()).map(([id, c]) => view(id, c)).sort((x, y) => x.name.localeCompare(y.name))
      case 'get': return (await all())[a] ? view(a, (await all())[a]) : null
      case 'request': return request(a, b)
      case 'accept': return accept(a)
      case 'decline': return update((list) => {
        if (list[a]?.state !== 'incoming') throw error('NOT_FOUND', 'no request from them')
        delete list[a]
        return true
      })
      case 'remove': {
        const c = (await all())[a]
        if (!c) throw error('NOT_FOUND', 'not a contact')
        await update((list) => { delete list[a] })
        if (c.chat && c.state !== 'incoming') await leaveInstance(/** @type {string} */ (chat), c.chat).catch(noop)
        return true
      }
      case 'rename':
        if (!validName(b)) throw error('INVALID_PARAMS', 'a name is 1 to 64 characters')
        return update((list) => {
          if (!list[a]) throw error('NOT_FOUND', 'not a contact')
          Object.assign(list[a], { name: b, named: true })
          return true
        })
      case 'link': {
        const site = await conversation()
        const link = await site.space.createInvite({ role: 'member' })
        const links = (await settings())[LINKS] || {}
        await sfs.hg.setSetting(LINKS, { ...links, [site.key]: Date.now() })
        return { link }
      }
      case 'add': return add(a)
      case 'circles': return (/** @type {import('./circles.js').Circle[]} */ (await circles('circles.list'))).filter((x) => x.role === 'owner' || x.role === 'admin').map((x) => ({ key: x.key, name: x.name }))
      case 'inviteToCircle': return inviteToCircle(a, b)
      case 'tell': return tell(a, b) // the engine's own (a project's invite), never a page's
      default: throw error('UNKNOWN_METHOD', 'no contacts.' + method)
    }
  }

  /** @param {unknown} identity @param {unknown} name */
  async function request (identity, name) {
    checkKey(identity)
    const known = (await all())[identity]
    if (known?.state === 'friend') throw error('ALREADY', 'already a friend')
    if (known?.state === 'outgoing') return view(identity, known)
    if (known?.state === 'incoming') return accept(identity) // both asked: that is a yes
    if (Object.keys(await all()).length >= CONTACTS_MAX) throw error('TOO_BIG', `at most ${CONTACTS_MAX} contacts`)
    const site = await conversation()
    const link = await site.space.createInvite({ role: 'member' })
    return update((list) => {
      list[identity] = { name: validName(name) ? name : '', state: 'outgoing', chat: site.key, link, at: Date.now() }
      return view(identity, list[identity])
    })
  }

  /** @param {string} identity */
  async function accept (identity) {
    const c = (await all())[identity]
    if (c?.state !== 'incoming') throw error('NOT_FOUND', 'no request from them')
    let site
    try {
      site = await joinInstance(/** @type {string} */ (chat), /** @type {string} */ (c.link))
    } catch (e) {
      const err = /** @type {CodedError} */ (e)
      if (err.code === 'NOT_ALLOWED' || err.code?.startsWith('INVITE_') && err.code !== 'INVITE_INVALID') await update((list) => { delete list[identity] })
      throw err
    }
    await putName(site.space).catch(noop)
    return update((list) => {
      list[identity] = { name: c.name, state: 'friend', chat: site.key, at: Date.now() }
      return view(identity, list[identity])
    })
  }

  // The text keeps the plain link for older Chats; `circle` and `circleName` make the current Chat's button.
  /** @param {string} identity @param {string} circle */
  async function inviteToCircle (identity, circle) {
    const c = (await all())[identity]
    if (c?.state !== 'friend' || !c.chat) throw error('NOT_FOUND', 'not a friend')
    const ring = (/** @type {import('./circles.js').Circle[]} */ (await circles('circles.list'))).find((x) => x.key === circle)
    if (!ring) throw error('NOT_FOUND', 'not one of your circles')
    const { link } = await circles('circles.invite', { key: circle })
    const text = `Join my circle "${ring.name}": ${link}`
    const space = sfs.hg.space(c.chat)
    try {
      await space.put('message', { text, circle: link, circleName: ring.name })
    } catch (err) {
      if (/** @type {CodedError} */ (err).code === 'NOT_ALLOWED') throw err
      await space.put('message', { text }) // a conversation whose types predate the fields: the text only
    }
    return true
  }

  /** @param {string} identity @param {string} text */
  async function tell (identity, text) {
    const c = (await all())[identity]
    if (c?.state !== 'friend' || !c.chat) throw error('NOT_FOUND', 'not a friend')
    await sfs.hg.space(c.chat).put('message', { text })
    return true
  }

  /** @param {string} link */
  async function add (link) {
    needChat() // chat is set from here on
    let inv
    try { inv = invites.decodeLink(link) } catch { throw error('INVALID_PARAMS', 'not a contact link') }
    const maker = inv.public ? null : z32.encode(inv.maker)
    if (maker === me) throw error('ALREADY', 'your own link')
    if ((await all())[/** @type {string} */ (maker)]?.state === 'friend') throw error('ALREADY', 'already a friend')
    const site = await joinInstance(/** @type {string} */ (chat), link)
    if (!maker) {
      await leaveInstance(/** @type {string} */ (chat), site.key).catch(noop)
      throw error('NOT_ALLOWED', 'a contact link is an invite, not a public link')
    }
    await putName(site.space).catch(noop)
    const name = await nameIn(site.key, maker)
    return update((list) => {
      list[maker] = { name: name || '', named: !!name, state: 'friend', chat: site.key, at: Date.now() }
      return view(maker, list[maker])
    })
  }

  async function watch () {
    if (watching || closed) return
    watching = true
    try {
      const list = await all()
      for (const [identity, c] of Object.entries(list)) {
        if (c.state === 'outgoing' && c.chat) await joined(c.chat, identity)
        else if (c.state === 'friend' && !c.named) {
          const name = await nameIn(c.chat, identity)
          if (name) await update((l) => { if (l[identity] && !l[identity].named) Object.assign(l[identity], { name, named: true }) })
        }
      }
      for (const key of Object.keys((await settings())[LINKS] || {})) await joined(key, null)
    } finally {
      watching = false
    }
  }

  // Anyone but `expected` got hold of the invite (an impostor under the person's DHT topic, B5): banned.
  /** @param {string} key @param {string | null} expected */
  async function joined (key, expected) {
    let others
    try {
      others = (await sfs.hg.space(key).members()).filter((m) => !m.you && m.role && !m.banned)
    } catch { return }
    for (const { identity: id, role } of others) {
      if (expected ? id === expected : true) {
        // both people of a direct conversation are admins: either one changes its key (a new device, a removal)
        if (role !== 'admin') await sfs.hg.space(key).setRole(id, 'admin').catch(noop)
        const name = await nameIn(key, id)
        await update((l) => {
          if (expected && l[id]?.state !== 'outgoing') return
          l[id] = { name: name || l[id]?.name || '', named: !!name, state: 'friend', chat: key, at: Date.now() }
        })
        if (!expected) {
          const links = { ...(await settings())[LINKS] }
          delete links[key]
          await sfs.hg.setSetting(LINKS, links)
          expected = id
        }
      } else {
        await sfs.hg.space(key).moderateAction('ban', id, { reason: 'not the person this conversation is for' }).catch(noop)
      }
    }
  }

  async function refresh () {
    const s = await settings()
    const list = s[CONTACTS] || {}
    const findable = s[FINDABLE] !== false
    const want = new Map()
    for (const [id, c] of Object.entries(list)) if (c.state === 'outgoing' && c.link && !c.delivered) want.set(b4a.toString(topicOf(id), 'hex'), id)
    if (closed || (!swarm && !findable && !want.size)) return
    if (!swarm) {
      swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
      swarm.on('connection', onConnection)
    }
    if (findable !== announced) {
      announced = findable
      if (findable) swarm.join(topicOf(me), { server: true, client: false })
      else await swarm.leave(topicOf(me))
    }
    for (const [hex, id] of want) {
      if (!lookups.has(hex)) lookups.set(hex, swarm.join(b4a.from(hex, 'hex'), { server: false, client: true }))
      wanted.set(hex, id)
      for (const [conn, done] of sent) if (!done.has(id) && topicsOf(conn).includes(hex)) send(conn, id)
    }
    for (const hex of [...wanted.keys()]) {
      if (want.has(hex)) continue
      wanted.delete(hex)
      lookups.delete(hex)
      await swarm.leave(b4a.from(hex, 'hex'))
    }
  }

  /** @param {Conn} conn */
  const topicsOf = (conn) => (conn.info?.topics || []).map((t) => b4a.toString(t, 'hex'))

  /** @param {Conn} conn @param {import('hyperswarm').PeerInfo} info */
  function onConnection (conn, info) {
    conn.on('error', noop)
    conn.info = info
    const framed = new FramedStream(conn)
    framed.on('error', noop)
    conn.framed = framed
    sent.set(conn, new Set())
    conn.on('close', () => sent.delete(conn))
    framed.on('data', (buf) => {
      if (buf.byteLength > FRAME_MAX) return conn.destroy()
      let m
      try { m = JSON.parse(b4a.toString(buf)) } catch { return conn.destroy() }
      receive(conn, m).catch(noop)
    })
    for (const hex of topicsOf(conn)) if (wanted.has(hex)) send(conn, /** @type {string} */ (wanted.get(hex)))
  }

  /** @param {Conn} conn @param {object} m */
  function write (conn, m) {
    conn.framed.write(b4a.from(JSON.stringify(m)))
  }

  /** @param {Conn} conn @param {string} identity */
  async function send (conn, identity) {
    sent.get(conn)?.add(identity)
    const c = (await all())[identity]
    if (c?.state === 'outgoing' && c.link) write(conn, { t: 'request', link: c.link, name: await myName() })
  }

  /** @param {Conn} conn @param {any} m a peer's JSON: checked here */
  async function receive (conn, m) {
    if (m?.t === 'ok' && typeof m.chat === 'string') {
      return update((list) => {
        for (const c of Object.values(list)) if (c.state === 'outgoing' && c.chat === m.chat) c.delivered = true
      })
    }
    if (m?.t !== 'request' || typeof m.link !== 'string') return
    if ((await settings())[FINDABLE] === false) return
    let inv
    try { inv = invites.decodeLink(m.link) } catch { return }
    if (inv.public) return
    const from = z32.encode(inv.maker) // the invite's signer: who sent it, whatever the message says
    if (from === me) return
    const chatKey = z32.encode(inv.space)
    await update((list) => {
      const c = list[from]
      if (c?.state === 'friend') return
      if (!c && Object.values(list).filter((x) => x.state === 'incoming').length >= INCOMING_MAX) return
      if (!c && Object.keys(list).length >= CONTACTS_MAX) return
      list[from] = { name: validName(m.name) ? m.name : '', state: 'incoming', chat: chatKey, link: m.link, at: c?.at || Date.now() }
    })
    write(conn, { t: 'ok', chat: chatKey })
  }

  async function close () {
    closed = true
    clearInterval(timer)
    clearInterval(again)
    sfs.hg.off('settings', onSettings)
    if (swarm) await swarm.destroy().catch(noop)
  }

  return {
    call,
    /** @param {string | null} key */
    setChat (key) { if (key !== chat) types = null; chat = key },
    close
  }
}
