import b4a from 'b4a'
import fs from 'fs'
import path from 'path'

/**
 * @typedef {import('hypergraph/lib/types.js').TypeDeclarations} TypeDeclarations
 * @typedef {{ type: string | string[], me?: string, text?: string, says?: string, open?: string, show?: 'dot',
 *   place?: string, where?: Record<string, string | number | boolean>, by?: string, popup?: boolean }} Watch
 *   A notifications watch of site.json, or a follow (place, where, by, popup: follows only).
 * @typedef {object} Manifest A site.json, checked.
 * @property {string} title
 * @property {string} entry
 * @property {string} [icon]
 * @property {string[]} permissions
 * @property {boolean} [public]
 * @property {TypeDeclarations} [types]
 * @property {Watch[]} [notifications]
 */

/** @param {string} code @param {string} message */
const error = (code, message) => Object.assign(new Error(message), { code })

/**
 * A clean relative path inside a site ('docs/a.html'), or null: no '', '.' or '..' segment, no '\', no NUL.
 * @param {unknown} p
 */
export function sitePath (p) {
  if (typeof p !== 'string') return null
  const parts = p.replace(/^\/+/, '').split('/')
  if (parts.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) return null
  return parts.join('/')
}

/**
 * @param {string | Uint8Array} textOrBytes
 * @returns {Manifest}
 */
export function parseManifest (textOrBytes) {
  const raw = typeof textOrBytes === 'string' ? textOrBytes : b4a.toString(textOrBytes)
  let m
  try { m = JSON.parse(raw) } catch (err) { throw error('INVALID_MANIFEST', 'site.json is not JSON: ' + /** @type {Error} */ (err).message) }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw error('INVALID_MANIFEST', 'site.json must be an object')
  const title = typeof m.title === 'string' ? m.title.trim() : ''
  if (!title || title.length > 200) throw error('INVALID_MANIFEST', 'site.json: title must be 1 to 200 characters')
  const entry = m.entry === undefined ? 'index.html' : sitePath(m.entry)
  if (!entry) throw error('INVALID_MANIFEST', 'site.json: entry must be a path inside the site')
  const out = /** @type {Manifest} */ ({ title, entry }) // permissions set below, in this key order
  if (m.icon !== undefined) {
    const icon = sitePath(m.icon)
    if (!icon) throw error('INVALID_MANIFEST', 'site.json: icon must be a path inside the site')
    out.icon = icon
  }
  const permissions = m.permissions === undefined ? [] : m.permissions
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === 'string')) {
    throw error('INVALID_MANIFEST', 'site.json: permissions must be a list of names')
  }
  out.permissions = permissions
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

/**
 * Strict: these fields can't change once released, so anything unknown is refused now.
 * @param {unknown} list
 * @param {TypeDeclarations} [types]
 * @returns {Watch[]}
 */
function watches (list, types) {
  if (!Array.isArray(list) || list.length > 16) throw error('INVALID_MANIFEST', 'site.json: notifications: a list of at most 16 watches')
  for (const w of list) watch(w, types)
  return list
}

const WATCH_KEYS = new Set(['type', 'me', 'text', 'says', 'open', 'show'])
const FOLLOW_KEYS = new Set(['place', 'type', 'where', 'by', 'text', 'says', 'open', 'popup'])
const MEMBER = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/

/**
 * Throws unless `w` is a valid watch (or, with `follow`, a valid follow).
 * @param {any} w the JSON value being checked
 * @param {TypeDeclarations} [types]
 * @param {boolean} [follow]
 * @returns {asserts w is Watch}
 */
export function watch (w, types, follow = false) {
  /** @param {string} why @returns {never} */
  const bad = (why) => { throw follow ? error('INVALID_PARAMS', 'follow: ' + why) : error('INVALID_MANIFEST', 'site.json: notifications: ' + why) }
  if (!w || typeof w !== 'object' || Array.isArray(w)) bad('each watch is an object')
  for (const k of Object.keys(w)) if (!(follow ? FOLLOW_KEYS : WATCH_KEYS).has(k)) bad(`unknown field ${k}`)
  if (follow && (typeof w.place !== 'string' || !w.place)) bad("place is one of the app's instances")
  const names = follow && Array.isArray(w.type) ? w.type : [w.type]
  if (!names.length || names.length > 8 || !names.every((/** @type {unknown} */ n) => typeof n === 'string' && types?.[n])) bad('a watch names one of the types this site declares')
  const declared = /** @type {TypeDeclarations} */ (types)
  /** @param {unknown} f */
  const field = (f) => typeof f === 'string' && names.every((/** @type {string} */ n) => Object.hasOwn(declared[n].fields || {}, f))
  const of = names.join(', ')
  if (w.me !== undefined && !field(w.me)) bad(`me names a field of ${of}`)
  if ((w.text === undefined) === (w.says === undefined)) bad('text or says, one of the two')
  if (w.text !== undefined && !field(w.text)) bad(`text names a field of ${of}`)
  if (w.says !== undefined && (typeof w.says !== 'string' || !w.says.trim() || w.says.length > 60)) bad('says is 1 to 60 characters')
  if (w.open !== undefined) {
    if (typeof w.open !== 'string' || w.open[0] !== '#' || w.open.length > 200) bad('open is a place within the app: #...')
    for (const [, f] of w.open.matchAll(/\{([^}]*)\}/g)) if (f !== 'id' && !field(f)) bad(`open: {${f}} names a field of ${of}, or {id}: the record's own`)
  }
  if (w.show !== undefined && w.show !== 'dot') bad('show is "dot" (only a dot: no notification)')
  if (w.where !== undefined) {
    if (!w.where || typeof w.where !== 'object' || Array.isArray(w.where) || Object.keys(w.where).length > 4) bad('where is { field: value }, at most 4')
    for (const [f, v] of Object.entries(w.where)) {
      if (!field(f) || !['string', 'number', 'boolean'].includes(typeof v) || String(v).length > 200) bad(`where: ${f} names a field of ${of}, its value a string, number or true/false`)
    }
  }
  if (w.by !== undefined && (typeof w.by !== 'string' || !MEMBER.test(w.by))) bad("by is a member's key")
  if (w.popup !== undefined && typeof w.popup !== 'boolean') bad('popup is true or false')
}

/**
 * @param {string} folder
 * @param {string | null} [built] where a build put the pages (an IDE project's out folder)
 */
export async function readManifest (folder, built = null) {
  let text
  try { text = await fs.promises.readFile(path.join(folder, 'site.json'), 'utf-8') } catch { throw error('NO_MANIFEST', `no site.json in ${folder}`) }
  const manifest = parseManifest(text)
  for (const p of [manifest.entry, manifest.icon]) {
    if (!p) continue
    /** @param {string | null} d */
    const there = async (d) => !!d && !!(await fs.promises.stat(path.join(d, ...p.split('/'))).catch(() => null))
    if (!(await there(folder)) && !(await there(built))) throw error('INVALID_MANIFEST', `site.json names ${p}, which isn't in the folder`)
  }
  return manifest
}

/** @param {Manifest} manifest */
export const isDynamic = (manifest) => manifest.permissions.includes('space')
