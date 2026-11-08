// Contacts (spec 013): the person's contact list, in their settings (on every device of theirs). A friend
// request is a private conversation of the Chat app (an instance, spec 009) made by the sender, with a one-use
// invite to it; the invite reaches the other person over the DHT (a topic derived from their identity, while
// both are online) or as a contact link sent by any channel. The invite is signed by its maker: the receiver
// reads the sender from it, never from the message. Accepting joins the conversation.
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import FramedStream from 'framed-stream'
import b4a from 'b4a'
import z32 from 'z32'
import invites from 'hypergraph/lib/invites.js'
import { parseManifest } from './manifest.js'

const CONTACTS = 'hyperbrowser/contacts' // { [identity]: { name, state, chat, link?, delivered?, named?, at } }
const LINKS = 'hyperbrowser/contact-links' // { [conversation key]: at }: contact links nobody opened yet
const FINDABLE = 'hyperbrowser/findable' // false: this person's devices don't answer under their key
const NAME = 'name' // SwarmFS's name of the person, shared by every app
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const CONTACTS_MAX = 1000
const INCOMING_MAX = 100 // requests anyone can send: the rest are dropped until some are answered
const FRAME_MAX = 4096
const WATCH = 2000 // pending conversations checked this often
const LOOKUP = 15000 // an undelivered request's person looked up again this often (they may have come online)

const error = (code, message) => Object.assign(new Error(message), { code })
const validName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 64 && !/[\x00-\x1f\x7f]/.test(n) // eslint-disable-line no-control-regex
const topicOf = (identity) => crypto.hash(b4a.from('hyperbrowser/contacts/1/' + identity))
const noop = () => {}

// sfs: the engine's SwarmFS. joinInstance(app, link) → the site, an instance of `app` (else NOT_ALLOWED);
// listInstance(app, key, on); leaveInstance(app, key). bootstrap: the DHT's (tests).
export function contacts ({ sfs, bootstrap, joinInstance, listInstance, leaveInstance }) {
  let chat = null // the Chat app's key (apps.set): direct conversations are its instances
  let types = null // its record types, for the conversations made here
  let writing = Promise.resolve()
  let swarm = null
  let announced = false
  const wanted = new Map() // topic hex -> identity: requests not delivered yet
  const lookups = new Map() // topic hex -> Hyperswarm's discovery
  const sent = new Map() // connection -> Set of identities whose request went on it
  let watching = false
  let closed = false
  const me = sfs.hg.identity.publicKey
  const timer = setInterval(() => watch().catch(noop), WATCH)
  const again = setInterval(() => { for (const d of lookups.values()) d.refresh().catch(noop) }, LOOKUP)
  const onSettings = () => { if (!closed) refresh().catch(noop) }
  sfs.hg.on('settings', onSettings)
  refresh().catch(noop)

  const settings = () => sfs.hg.settings()
  const all = async () => (await settings())[CONTACTS] || {}

  // One read-and-write of the list at a time: fn(list) changes it in place.
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

  const view = (identity, c) => ({ identity, name: c.name, state: c.state, chat: c.chat, at: c.at })

  function needChat () {
    if (!chat) throw error('NOT_READY', 'no chat app yet')
  }

  function checkKey (identity) {
    if (typeof identity !== 'string' || !KEY.test(identity)) throw error('INVALID_PARAMS', 'not a person\'s key')
    if (identity === me) throw error('ALREADY', 'that is you')
  }

  async function myName () {
    const n = (await settings())[NAME]
    return validName(n) ? n : ''
  }

  // A new direct conversation, owned here, reachable by the Chat app, with this person's name in it.
  async function conversation () {
    needChat()
    if (!types) {
      let app
      try { sfs.hg.space(chat); app = await sfs.site(chat) } catch { app = await sfs.visit('hg:' + chat) }
      types = parseManifest(await app.read('site.json')).types || {}
    }
    const site = await sfs.createSite((await myName()) || 'Chat', { app: chat, types, private: true })
    await listInstance(chat, site.key, true)
    await putName(site.space)
    return site
  }

  async function putName (space) {
    const name = await myName()
    if (name) await space.put('profile', { name })
  }

  async function nameIn (key, identity) {
    try {
      const { items } = await sfs.hg.space(key).query('profile').by(identity).latest(1)
      return validName(items[0]?.name) ? items[0].name : null
    } catch { return null }
  }

  // --- the calls (contract: specs/013-contacts-chat/contracts/site-api.md) ---

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
        if (c.chat && c.state !== 'incoming') await leaveInstance(chat, c.chat).catch(noop) // gone already: fine
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
      default: throw error('UNKNOWN_METHOD', 'no contacts.' + method)
    }
  }

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

  async function accept (identity) {
    const c = (await all())[identity]
    if (c?.state !== 'incoming') throw error('NOT_FOUND', 'no request from them')
    let site
    try {
      site = await joinInstance(chat, c.link)
    } catch (err) {
      if (err.code === 'NOT_ALLOWED' || err.code?.startsWith('INVITE_') && err.code !== 'INVITE_INVALID') await update((list) => { delete list[identity] }) // never usable
      throw err
    }
    await putName(site.space).catch(noop)
    return update((list) => {
      list[identity] = { name: c.name, state: 'friend', chat: site.key, at: Date.now() }
      return view(identity, list[identity])
    })
  }

  async function add (link) {
    needChat()
    let inv
    try { inv = invites.decodeLink(link) } catch { throw error('INVALID_PARAMS', 'not a contact link') }
    const maker = inv.public ? null : z32.encode(inv.maker)
    if (maker === me) throw error('ALREADY', 'your own link')
    if ((await all())[maker]?.state === 'friend') throw error('ALREADY', 'already a friend')
    const site = await joinInstance(chat, link) // NOT_ALLOWED: not a Chat conversation
    if (!maker) {
      await leaveInstance(chat, site.key).catch(noop)
      throw error('NOT_ALLOWED', 'a contact link is an invite, not a public link')
    }
    await putName(site.space).catch(noop)
    const name = await nameIn(site.key, maker)
    return update((list) => {
      list[maker] = { name: name || '', named: !!name, state: 'friend', chat: site.key, at: Date.now() }
      return view(maker, list[maker])
    })
  }

  // --- the watch: pending conversations someone joined, names not known yet ---

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

  // Who joined conversation `key`: `expected` becomes a friend, anyone else is banned (they got hold of the
  // invite: answered under the person's DHT name, B5). A contact link (expected null): its first joiner.
  async function joined (key, expected) {
    let others
    try {
      others = (await sfs.hg.space(key).members()).filter((m) => !m.you && m.role && !m.banned).map((m) => m.identity)
    } catch { return }
    for (const id of others) {
      if (expected ? id === expected : true) {
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

  // --- presence on the DHT ---

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
      for (const [conn, done] of sent) if (!done.has(id) && topicsOf(conn).includes(hex)) send(conn, id) // a peer met before
    }
    for (const hex of [...wanted.keys()]) {
      if (want.has(hex)) continue
      wanted.delete(hex)
      lookups.delete(hex)
      await swarm.leave(b4a.from(hex, 'hex'))
    }
  }

  const topicsOf = (conn) => (conn.info?.topics || []).map((t) => b4a.toString(t, 'hex'))

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
    for (const hex of topicsOf(conn)) if (wanted.has(hex)) send(conn, wanted.get(hex))
  }

  function write (conn, m) {
    conn.framed.write(b4a.from(JSON.stringify(m)))
  }

  async function send (conn, identity) {
    sent.get(conn)?.add(identity)
    const c = (await all())[identity]
    if (c?.state === 'outgoing' && c.link) write(conn, { t: 'request', link: c.link, name: await myName() })
  }

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
    setChat (key) { if (key !== chat) types = null; chat = key },
    close
  }
}
