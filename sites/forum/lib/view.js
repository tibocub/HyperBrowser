/**
 * @typedef {Hyper.Record} R
 * @typedef {Map<string, Map<string, number>>} Tally per record, each member's vote
 * @typedef {{ thread: R, replies: number, activity: number, score: number, lively: number }} Summary
 * @typedef {{ id: string, comment: R | null, depth: number, segs: string[], under: number }} Row A comment's row, or a gone parent's.
 */

export const SORTS = ['activity', 'newest', 'top', 'lively']
export const LIVELY = 48 * 3600e3

/** @param {R[]} votes @returns {Tally} */
export function tally (votes) {
  /** @type {Map<string, R>} */
  const latest = new Map()
  for (const v of votes) {
    const k = v.on + '|' + v.author
    const had = latest.get(k)
    if (!had || v.stamp > had.stamp) latest.set(k, v)
  }
  /** @type {Tally} */
  const out = new Map()
  for (const v of latest.values()) {
    if (!out.has(v.on)) out.set(v.on, new Map())
    const of = /** @type {Map<string, number>} */ (out.get(v.on))
    of.set(v.author, v.value)
  }
  return out
}

/** @param {Tally} tallied @param {string} id */
export const score = (tallied, id) => [...(tallied.get(id)?.values() || [])].reduce((n, v) => n + v, 0)
/** @param {Tally} tallied @param {string} id @param {string} me */
export const voteOf = (tallied, id, me) => tallied.get(id)?.get(me) || 0
/** @param {number} current @param {number} clicked */
export const nextVote = (current, clicked) => current === clicked ? 0 : clicked

/**
 * @param {R[]} threads
 * @param {R[]} comments
 * @param {R[]} votes
 * @returns {Map<string, Summary>}
 */
export function summarize (threads, comments, votes, now = Date.now()) {
  const tallied = tally(votes)
  const by = new Map(threads.map((t) => [t.id, { thread: t, replies: 0, activity: t.stamp, score: score(tallied, t.id), lively: 0 }]))
  for (const c of comments) {
    const s = by.get(c.thread)
    if (!s) continue
    s.replies++
    if (c.stamp > s.activity) s.activity = c.stamp
    if (now - c.stamp < LIVELY) s.lively++
  }
  const threadOf = new Map(comments.map((c) => [c.id, c.thread]))
  const counted = new Set()
  for (const v of votes) {
    const s = by.get(v.on) || by.get(threadOf.get(v.on))
    if (!s || now - v.stamp >= LIVELY || counted.has(v.on + '|' + v.author)) continue
    counted.add(v.on + '|' + v.author)
    s.lively++
  }
  return by
}

/** @type {Record<string, (s: Summary) => number>} */
const KEYS = { activity: (s) => s.activity, newest: (s) => s.thread.stamp, top: (s) => s.score, lively: (s) => s.lively }

/** @param {Iterable<Summary>} summaries */
export function sortThreads (summaries, how = 'activity') {
  const key = KEYS[how] || KEYS.activity
  return [...summaries].sort((a, b) => key(b) - key(a) || b.activity - a.activity)
}

// Replies whose parent is gone (deleted, hidden) hang under a placeholder row { comment: null, id }.
/**
 * @param {R[]} comments
 * @param {string} threadId
 * @returns {Row[]}
 */
export function tree (comments, threadId) {
  const ids = new Set(comments.map((c) => c.id))
  /** @type {Map<string, Array<R | { id: string, gone: true, stamp: number }>>} */
  const kids = new Map()
  /** @param {string} parent @param {R | { id: string, gone: true, stamp: number }} node */
  const add = (parent, node) => { if (!kids.has(parent)) kids.set(parent, []); /** @type {Array<R | { id: string, gone: true, stamp: number }>} */ (kids.get(parent)).push(node) }
  for (const c of comments) {
    if (c.on === threadId || ids.has(c.on)) add(c.on, c)
    else {
      if (!kids.has(c.on)) add(threadId, { id: c.on, gone: true, stamp: c.stamp })
      add(c.on, c)
    }
  }
  for (const list of kids.values()) list.sort((a, b) => a.stamp - b.stamp)
  /** @type {Row[]} */
  const rows = []
  /** @param {string} parent @param {string[]} prefix */
  const walk = (parent, prefix) => {
    const list = kids.get(parent) || []
    list.forEach((node, i) => {
      const last = i === list.length - 1
      const id = node.id
      rows.push({ id, comment: node.gone ? null : /** @type {R} */ (node), depth: prefix.length, segs: [...prefix, last ? 'elbow' : 'tee'], under: count(id) })
      walk(id, [...prefix, last ? 'blank' : 'pipe'])
    })
  }
  /** @param {string} id @returns {number} */
  const count = (id) => (kids.get(id) || []).reduce((n, k) => n + 1 + count(k.id), 0)
  walk(threadId, [])
  return rows
}

/** @param {Row[]} rows @param {Set<string>} folded */
export function visible (rows, folded) {
  /** @type {Row[]} */
  const out = []
  let hideBelow = -1
  for (const r of rows) {
    if (hideBelow >= 0 && r.depth > hideBelow) continue
    hideBelow = folded.has(r.id) ? r.depth : -1
    out.push(r)
  }
  return out
}

// By message numbers, never by dates: a reply received late, stamped long ago, still counts.
export const NEW_MAX = 300 // comment ids kept in all (~60 bytes each; a mine value is at most 64 KB): past it the oldest go, their threads stay unread
/**
 * @param {import('./forum.js').Unread} unread
 * @param {R[]} records
 * @param {string} me
 * @returns {import('./forum.js').Unread}
 */
export function addNew (unread, records, me) {
  const out = Object.fromEntries(Object.entries(unread).map(([k, v]) => [k, [...v]]))
  for (const r of records) {
    if (r.author === me) continue
    if (r.type === 'thread') out[r.id] = out[r.id] || []
    else if (r.type === 'comment' && typeof r.thread === 'string') (out[r.thread] = out[r.thread] || []).push(r.id)
  }
  let n = Object.values(out).reduce((a, l) => a + l.length, 0)
  for (const l of Object.values(out)) while (n > NEW_MAX && l.length) { l.shift(); n-- }
  return out
}

// Only the threads shown (deleted, hidden, or older than the newest LIMITS.threads go): bounded.
/** @param {import('./forum.js').Unread} unread @param {Set<string>} threadIds */
export const pruneUnread = (unread, threadIds) => Object.fromEntries(Object.entries(unread).filter(([k]) => threadIds.has(k)))
/** @param {import('./forum.js').Unread} unread @param {string} thread */
export const without = (unread, thread) => Object.fromEntries(Object.entries(unread).filter(([k]) => k !== thread))

/** @param {number} stamp */
export function ago (stamp, now = Date.now()) {
  const s = Math.max(0, Math.round((now - stamp) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  if (s < 2 * 86400) return 'yesterday'
  if (s < 30 * 86400) return Math.floor(s / 86400) + ' days ago'
  return new Date(stamp).toISOString().slice(0, 10)
}

/** @param {R[]} boards */
export function boardTree (boards) {
  /** @param {R} a @param {R} b */
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.stamp - b.stamp
  const ids = new Set(boards.map((b) => b.id))
  const top = boards.filter((b) => !b.parent || !ids.has(b.parent)).sort(byOrder)
  return top.map((board) => ({ board, subs: boards.filter((b) => b.parent === board.id).sort(byOrder) }))
}
