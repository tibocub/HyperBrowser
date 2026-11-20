import { mentioned, KEY } from './text.js'
import { valid } from './icon.js'
import { addNew } from './view.js'

// shortcut: live views hold at most this many records of each type; past it, use count()/sum() per shown thread
export const LIMITS = { boards: 200, threads: 500, comments: 2000, votes: 5000, people: 1000, thread: 1000 }
/** @type {Set<string | null | undefined>} */
export const MODERATORS = new Set(['owner', 'admin', 'moderator'])
/** @type {Set<string | null | undefined>} */
export const ADMINS = new Set(['owner', 'admin'])
const SINCE = 1000 // records a since() call returns at most (the engine's cap)

/**
 * @typedef {{ [thread: string]: string[] }} Unread Per thread, its unread comments' ids ([] for a new thread).
 * @typedef {{ cursor: { [log: string]: number } | null, unread: Unread }} News
 * @typedef {{ complete: { [view: string]: boolean }, boards: Hyper.Record[], threads: Hyper.Record[], comments: Hyper.Record[],
 *   votes: Hyper.Record[], profiles: Hyper.Record[], avatars: Hyper.Record[] }} State The forum's live views.
 * @typedef {{ name?: string, icon?: Uint8Array }} Person
 */

/** @param {unknown} ok @param {string} message */
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'INVALID_INPUT' }) }
/** @param {unknown} s */
const clean = (s) => String(s ?? '').trim()

/** @param {Hyper.Copies} copies */
export function copiesLine ({ wanted, kept, online }) {
  if (!wanted) return null
  return { text: `Kept by ${kept} of ${wanted} copies, ${online} online`, warn: online < 2 ? "Few copies online: people may not get this while you're offline" : null }
}
export const CHANGE_KEY = 'A new key from now on; for a lost device or a suspected leak'

// The same texts are in Chat's lib/chat.js: keep them in step.
export const SECURE_TEXT = 'New keys now, and a new address its members follow by themselves: the people removed or banned can no longer see who joins, who posts or when. What they could read before, they keep.'
export const FORGET_TEXT = "Also delete everything written before now, on every member's device. Copies others already took can't be recalled."
export const TRIM_TEXT = "Older posts are deleted on every member's device and every copy your circles keep. Copies others already took can't be recalled."
export const SUGGEST_SECURE = "They can no longer read what comes next. To also hide who joins and posts from now on: Secure this place."
export const RENEW_WAITING = "Keep HyperBrowser open until another admin's device has joined."
const DAY = 24 * 3600e3
/** @type {Record<string, number>} */
const UNITS = { days: DAY, weeks: 7 * DAY, months: 30 * DAY, years: 365 * DAY }
/** @param {number} n @param {string} unit days, weeks, months or years */
export const trimBefore = (n, unit, now = Date.now()) => now - n * UNITS[unit]
/**
 * @param {Hyper.Failure} err
 * @param {(key: string) => string | null | undefined} [nameOf]
 */
export function renewError (err, nameOf = () => null) {
  if (err.code === 'ALREADY_RENEWED') {
    const key = (String(err.message).match(/[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/) || [])[0]
    return 'Already renewed by ' + ((key && nameOf(key)) || 'someone else') + '.'
  }
  if (err.code === 'NOT_ALLOWED') return 'Only owners and admins can do this.'
  return err.message
}

/** @param {Hyper.Place} hyper a forum: an instance of the app */
export function forum (hyper) {
  /**
   * also: the author of what a reply answers (a reply notifies them), unless it is oneself
   * @param {string} on
   * @param {string} text
   * @param {string | null} [also]
   */
  async function writeMentions (on, text, also = null) {
    const who = new Set(mentioned(text))
    if (also && also !== (await hyper.info()).identity) who.add(also)
    for (const w of who) await hyper.put('mention', { who: w, on })
  }

  return {
    hyper,

    async me () {
      const info = await hyper.info()
      return { ...info, role: await hyper.getRole(info.identity) }
    },

    /** @param {{ name: string, about?: string, parent?: string | null, order?: number }} board */
    async makeBoard ({ name, about = '', parent = null, order = 0 }) {
      need(clean(name), 'a board needs a name')
      /** @type {Hyper.Fields} */
      const fields = { name: clean(name), about: clean(about), order }
      if (parent) fields.parent = parent
      return hyper.put('board', fields)
    },
    /** @param {string} id @param {Hyper.Fields} fields */
    editBoard: (id, fields) => hyper.edit(id, fields),
    /** @param {string} id */
    removeBoard: (id) => hyper.del(id),

    /** @param {string} board @param {{ title: string, text?: string }} thread */
    async post (board, { title, text }) {
      need(clean(title), 'a thread needs a title')
      need(clean(title).length <= 300, 'a title is at most 300 characters')
      const t = await hyper.put('thread', { title: clean(title), text: String(text || ''), board })
      await writeMentions(t.id, t.text)
      return t
    },
    /** @param {string} thread @param {string | null} on the comment it answers; the thread when null @param {string} text */
    async reply (thread, on, text) {
      need(clean(text), 'a reply needs some text')
      const c = await hyper.put('comment', { text: String(text), on: on || thread, thread })
      const parent = (await hyper.get(on || thread).catch(() => null))?.record
      await writeMentions(c.id, c.text, parent?.author)
      return c
    },
    // Edits keep mentions in step: new ones written (the old ones stay: a mention once seen stays in the list).
    /** @param {Hyper.Record} record @param {Hyper.Fields} fields */
    async edit (record, fields) {
      const r = await hyper.edit(record.id, fields)
      if (fields.text !== undefined) {
        const before = new Set(mentioned(record.text))
        for (const who of mentioned(fields.text)) if (!before.has(who)) await hyper.put('mention', { who, on: record.id })
      }
      return r
    },
    /** @param {string} id */
    remove: (id) => hyper.del(id),
    /** @param {string} on @param {number} value -1, 0 or 1 */
    vote: (on, value) => hyper.put('vote', { on, value }),

    /** @param {unknown} name */
    async setName (name) {
      need(clean(name) && clean(name).length <= 40, 'a name is 1 to 40 characters')
      return hyper.put('profile', { name: clean(name) })
    },
    /** @param {unknown} bytes */
    async setIcon (bytes) {
      need(valid(bytes), 'an icon is 16×16 bits (32 bytes)')
      return hyper.put('avatar', { icon: bytes })
    },

    /** @param {string} id */
    report: (id, reason = '') => hyper.report(id, { reason: clean(reason).slice(0, 1000) }),
    /** @param {string} id */
    hide: (id, reason = '') => hyper.moderateAction('hide', id, { reason: clean(reason) }),
    /** @param {string} id */
    reveal: (id) => hyper.moderateAction('reveal', id),
    /** @param {Hyper.Target} report a report (or its id) of reports() */
    dismiss: (report) => hyper.moderateAction('remove', report),
    /** @param {string} identity */
    async ban (identity, reason = '') {
      need(KEY.test(identity), 'not a member key')
      return hyper.moderateAction('ban', identity, { reason: clean(reason) })
    },
    /** @param {string} identity */
    unban: (identity) => hyper.moderateAction('unban', identity),
    /** @param {string} identity @param {string} role */
    setRole: (identity, role) => hyper.setRole(identity, role),
    /** @param {{ role?: string, uses?: number }} [opts] */
    invite: ({ role = 'member', uses = 1 } = {}) => hyper.createInvite({ role, uses }),
    /** @param {{ forgetHistory?: boolean }} [opts] */
    secure: ({ forgetHistory = false } = {}) => hyper.secure({ forget: forgetHistory }),
    /** @param {number} days */
    trimHistory: (days) => hyper.trimHistory({ before: trimBefore(days, 'days') }),

    mine: () => hyper.mine.all(),
    /** @param {string[]} names */
    async forget (names) { for (const n of names) await hyper.mine.set(n, null) },
    /**
     * A first look (no cursor) starts from now: what was there is read.
     * @param {Partial<News>} news
     * @param {string} me
     * @returns {Promise<News>}
     */
    async catchUp ({ cursor = null, unread = {} } = {}, me) {
      for (;;) {
        const r = await hyper.since(cursor, { types: ['thread', 'comment'], limit: SINCE })
        if (cursor !== null) unread = addNew(unread, r.records, me)
        cursor = r.cursor
        if (r.records.length < SINCE) return { cursor, unread }
      }
    },
    // two names: each value has its own 64 KB (shortcut: a cursor is ~60 bytes per writing member, so a forum of
    // more than ~1,000 of them needs it split, or kept by the engine)
    /** @param {News} news */
    saveUnread: ({ cursor, unread }) => Promise.all([hyper.mine.set('cursor', cursor), hyper.mine.set('unread', unread)]),
    /** @param {string} how */
    setSort: (how) => hyper.mine.set('sort', how),
    /** @param {number} stamp */
    markMentionsSeen: (stamp) => hyper.mine.set('mentions', stamp)
  }
}

/**
 * Live views of the forum's records; `onchange(state, view)` on every change.
 * @param {Hyper.Space} hyper
 * @param {(state: State, name: string) => void} onchange
 */
export function watch (hyper, onchange) {
  const state = /** @type {State} */ ({ complete: {} }) // each view's list set below
  /** @type {Array<[Exclude<keyof State, 'complete'>, string, number]>} */
  const views = [
    ['boards', 'board', LIMITS.boards],
    ['threads', 'thread', LIMITS.threads],
    ['comments', 'comment', LIMITS.comments],
    ['votes', 'vote', LIMITS.votes],
    ['profiles', 'profile', LIMITS.people],
    ['avatars', 'avatar', LIMITS.people]
  ]
  const stops = views.map(([name, type, limit]) => {
    state[name] = []
    state.complete[name] = false
    return hyper.query(type).live(({ items, complete }) => {
      state[name] = items
      state.complete[name] = complete
      onchange(state, name)
    }, { limit })
  })
  return { state, stop: () => stops.forEach((s) => s()) }
}

/**
 * Each member's latest name and icon.
 * @param {Hyper.Record[]} profiles
 * @param {Hyper.Record[]} avatars
 * @returns {Map<string, Person>}
 */
export function people (profiles, avatars) {
  /** @type {Map<string, Person & { [field: string]: unknown }>} */
  const out = new Map()
  /** @param {Hyper.Record[]} list @param {string} field */
  const latest = (list, field) => {
    for (const r of [...list].sort((a, b) => a.stamp - b.stamp)) {
      const p = out.get(r.author) || {}
      p[field] = r[field]
      out.set(r.author, p)
    }
  }
  latest(profiles, 'name')
  latest(avatars, 'icon')
  return out
}
