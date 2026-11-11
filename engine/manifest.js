// site.json (specs/001-engine/data-model.md) and the path rule shared by publish and site.read.
import b4a from 'b4a'

const error = (code, message) => Object.assign(new Error(message), { code })

// A clean relative path inside a site ('docs/a.html'), or null: no '', '.' or '..' segment, no '\', no NUL.
export function sitePath (p) {
  if (typeof p !== 'string') return null
  const parts = p.replace(/^\/+/, '').split('/')
  if (parts.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return null
  return parts.join('/')
}

// The checked manifest from site.json's text: { title, entry, icon?, permissions }.
export function parseManifest (textOrBytes) {
  const raw = typeof textOrBytes === 'string' ? textOrBytes : b4a.toString(textOrBytes)
  let m
  try { m = JSON.parse(raw) } catch (err) { throw error('INVALID_MANIFEST', 'site.json is not JSON: ' + err.message) }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw error('INVALID_MANIFEST', 'site.json must be an object')
  const title = typeof m.title === 'string' ? m.title.trim() : ''
  if (!title || title.length > 200) throw error('INVALID_MANIFEST', 'site.json: title must be 1 to 200 characters')
  const entry = m.entry === undefined ? 'index.html' : sitePath(m.entry)
  if (!entry) throw error('INVALID_MANIFEST', 'site.json: entry must be a path inside the site')
  const out = { title, entry }
  if (m.icon !== undefined) {
    out.icon = sitePath(m.icon)
    if (!out.icon) throw error('INVALID_MANIFEST', 'site.json: icon must be a path inside the site')
  }
  const permissions = m.permissions === undefined ? [] : m.permissions
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === 'string')) {
    throw error('INVALID_MANIFEST', 'site.json: permissions must be a list of names')
  }
  out.permissions = permissions
  // spec 006: an invite-only site (public: false), and a dynamic site's own record types (hypergraph's form)
  if (m.public !== undefined) {
    if (typeof m.public !== 'boolean') throw error('INVALID_MANIFEST', 'site.json: public must be true or false')
    out.public = m.public
  }
  if (m.types !== undefined) {
    if (!m.types || typeof m.types !== 'object' || Array.isArray(m.types)) throw error('INVALID_MANIFEST', 'site.json: types must be an object of record types')
    out.types = m.types
  }
  if (m.notifications !== undefined) out.notifications = watches(m.notifications, out.types)
  return out
}

// spec 016: what the engine watches for this app, as data (contracts/notifications.md). Strict: site.json's
// fields can't change once released, so anything unknown is refused now and may mean something later.
const WATCH_KEYS = new Set(['type', 'me', 'text', 'says', 'open'])
function watches (list, types) {
  const bad = (why) => { throw error('INVALID_MANIFEST', 'site.json: notifications: ' + why) }
  if (!Array.isArray(list) || list.length > 16) bad('a list of at most 16 watches')
  for (const w of list) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) bad('each watch is an object')
    for (const k of Object.keys(w)) if (!WATCH_KEYS.has(k)) bad(`unknown field ${k}`)
    const type = types?.[w.type]
    if (typeof w.type !== 'string' || !type) bad('a watch names one of the types this site declares')
    const fields = type.fields || {}
    const field = (f) => typeof f === 'string' && Object.hasOwn(fields, f)
    if (w.me !== undefined && !field(w.me)) bad(`me names a field of ${w.type}`)
    if ((w.text === undefined) === (w.says === undefined)) bad('text or says, one of the two')
    if (w.text !== undefined && !field(w.text)) bad(`text names a field of ${w.type}`)
    if (w.says !== undefined && (typeof w.says !== 'string' || !w.says.trim() || w.says.length > 60)) bad('says is 1 to 60 characters')
    if (w.open !== undefined) {
      if (typeof w.open !== 'string' || w.open[0] !== '#' || w.open.length > 200) bad('open is a place within the app: #...')
      for (const [, f] of w.open.matchAll(/\{([^}]*)\}/g)) if (!field(f)) bad(`open: {${f}} names a field of ${w.type}`)
    }
  }
  return list
}

// Dynamic: asks for its space (the hypergraph API); unknown permissions are ignored.
export const isDynamic = (manifest) => manifest.permissions.includes('space')
