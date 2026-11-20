// No imports: it runs in the frame page, in Electron main and in the tests (Node and Bare).

/**
 * @typedef {object} Icon A desktop icon (shell.json, preset.json).
 * @property {string} id the site's key, or a preset's id until it has one
 * @property {string | null} [key]
 * @property {'installed' | 'bookmark'} [kind]
 * @property {string} [title]
 * @property {string | null} [icon] a data: URL
 * @property {string} [glyph] one of shell/icons
 * @property {number} col
 * @property {number} row
 * @property {boolean} [kept] the engine confirmed the install (or uninstall)
 * @property {string} [site] the app of an instance's icon
 * @typedef {Partial<Icon> & { id: string }} IconChange
 * @typedef {{ code?: string | null, message: string }} Failure An error as the engine tells it.
 */

export const COLUMNS = 8
const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/ // z32 of 32 bytes, as the engine checks it

// name@authority, optionally hyper:// or hyperdns:// first and one / last. No path: a site opens at its start.
const NAME = /^(?:hyper(?:dns)?:\/\/)?([^\s@/]+@[^\s@/]+)\/?$/i

/**
 * @param {unknown} input
 * @returns {{ key: string, name?: undefined, error?: undefined } | { name: string, key?: undefined, error?: undefined } | { error: string, key?: undefined, name?: undefined }}
 */
export function parseAddress (input) {
  const s = String(input).trim()
  if (KEY.test(s)) return { key: s }
  if (/^hg:\S+$/.test(s)) return { key: s }
  const name = NAME.exec(s)
  if (name) return { name: name[1] }
  return { error: 'Not a site key or a name: paste the whole key (52 letters and digits), or type name@authority.' }
}

/** @type {Record<string, string | undefined>} */
const NAME_ERRORS = {
  UNKNOWN_AUTHORITY: 'No such authority here. Open it once by its link (name@hg:…), given by its owner.',
  AMBIGUOUS_AUTHORITY: 'Two authorities you have share this name: type its link instead (name@hg:…).',
  UNKNOWN_NAME: 'No such name in this authority.',
  UNAVAILABLE: 'Nobody who has it is online: try again later.',
  NOT_A_SITE: 'This name does not point to a site.'
}
/** @param {Failure} err */
export const nameError = ({ code, message }) => (NAME_ERRORS[/** @type {string} */ (code)] || 'Could not look up this name: ' + message) + ' (' + (code || 'ERROR') + ')'

/** @param {string} key */
export const shortKey = (key) => KEY.test(key) ? key.slice(0, 6) + '…' + key.slice(-3) : key

/** @param {Icon[]} icons */
export function place (icons) {
  const used = new Set(icons.map((i) => i.col + ',' + i.row))
  for (let n = 0; ; n++) {
    const col = n % COLUMNS
    const row = Math.floor(n / COLUMNS)
    if (!used.has(col + ',' + row)) return { col, row }
  }
}

// `was`: a preset that got its key keeps its cell and its fields.
/**
 * @param {Icon[]} icons
 * @param {IconChange} icon
 * @param {string | null} [was]
 * @returns {Icon[]}
 */
export function upsert (icons, icon, was = null) {
  const i = icons.findIndex((x) => x.id === icon.id || (was && x.id === was))
  if (i === -1) return [...icons, { kind: 'bookmark', ...icon, ...place(icons) }]
  const out = icons.slice()
  out[i] = { ...icons[i], ...icon, col: icons[i].col, row: icons[i].row }
  return out
}

/** @param {Icon[]} icons @param {string} id @param {number} col the frame's: checked here @param {number} row */
export function move (icons, id, col, row) {
  const me = icons.find((x) => x.id === id)
  if (!me || !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= COLUMNS) return icons
  return icons.map((x) => {
    if (x === me) return { ...x, col, row }
    if (x.col === col && x.row === row) return { ...x, col: me.col, row: me.row }
    return x
  })
}

/** @param {Icon[]} icons @param {string} id */
export const remove = (icons, id) => icons.filter((x) => x.id !== id)

const GB = 1e9 // hypergraph's 1 GB share
/** @param {number} bytes */
export const gb = (bytes) => (Math.round(bytes / GB * 10) / 10) + ' GB'

/** @param {unknown} text @param {{ used: number, free: number }} holding */
export function checkShare (text, { used, free }) {
  const n = Number(String(text).trim().replace(',', '.'))
  if (!String(text).trim() || !Number.isFinite(n) || n < 0.1) return { error: 'At least 0.1 GB' }
  const bytes = Math.round(n * GB)
  const room = free + used - 2 * GB
  if (bytes > room) return { error: 'Only ' + gb(Math.max(0, Math.floor(room / GB * 10) / 10 * GB)) + ' free on this disk' }
  return { bytes, drop: Math.max(0, used - bytes) }
}

/** @param {{ share?: number | null, used?: number | null }} [m] */
export function storageText ({ share, used } = {}) {
  if (share == null) return ''
  return ((used || 0) < 0.1 * GB ? '<0.1' : String(Math.round(/** @type {number} */ (used) / GB * 10) / 10)) + '/' + gb(share)
}

/** @param {number | null | undefined} total */
export const totalText = (total) => (total == null ? '' : 'TOTAL ≈ ' + gb(total))

/**
 * @param {Array<{ identity: string, name: string, state: string }>} contacts
 * @param {Array<{ identity: string }>} members
 */
export function inviteRows (contacts, members) {
  const inside = new Set(members.map((m) => m.identity))
  return contacts.filter((c) => c.state === 'friend').map((c) => ({ identity: c.identity, name: c.name || shortKey(c.identity), in: inside.has(c.identity) }))
}

/** @param {Array<{ name: string, error?: string }>} results */
export function invitedLine (results) {
  const sent = results.filter((r) => !r.error).length
  const failed = results.filter((r) => r.error).map((r) => r.name + ' (' + r.error + ')')
  return 'Invites sent to ' + sent + (sent === 1 ? ' friend' : ' friends') + ' in Chat' + (failed.length ? '. Not sent to ' + failed.join(', ') : '')
}

/** @type {Set<string | null | undefined>} */
const USED = new Set(['INVITE_EXPIRED', 'INVITE_USED_UP', 'INVITE_REVOKED'])
/** @type {Set<string | null | undefined>} */
const NOT_CIRCLE = new Set(['NOT_ALLOWED', 'INVALID_PARAMS', 'INVITE_INVALID'])
/** @param {Failure} err */
export function joinError ({ code, message }) {
  if (USED.has(code)) return 'This invite was already used or has expired'
  if (code === 'CIRCLE_FULL') return 'This circle is full (50)'
  if (NOT_CIRCLE.has(code)) return 'This is not a circle invite'
  return message
}
