/**
 * @typedef {Awaited<ReturnType<Hyper.Site['instances']['list']>>[number] & { direct: Hyper.Contact | null }} Conversation
 *   A group, or a direct conversation with a friend.
 * @typedef {{ link: string, name: string }} CircleInvite
 */

/** @type {Record<string, string>} */
export const ROLES = { member: 'Member', inviter: 'Can add people', moderator: 'Moderator', admin: 'Admin' }
/** @type {Set<string | null>} */
export const MODERATORS = new Set(['owner', 'admin', 'moderator'])
/** @type {Set<string | null>} */
export const INVITERS = new Set(['owner', 'admin', 'inviter'])
export const LIMIT = 300 // shortcut: a conversation shows its latest messages only; page back with `until` when needed

/** @param {Hyper.Copies} copies */
export function copiesLine ({ wanted, kept, online }) {
  if (!wanted) return null
  return { text: `Kept by ${kept} of ${wanted} copies, ${online} online`, warn: online < 2 ? "Few copies online: people may not get this while you're offline" : null }
}
export const CHANGE_KEY = 'A new key from now on; for a lost device or a suspected leak'

export const SECURE_TEXT = 'New keys now, and a new address its members follow by themselves: the people removed or banned can no longer see who joins, who writes or when. What they could read before, they keep.'
export const FORGET_TEXT = "Also delete everything written before now, on every member's device. Copies others already took can't be recalled."
export const TRIM_TEXT = "Older messages are deleted on every member's device and every copy your circles keep. Copies others already took can't be recalled."
export const SUGGEST_SECURE = 'They can no longer read what comes next. To also hide from them who joins and who writes from now on:'
// Until an outside review, the app says "encrypted", never more.
export const ENCRYPTED = 'Encrypted. New members and new devices read from when they join.'
export const ENCRYPTED_KEPT = 'Encrypted. New members read the whole history.'
export const KEEP_HISTORY_TEXT = 'New members will read what is written from now on, before they joined too: the keys are kept to hand over. What was written until now stays unreadable to them.'
export const HIDE_HISTORY_TEXT = 'From now on, new members read only what is written after they join, and each message has its own key.'
export const DISAPPEAR_NOTE = "Messages are deleted from every member's device after this time. Someone using a modified app can still keep them."
/** @type {Array<[number | null, string]>} */
export const DISAPPEAR = [[null, 'Off'], [3600e3, '1 hour'], [24 * 3600e3, '1 day'], [7 * 24 * 3600e3, '7 days'], [30 * 24 * 3600e3, '30 days']]
/** @param {number | null | undefined} ms */
export const disappearLabel = (ms) => (DISAPPEAR.find(([v]) => v === (ms || null)) || [null, Math.round((ms || 0) / 60000) + ' minutes'])[1]

// "X added a device": each member's devices after their first, by when they came.
/**
 * @param {Hyper.Member[]} members
 * @param {(identity: string) => string} nameOf
 * @returns {Array<{ at: number, identity: string, text: string }>} oldest first
 */
export function deviceNotices (members, nameOf) {
  const out = []
  for (const m of members) {
    const added = m.devices.map((d) => d.added).filter((x) => typeof x === 'number').sort((a, b) => a - b)
    for (const at of added.slice(1)) out.push({ at, identity: m.identity, text: nameOf(m.identity) === 'you' ? 'You added a device' : nameOf(m.identity) + ' added a device' })
  }
  return out.sort((a, b) => a.at - b.at)
}
export const RENEW_WAITING = "Keep HyperBrowser open until another admin's device has joined."
const DAY = 24 * 3600e3
/** @type {Record<string, number>} */
const UNITS = { days: DAY, weeks: 7 * DAY, months: 30 * DAY, years: 365 * DAY }
/** @param {number} n @param {string} unit days, weeks, months or years */
export const trimBefore = (n, unit, now = Date.now()) => now - n * UNITS[unit]
/**
 * @param {Hyper.Failure} err
 * @param {(key: string) => string | null} [nameOf]
 */
export function renewError (err, nameOf = () => null) {
  if (err.code === 'ALREADY_RENEWED') {
    const key = (String(err.message).match(/[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/) || [])[0]
    return 'Already renewed by ' + ((key && nameOf(key)) || 'someone else') + '.'
  }
  if (err.code === 'NOT_ALLOWED') return 'Only owners and admins can do this.'
  return err.message
}

/** @param {Hyper.Record} m a message @returns {CircleInvite | null} */
export const circleOf = (m) => typeof m.circle === 'string' && m.circle.startsWith('hg:') ? { link: m.circle, name: m.circleName || 'a circle' } : null

/** @param {string} who @param {string} circle */
export const acceptLabel = (who, circle) => `Accept ${who}'s invitation to "${circle}"`

/** @param {unknown} ok @param {string} message */
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'INVALID_INPUT' }) }

/** @param {Hyper.Site} hyper */
export function chat (hyper) {
  /** @param {string} key */
  const at = (key) => hyper.instance(key)

  // This person's name in a conversation, put once its key is here: an encrypted conversation's key
  // comes when a member who may change it is online, maybe much later or after a restart.
  /** @type {Set<string>} */
  const naming = new Set()
  /** @param {string} key @returns {Promise<boolean>} whether the name is in place */
  async function ensureProfile (key) {
    if (naming.has(key)) return false
    naming.add(key)
    try {
      const name = await myName()
      if (!name) return true
      const s = at(key)
      if ((await s.status()).access !== 'full') return false
      const { identity } = await hyper.info()
      const mine = (await s.query('profile').by(identity).latest(1)).items[0]
      if (!mine || mine.name !== name) await s.put('profile', { name })
      return true
    } finally {
      naming.delete(key)
    }
  }
  // Puts the name now if it can, else when the conversation's status changes (its key arriving).
  /** @param {string} key @returns {Hyper.Unsubscribe} */
  function keepProfile (key) {
    let stop = () => {}
    const check = () => ensureProfile(key).then((done) => { if (done) stop() }, () => {})
    stop = at(key).on('status', check)
    check()
    return () => stop()
  }

  async function myName () {
    return (await hyper.contacts.me()).name
  }

  return {
    /** @returns {Promise<Conversation[]>} */
    async conversations () {
      const [list, contacts] = await Promise.all([hyper.instances.list(), hyper.contacts.list()])
      const byChat = new Map(contacts.filter((c) => c.chat && c.state !== 'incoming').map((c) => [c.chat, c]))
      return list.map((i) => ({ ...i, direct: byChat.get(i.key) || null }))
    },

    /** @param {unknown} name */
    async group (name) {
      need(String(name || '').trim(), 'a group needs a name')
      const g = await hyper.instances.create(String(name).trim(), { private: true })
      const c = at(g.key)
      await c.setHistory('hidden') // encrypted: each message its own key; a new member reads from its join on
      await c.defineRole('inviter', ['post', 'invite'])
      const me = await myName()
      if (me) await c.put('profile', { name: me })
      return g
    },

    /** @param {string} key @param {unknown} text */
    async send (key, text) {
      need(String(text || '').trim(), 'nothing to send')
      return at(key).put('message', { text: String(text) })
    },
    /** @param {string} key @param {string} id @param {unknown} text */
    edit: (key, id, text) => at(key).edit(id, { text: String(text) }),
    /** @param {string} key @param {Hyper.Record} message @param {boolean} mine */
    remove: (key, message, mine) => mine ? at(key).del(message.id) : at(key).moderateAction('remove', message.id),

    /** @param {string} key @param {(page: Hyper.Page) => void} fn */
    messages: (key, fn) => at(key).query('message').live(fn, { limit: LIMIT }),
    /** @param {string} key @param {(page: Hyper.Page) => void} fn */
    invites: (key, fn) => at(key).query('invite').live(fn, { limit: 50 }),
    /** @param {string} key @returns {Promise<Map<string, string>>} */
    names: async (key) => new Map((await at(key).query('profile').latest(1000)).items.map((p) => [p.author, p.name])),
    /** @param {string} key */
    members: (key) => at(key).members(),
    /** @param {string} key */
    role: async (key) => at(key).getRole((await hyper.info()).identity),

    /**
     * A friend into a group: an invite only they can use in practice, sent in your direct conversation with them.
     * @param {string} group
     * @param {string | null} name the group's
     * @param {Hyper.Contact | undefined} friend
     */
    async add (group, name, friend) {
      need(friend?.chat && friend.state === 'friend', 'only a friend can be added')
      const link = await at(group).createInvite({ role: 'member' })
      return at(/** @type {Hyper.Contact} */ (friend).chat).put('invite', { link, name })
    },
    /** @param {string} link */
    async join (link) {
      const g = await hyper.instances.join(link)
      keepProfile(g.key) // until it is put
      return g
    },
    keepProfile,

    /** @param {string} key @param {string} identity @param {string} role */
    grant: (key, identity, role) => at(key).setRole(identity, role),
    /** @param {string} key @param {string} identity */
    ban: (key, identity) => at(key).moderateAction('ban', identity, { reason: 'banned from the group' }),
    /** @param {string} key @param {string} identity */
    removeMember: (key, identity) => at(key).removeRole(identity),
    /** @param {string} key */
    leave: (key) => hyper.instances.leave(key),

    /** @param {string} key */
    copies: (key) => at(key).copies(),
    /** @param {string} key @param {(copies: Hyper.Copies) => void} fn */
    onCopies: (key, fn) => at(key).on('copies', fn),
    /** @param {string} key */
    changeKey: (key) => at(key).rotateKey(),
    /** @param {string} key @param {boolean} keep newcomers read the history (a group's choice, after a warning) */
    keepHistory: (key, keep) => at(key).setHistory(keep ? 'visible' : 'hidden'),
    /** @param {string} key @param {number | null} ms */
    disappearAfter: (key, ms) => at(key).setDisappearing(ms),
    /** @param {string} key @param {{ forgetHistory?: boolean }} [opts] */
    secure: (key, { forgetHistory = false } = {}) => at(key).secure({ forget: forgetHistory }),
    /** @param {string} key @param {number} before */
    trimHistory: (key, before) => at(key).trimHistory({ before }),
    /** @param {string} key */
    info: (key) => at(key).info(),
    /** @param {string} key */
    status: (key) => at(key).status(),
    /** @param {CircleInvite} inv */
    joinCircle: (inv) => hyper.circles.join(inv.link, inv.name)
  }
}
