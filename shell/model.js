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
