import os from 'os'
import path from 'path'

const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const LISTS = new Set(['join', 'seed'])
/**
 * @typedef {object} HelperConfig
 * @property {string} dir
 * @property {string} name
 * @property {number | null} share GB for its circles; null: half the free disk at first start, at most 100.
 * @property {'official' | 'none'} apps
 * @property {string[]} seed
 * @property {string[]} join
 */

/** @param {string} n */
const validName = (n) => n.length > 0 && n.length <= 64 && !/[\x00-\x1f\x7f]/.test(n) // eslint-disable-line no-control-regex
/** @param {string} p */
const home = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)

/** @type {Record<string, (v: string) => string | number | undefined>} */
const CHECK = {
  dir: (v) => (v ? home(v) : undefined),
  name: (v) => (validName(v) ? v : undefined),
  share: (v) => (/^\d+(\.\d+)?$/.test(v) && Number(v) >= 0.1 ? Number(v) : undefined), // GB
  apps: (v) => (v === 'official' || v === 'none' ? v : undefined),
  seed: (v) => (KEY.test(v) ? v : undefined),
  join: (v) => (/^hg:\S+$/.test(v) ? v : undefined)
}

export const configFile = () => path.join(os.homedir(), '.config', 'hyperbrowser-helper.conf')

/** @returns {HelperConfig} */
export function defaults (hostname = os.hostname()) {
  return { dir: path.join(os.homedir(), '.local', 'share', 'hyperbrowser-helper'), name: `Helper (${hostname})`, share: null, apps: 'official', seed: [], join: [] }
}

/**
 * @param {string} text the config file
 * @returns {{ values: Partial<HelperConfig>, errors: string[] }}
 */
export function parse (text) {
  /** @type {Record<string, any>} */
  const values = {} // checked by CHECK, per key
  /** @type {string[]} */
  const errors = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line[0] === '#') return
    const at = line.indexOf('=')
    const key = (at < 0 ? line : line.slice(0, at)).trim()
    const value = at < 0 ? '' : line.slice(at + 1).trim()
    if (!Object.hasOwn(CHECK, key)) return errors.push(`line ${i + 1}: unknown setting "${key}" (ignored)`)
    const v = CHECK[key](value)
    if (v === undefined) return errors.push(`line ${i + 1}: bad value for ${key}: "${value}" (ignored)`)
    if (LISTS.has(key)) values[key] = [...(values[key] || []), v]
    else values[key] = v
  })
  return { values, errors }
}

/**
 * @param {Partial<Record<keyof HelperConfig, any>>} cli the command line's, undefined where not given
 * @param {Partial<HelperConfig>} file
 * @param {HelperConfig} [base]
 * @returns {HelperConfig}
 */
export function merge (cli, file, base = defaults()) {
  /** @type {Record<string, any>} */
  const out = { ...base, ...file }
  /** @type {Record<string, any>} */
  const lists = file
  for (const [k, v] of Object.entries(cli)) {
    if (v === undefined) continue
    out[k] = LISTS.has(k) ? [...new Set([...(lists[k] || []), ...v])] : v
  }
  return /** @type {HelperConfig} */ (out)
}

export function template (base = defaults()) {
  return `# HyperBrowser helper (docs/helper.md). Read again when it changes, except dir (restart).
# Uncomment a line to change a setting. join and seed may be repeated.

# Its engine folder: identity and data.
# dir = ${base.dir}

# Its name.
# name = ${base.name}

# GB for its circles. Default: half the free disk at first start, at most 100.
# share = 10

# official: keep every app in shell/preset.json online. none: none of them.
# apps = ${base.apps}

# Another site or space to keep online (its key).
# seed = <key>

# An invite to a circle; used once.
# join = hg:...
`
}
