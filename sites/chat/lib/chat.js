// Chat's data (spec 013), through the site API only (`hyper`: the page's window.hyper, or the tests' engine
// adapter). Every conversation is a private instance of this app: a direct one (made by HyperBrowser when two
// people become friends: the contacts list names it) or a group (made here, owned by its maker). Rights in a
// group are hypergraph roles: member (writes), inviter (also adds people), moderator (deletes, bans), admin
// (all but ownership).

export const ROLES = { member: 'Member', inviter: 'Can add people', moderator: 'Moderator', admin: 'Admin' }
export const MODERATORS = new Set(['owner', 'admin', 'moderator'])
export const INVITERS = new Set(['owner', 'admin', 'inviter'])
export const LIMIT = 300 // shortcut: a conversation shows its latest messages only; page back with `until` when needed

// spec 018: "Kept by N of 5 copies, M online" from hyper.copies(), and the warning under 2 online; null when nothing
// is handed (no circle holding).
export function copiesLine ({ wanted, kept, online }) {
  if (!wanted) return null
  return { text: `Kept by ${kept} of ${wanted} copies, ${online} online`, warn: online < 2 ? "Few copies online: people may not get this while you're offline" : null }
}
export const CHANGE_KEY = 'A new key from now on; for a lost device or a suspected leak'

// spec 023 (hypergraph 027): Secure this place and Trim history in a group's "…" (the same texts as the Forum's)
export const SECURE_TEXT = 'New keys now, and a new address its members follow by themselves: the people removed or banned can no longer see who joins, who writes or when. What they could read before, they keep.'
export const FORGET_TEXT = "Also delete everything written before now, on every member's device. Copies others already took can't be recalled."
export const TRIM_TEXT = "Older messages are deleted on every member's device and every copy your circles keep. Copies others already took can't be recalled."
export const SUGGEST_SECURE = 'They can no longer read what comes next. To also hide who joins and writes from now on: … then Secure this place.'
export const RENEW_WAITING = "Keep HyperBrowser open until another admin's device has joined."
const DAY = 24 * 3600e3
const UNITS = { days: DAY, weeks: 7 * DAY, months: 30 * DAY, years: 365 * DAY }
export const trimBefore = (n, unit, now = Date.now()) => now - n * UNITS[unit]
export function renewError (err, nameOf = () => null) {
  if (err.code === 'ALREADY_RENEWED') {
    const key = (String(err.message).match(/[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/) || [])[0]
    return 'Already renewed by ' + ((key && nameOf(key)) || 'someone else') + '.'
  }
  if (err.code === 'NOT_ALLOWED') return 'Only owners and admins can do this.'
  return err.message
}

// spec 018: a circle's invite in a message (docs/chat.md: `circle`, `circleName`), or null
export const circleOf = (m) => typeof m.circle === 'string' && m.circle.startsWith('hg:') ? { link: m.circle, name: m.circleName || 'a circle' } : null

// spec 019: the invite's button, naming who invites (as Chat shows them) and to what
export const acceptLabel = (who, circle) => `Accept ${who}'s invitation to "${circle}"`

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
    leave: (key) => hyper.instances.leave(key),

    // spec 018
    copies: (key) => at(key).copies(),
    onCopies: (key, fn) => at(key).on('copies', fn),
    changeKey: (key) => at(key).rotateKey(),
    // spec 023: a group's owner and admins
    secure: (key, { forgetHistory = false } = {}) => at(key).secure({ forget: forgetHistory }),
    trimHistory: (key, before) => at(key).trimHistory({ before }),
    info: (key) => at(key).info(),
    status: (key) => at(key).status(),
    joinCircle: (inv) => hyper.circles.join(inv.link, inv.name)
  }
}
