// Chat's data (spec 013), through the site API only (`hyper`: the page's window.hyper, or the tests' engine
// adapter). Every conversation is a private instance of this app: a direct one (made by HyperBrowser when two
// people become friends: the contacts list names it) or a group (made here, owned by its maker). Rights in a
// group are hypergraph roles: member (writes), inviter (also adds people), moderator (deletes, bans), admin
// (all but ownership).

export const ROLES = { member: 'Member', inviter: 'Can add people', moderator: 'Moderator', admin: 'Admin' }
export const MODERATORS = new Set(['owner', 'admin', 'moderator'])
export const INVITERS = new Set(['owner', 'admin', 'inviter'])
export const LIMIT = 300 // shortcut: a conversation shows its latest messages only; page back with `until` when needed

const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'INVALID_INPUT' }) }

export function chat (hyper) {
  const at = (key) => hyper.instance(key)

  async function myName () {
    return (await hyper.contacts.me()).name
  }

  return {
    // [{ key, name, role, direct: contact | null }]: groups and direct conversations
    async conversations () {
      const [list, contacts] = await Promise.all([hyper.instances.list(), hyper.contacts.list()])
      const byChat = new Map(contacts.filter((c) => c.chat && c.state !== 'incoming').map((c) => [c.chat, c]))
      return list.map((i) => ({ ...i, direct: byChat.get(i.key) || null }))
    },

    async group (name) {
      need(String(name || '').trim(), 'a group needs a name')
      const g = await hyper.instances.create(String(name).trim(), { private: true })
      const c = at(g.key)
      await c.defineRole('inviter', ['post', 'invite'])
      const me = await myName()
      if (me) await c.put('profile', { name: me })
      return g
    },

    async send (key, text) {
      need(String(text || '').trim(), 'nothing to send')
      return at(key).put('message', { text: String(text) })
    },
    edit: (key, id, text) => at(key).edit(id, { text: String(text) }),
    // one's own: deleted; someone else's (a moderator): removed for everyone
    remove: (key, message, mine) => mine ? at(key).del(message.id) : at(key).moderateAction('remove', message.id),

    messages: (key, fn) => at(key).query('message').live(fn, { limit: LIMIT }),
    invites: (key, fn) => at(key).query('invite').live(fn, { limit: 50 }),
    names: async (key) => new Map((await at(key).query('profile').latest(1000)).items.map((p) => [p.author, p.name])),
    members: (key) => at(key).members(),
    role: async (key) => at(key).getRole((await hyper.info()).identity),

    // A friend into a group: an invite only they can use in practice, sent in your direct conversation with them.
    async add (group, name, friend) {
      need(friend?.chat && friend.state === 'friend', 'only a friend can be added')
      const link = await at(group).createInvite({ role: 'member' })
      return at(friend.chat).put('invite', { link, name })
    },
    async join (link) {
      const g = await hyper.instances.join(link)
      const me = await myName()
      if (me) await at(g.key).put('profile', { name: me })
      return g
    },

    grant: (key, identity, role) => at(key).setRole(identity, role),
    ban: (key, identity) => at(key).moderateAction('ban', identity, { reason: 'banned from the group' }),
    removeMember: (key, identity) => at(key).removeRole(identity),
    leave: (key) => hyper.instances.leave(key)
  }
}
