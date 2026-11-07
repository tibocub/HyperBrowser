// What the pages show, computed on the device from records (spec 006 data-model "Derived"): pure functions.

export const SORTS = ['activity', 'newest', 'top', 'lively']
export const LIVELY = 48 * 3600e3 // "lately" for the lively sort

// Each member's latest vote per target: Map target → Map author → value.
export function tally (votes) {
  const latest = new Map() // target|author → vote
  for (const v of votes) {
    const k = v.on + '|' + v.author
    const had = latest.get(k)
    if (!had || v.stamp > had.stamp) latest.set(k, v)
  }
  const out = new Map()
  for (const v of latest.values()) {
    if (!out.has(v.on)) out.set(v.on, new Map())
    out.get(v.on).set(v.author, v.value)
  }
  return out
}

export const score = (tallied, id) => [...(tallied.get(id)?.values() || [])].reduce((n, v) => n + v, 0)
export const voteOf = (tallied, id, me) => tallied.get(id)?.get(me) || 0
// Clicking ▲ (+1) or ▼ (−1): the same again takes the vote back.
export const nextVote = (current, clicked) => current === clicked ? 0 : clicked

// Per thread: replies, activity (its newest stamp), score, lively (replies and votes lately).
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

const KEYS = { activity: (s) => s.activity, newest: (s) => s.thread.stamp, top: (s) => s.score, lively: (s) => s.lively }

// Highest first; ties: the most recent activity first.
export function sortThreads (summaries, how = 'activity') {
  const key = KEYS[how] || KEYS.activity
  return [...summaries].sort((a, b) => key(b) - key(a) || b.activity - a.activity)
}

// The reply tree, oldest first under each parent, as rows: { comment, depth, segs, children } where segs are
// the box-drawing steps before it ('pipe' │, 'blank', 'tee' ├─, 'elbow' └─). Replies whose parent is gone
// (deleted, hidden) hang under a placeholder row { comment: null, id } at the parent's place.
export function tree (comments, threadId) {
  const ids = new Set(comments.map((c) => c.id))
  const kids = new Map()
  const add = (parent, node) => { if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(node) }
  for (const c of comments) {
    if (c.on === threadId || ids.has(c.on)) add(c.on, c)
    else {
      if (!kids.has(c.on)) add(threadId, { id: c.on, gone: true, stamp: c.stamp })
      add(c.on, c)
    }
  }
  for (const list of kids.values()) list.sort((a, b) => a.stamp - b.stamp)
  const rows = []
  const walk = (parent, prefix) => {
    const list = kids.get(parent) || []
    list.forEach((node, i) => {
      const last = i === list.length - 1
      const id = node.id
      rows.push({ id, comment: node.gone ? null : node, depth: prefix.length, segs: [...prefix, last ? 'elbow' : 'tee'], under: count(id) })
      walk(id, [...prefix, last ? 'blank' : 'pipe'])
    })
  }
  const count = (id) => (kids.get(id) || []).reduce((n, k) => n + 1 + count(k.id), 0)
  walk(threadId, [])
  return rows
}

// Rows left to show once some are folded: a folded row stays, what is under it goes.
export function visible (rows, folded) {
  const out = []
  let hideBelow = -1
  for (const r of rows) {
    if (hideBelow >= 0 && r.depth > hideBelow) continue
    hideBelow = folded.has(r.id) ? r.depth : -1
    out.push(r)
  }
  return out
}

// Unread: never read, or active since. read: the activity stamp seen last, or undefined.
export const unread = (activity, read) => read === undefined || read === null || activity > read

export function ago (stamp, now = Date.now()) {
  const s = Math.max(0, Math.round((now - stamp) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  if (s < 2 * 86400) return 'yesterday'
  if (s < 30 * 86400) return Math.floor(s / 86400) + ' days ago'
  return new Date(stamp).toISOString().slice(0, 10)
}

// Boards in order, each with its sub-boards: [{ board, subs: [board] }]. Removed boards aren't records any more.
export function boardTree (boards) {
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.stamp - b.stamp
  const ids = new Set(boards.map((b) => b.id))
  const top = boards.filter((b) => !b.parent || !ids.has(b.parent)).sort(byOrder)
  return top.map((board) => ({ board, subs: boards.filter((b) => b.parent === board.id).sort(byOrder) }))
}
