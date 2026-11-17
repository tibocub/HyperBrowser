// The frame's pure logic (specs/002-shell/data-model.md): the address and the desktop's icons and cells.
// No imports: it runs in the frame page, in Electron main and in the tests (Node and Bare).

export const COLUMNS = 8 // new icons fill this many columns, row by row
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/ // z32 of 32 bytes, as the engine checks it

// What the person typed → { key } (a full key or an hg: link, for site.open) or { error }.
export function parseAddress (input) {
  const s = String(input).trim()
  if (KEY.test(s)) return { key: s }
  if (/^hg:\S+$/.test(s)) return { key: s }
  return { error: 'Not a site key: paste the whole key (52 letters and digits).' }
}

export const shortKey = (key) => KEY.test(key) ? key.slice(0, 6) + '…' + key.slice(-3) : key

// The first free cell, row by row.
export function place (icons) {
  const used = new Set(icons.map((i) => i.col + ',' + i.row))
  for (let n = 0; ; n++) {
    const col = n % COLUMNS
    const row = Math.floor(n / COLUMNS)
    if (!used.has(col + ',' + row)) return { col, row }
  }
}

// Adds an icon or updates the one with the same id (or with id `was`: a preset that got its key keeps its
// cell and its fields).
export function upsert (icons, icon, was = null) {
  const i = icons.findIndex((x) => x.id === icon.id || (was && x.id === was))
  if (i === -1) return [...icons, { kind: 'bookmark', ...icon, ...place(icons) }]
  const out = icons.slice()
  out[i] = { ...icons[i], ...icon, col: icons[i].col, row: icons[i].row }
  return out
}

// To another cell; the icon there, if any, takes the moved one's old cell. Off the grid: unchanged.
export function move (icons, id, col, row) {
  const me = icons.find((x) => x.id === id)
  if (!me || !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= COLUMNS) return icons
  return icons.map((x) => {
    if (x === me) return { ...x, col, row }
    if (x.col === col && x.row === row) return { ...x, col: me.col, row: me.row }
    return x
  })
}

export const remove = (icons, id) => icons.filter((x) => x.id !== id)

// --- spec 018: the circles' share (Configuration → Circles) ---

const GB = 1e9 // hypergraph's 1 GB share
export const gb = (bytes) => (Math.round(bytes / GB * 10) / 10) + ' GB'

// What the person typed in the share field (GB, decimals) → { bytes, drop } (drop: what goes at once, below what is
// held) or { error }. At most the disk's free space plus what is held, minus 2 GB; the engine checks it again.
export function checkShare (text, { used, free }) {
  const n = Number(String(text).trim().replace(',', '.'))
  if (!String(text).trim() || !Number.isFinite(n) || n < 0.1) return { error: 'At least 0.1 GB' }
  const bytes = Math.round(n * GB)
  const room = free + used - 2 * GB
  if (bytes > room) return { error: 'Only ' + gb(Math.max(0, Math.floor(room / GB * 10) / 10 * GB)) + ' free on this disk' }
  return { bytes, drop: Math.max(0, used - bytes) }
}

// --- spec 021: storage numbers in Members (hypergraph 026) ---

// A member's held/share across all their circles, e.g. '0.8/3 GB'; '' when not holding or not reported.
export function storageText ({ share, used } = {}) {
  if (share == null) return ''
  return ((used || 0) < 0.1 * GB ? '<0.1' : String(Math.round(used / GB * 10) / 10)) + '/' + gb(share)
}

// The circle's room after its 5 copies, e.g. 'TOTAL ≈ 4.2 GB'; '' while no share is known.
export const totalText = (total) => (total == null ? '' : 'TOTAL ≈ ' + gb(total))

// --- spec 019: the circles window's Invite contacts… and Join with a link… ---

// The person's friends against a circle's members → [{ identity, name, in }]: those in it can't be ticked.
export function inviteRows (contacts, members) {
  const inside = new Set(members.map((m) => m.identity))
  return contacts.filter((c) => c.state === 'friend').map((c) => ({ identity: c.identity, name: c.name || shortKey(c.identity), in: inside.has(c.identity) }))
}

// Send's results [{ name, error? }] → what the window says.
export function invitedLine (results) {
  const sent = results.filter((r) => !r.error).length
  const failed = results.filter((r) => r.error).map((r) => r.name + ' (' + r.error + ')')
  return 'Invites sent to ' + sent + (sent === 1 ? ' friend' : ' friends') + ' in Chat' + (failed.length ? '. Not sent to ' + failed.join(', ') : '')
}

const USED = new Set(['INVITE_EXPIRED', 'INVITE_USED_UP', 'INVITE_REVOKED'])
const NOT_CIRCLE = new Set(['NOT_ALLOWED', 'INVALID_PARAMS', 'INVITE_INVALID']) // engine/circles.js join's refusals
// circles.join's error → the person's words.
export function joinError ({ code, message }) {
  if (USED.has(code)) return 'This invite was already used or has expired'
  if (code === 'CIRCLE_FULL') return 'This circle is full (50)'
  if (NOT_CIRCLE.has(code)) return 'This is not a circle invite'
  return message
}
