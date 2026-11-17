// The forum's data, through the site API only (`hyper`: the page's window.hyper, or the tests' engine adapter).
// Types: site.json. What is derived for the pages: view.js. The person's own data (read state, sort): hyper.mine.

import { mentioned, KEY } from './text.js'
import { valid } from './icon.js'
import { addNew } from './view.js'

// shortcut: live views hold at most this many records of each type; past it, use count()/sum() per shown thread
export const LIMITS = { boards: 200, threads: 500, comments: 2000, votes: 5000, people: 1000, thread: 1000 }
export const MODERATORS = new Set(['owner', 'admin', 'moderator'])
export const ADMINS = new Set(['owner', 'admin'])
const SINCE = 1000 // records a since() call returns at most (the engine's cap)

const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'INVALID_INPUT' }) }
const clean = (s) => String(s ?? '').trim()

// spec 018: "Kept by N of 5 copies, M online" from hyper.copies(), and the warning under 2 online; null when nothing
// is handed (no circle holding).
export function copiesLine ({ wanted, kept, online }) {
  if (!wanted) return null
  return { text: `Kept by ${kept} of ${wanted} copies, ${online} online`, warn: online < 2 ? "Few copies online: people may not get this while you're offline" : null }
}
export const CHANGE_KEY = 'A new key from now on; for a lost device or a suspected leak'

// spec 023 (hypergraph 027): Secure this place, Trim history. The same texts in Chat.
export const SECURE_TEXT = 'New keys now, and a new address its members follow by themselves: the people removed or banned can no longer see who joins, who posts or when. What they could read before, they keep.'
export const FORGET_TEXT = "Also delete everything written before now, on every member's device. Copies others already took can't be recalled."
export const TRIM_TEXT = "Older posts are deleted on every member's device and every copy your circles keep. Copies others already took can't be recalled."
export const SUGGEST_SECURE = "They can no longer read what comes next. To also hide who joins and posts from now on: Secure this place."
export const RENEW_WAITING = "Keep HyperBrowser open until another admin's device has joined."
const DAY = 24 * 3600e3
const UNITS = { days: DAY, weeks: 7 * DAY, months: 30 * DAY, years: 365 * DAY }
// "keep the last n weeks": the time before which posts go
export const trimBefore = (n, unit, now = Date.now()) => now - n * UNITS[unit]
// An error of secure() or trimHistory(), in plain words (`nameOf`: a member's name from their key).
export function renewError (err, nameOf = () => null) {
  if (err.code === 'ALREADY_RENEWED') {
    const key = (String(err.message).match(/[ybndrfg8ejkmcpqxot1uwisza345h769]{52}/) || [])[0]
    return 'Already renewed by ' + ((key && nameOf(key)) || 'someone else') + '.'
  }
  if (err.code === 'NOT_ALLOWED') return 'Only owners and admins can do this.'
  return err.message
}

export function forum (hyper) {
  // also: the author of what a reply answers (spec 017 R6: a reply notifies them), unless it is oneself
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

    // --- boards (owner and admins) ---
    async makeBoard ({ name, about = '', parent = null, order = 0 }) {
      need(clean(name), 'a board needs a name')
      const fields = { name: clean(name), about: clean(about), order }
      if (parent) fields.parent = parent
      return hyper.put('board', fields)
    },
    editBoard: (id, fields) => hyper.edit(id, fields),
    removeBoard: (id) => hyper.del(id),

    // --- threads and replies ---
    async post (board, { title, text }) {
      need(clean(title), 'a thread needs a title')
      need(clean(title).length <= 300, 'a title is at most 300 characters')
      const t = await hyper.put('thread', { title: clean(title), text: String(text || ''), board })
      await writeMentions(t.id, t.text)
      return t
    },
    async reply (thread, on, text) {
      need(clean(text), 'a reply needs some text')
      const c = await hyper.put('comment', { text: String(text), on: on || thread, thread })
      const parent = (await hyper.get(on || thread).catch(() => null))?.record
      await writeMentions(c.id, c.text, parent?.author)
      return c
    },
    // Edits keep mentions in step: new ones written (the old ones stay: a mention once seen stays in the list).
    async edit (record, fields) {
      const r = await hyper.edit(record.id, fields)
      if (fields.text !== undefined) {
        const before = new Set(mentioned(record.text))
        for (const who of mentioned(fields.text)) if (!before.has(who)) await hyper.put('mention', { who, on: record.id })
      }
      return r
    },
    remove: (id) => hyper.del(id),
    vote: (on, value) => hyper.put('vote', { on, value }),

    // --- people: name (SwarmFS's profile), icon (avatar) ---
    async setName (name) {
      need(clean(name) && clean(name).length <= 40, 'a name is 1 to 40 characters')
      return hyper.put('profile', { name: clean(name) })
    },
    async setIcon (bytes) {
      need(valid(bytes), 'an icon is 16×16 bits (32 bytes)')
      return hyper.put('avatar', { icon: bytes })
    },

    // --- moderation (hypergraph's), members, invites ---
    report: (id, reason = '') => hyper.report(id, { reason: clean(reason).slice(0, 1000) }),
    hide: (id, reason = '') => hyper.moderateAction('hide', id, { reason: clean(reason) }),
    reveal: (id) => hyper.moderateAction('reveal', id),
    dismiss: (report) => hyper.moderateAction('remove', report),
    async ban (identity, reason = '') {
      need(KEY.test(identity), 'not a member key')
      return hyper.moderateAction('ban', identity, { reason: clean(reason) })
    },
    unban: (identity) => hyper.moderateAction('unban', identity),
    setRole: (identity, role) => hyper.setRole(identity, role),
    invite: ({ role = 'member', uses = 1 } = {}) => hyper.createInvite({ role, uses }),
    // spec 023: owners and admins of a private forum; resolves to { key } of the secured forum
    secure: ({ forgetHistory = false } = {}) => hyper.secure({ forget: forgetHistory }),
    trimHistory: (days) => hyper.trimHistory({ before: trimBefore(days, 'days') }),

    // --- the person's own (on their devices, never in the forum) ---
    mine: () => hyper.mine.all(),
    async forget (names) { for (const n of names) await hyper.mine.set(n, null) },
    // spec 017 R5: what is new since the last look ({ cursor, unread }), found with since(): by message numbers.
    // A first look (no cursor) starts from now: what was there is read.
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
    saveUnread: ({ cursor, unread }) => Promise.all([hyper.mine.set('cursor', cursor), hyper.mine.set('unread', unread)]),
    setSort: (how) => hyper.mine.set('sort', how),
    markMentionsSeen: (stamp) => hyper.mine.set('mentions', stamp)
  }
}

// One live view per type, kept in `state[name]` (items) and `state.complete[name]`; onchange() after each.
export function watch (hyper, onchange) {
  const state = { complete: {} }
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

// Each member's latest name and icon: Map identity → { name, icon }.
export function people (profiles, avatars) {
  const out = new Map()
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
