// The forum's data, through the site API only (`hyper`: the page's window.hyper, or the tests' engine adapter).
// Types: site.json. What is derived for the pages: view.js. The person's own data (read state, sort): hyper.mine.

import { mentioned, KEY } from './text.js'
import { valid } from './icon.js'

// shortcut: live views hold at most this many records of each type; past it, use count()/sum() per shown thread
export const LIMITS = { boards: 200, threads: 500, comments: 2000, votes: 5000, people: 1000, thread: 1000 }
export const MODERATORS = new Set(['owner', 'admin', 'moderator'])
export const ADMINS = new Set(['owner', 'admin'])

const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code: 'INVALID_INPUT' }) }
const clean = (s) => String(s ?? '').trim()

export function forum (hyper) {
  async function writeMentions (on, text) {
    for (const who of mentioned(text)) await hyper.put('mention', { who, on })
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
      await writeMentions(c.id, c.text)
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

    // --- the person's own (on their devices, never in the forum) ---
    mine: () => hyper.mine.all(),
    markRead: (thread, activity) => hyper.mine.set('read/' + thread, activity),
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
