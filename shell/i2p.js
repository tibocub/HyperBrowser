// The shell's side of I2P: the router (one per install, started with the app, kept across identity switches), what
// each identity's engine opens with, the relaying settings, and the warning when a regular and an anonymous identity
// follow each other closely (they can be linked by timing).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Router } from './router.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SWITCH_MS = 10 * 60 * 1000

// Java I2P's strict countries (i2p.net, "Strict Countries List (as of 2024)"): the router relays nothing there.
export const STRICT = new Set(['AF', 'AZ', 'BH', 'BY', 'BN', 'BI', 'CM', 'CF', 'TD', 'CN', 'CU', 'CD', 'EG', 'GQ', 'ER', 'ET', 'IR', 'IQ', 'KZ',
  'LA', 'LY', 'MM', 'KP', 'PS', 'PK', 'RW', 'SA', 'SO', 'SS', 'SD', 'SZ', 'SY', 'TJ', 'TH', 'TR', 'TM', 'VE', 'AE', 'UZ', 'VN', 'EH', 'YE'])

// Their IANA time zones (and old names still in use). shortcut: the time zone and the system's region say where the
// computer is set up, not where it is; an IP-to-country check against the router's own address is to come.
const ZONES = {
  'Asia/Kabul': 'AF', 'Asia/Baku': 'AZ', 'Asia/Bahrain': 'BH', 'Europe/Minsk': 'BY', 'Asia/Brunei': 'BN', 'Africa/Bujumbura': 'BI',
  'Africa/Douala': 'CM', 'Africa/Bangui': 'CF', 'Africa/Ndjamena': 'TD', 'Asia/Shanghai': 'CN', 'Asia/Urumqi': 'CN', 'Asia/Chongqing': 'CN',
  'Asia/Chungking': 'CN', 'Asia/Harbin': 'CN', 'Asia/Kashgar': 'CN', PRC: 'CN', 'America/Havana': 'CU', Cuba: 'CU', 'Africa/Kinshasa': 'CD',
  'Africa/Lubumbashi': 'CD', 'Africa/Cairo': 'EG', Egypt: 'EG', 'Africa/Malabo': 'GQ', 'Africa/Asmara': 'ER', 'Africa/Asmera': 'ER',
  'Africa/Addis_Ababa': 'ET', 'Asia/Tehran': 'IR', Iran: 'IR', 'Asia/Baghdad': 'IQ', 'Asia/Almaty': 'KZ', 'Asia/Qyzylorda': 'KZ',
  'Asia/Qostanay': 'KZ', 'Asia/Aqtobe': 'KZ', 'Asia/Aqtau': 'KZ', 'Asia/Atyrau': 'KZ', 'Asia/Oral': 'KZ', 'Asia/Vientiane': 'LA',
  'Africa/Tripoli': 'LY', Libya: 'LY', 'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM', 'Asia/Pyongyang': 'KP', 'Asia/Gaza': 'PS', 'Asia/Hebron': 'PS',
  'Asia/Karachi': 'PK', 'Africa/Kigali': 'RW', 'Asia/Riyadh': 'SA', 'Africa/Mogadishu': 'SO', 'Africa/Juba': 'SS', 'Africa/Khartoum': 'SD',
  'Africa/Mbabane': 'SZ', 'Asia/Damascus': 'SY', 'Asia/Dushanbe': 'TJ', 'Asia/Bangkok': 'TH', 'Europe/Istanbul': 'TR', 'Asia/Istanbul': 'TR',
  Turkey: 'TR', 'Asia/Ashgabat': 'TM', 'Asia/Ashkhabad': 'TM', 'America/Caracas': 'VE', 'Asia/Dubai': 'AE', 'Asia/Tashkent': 'UZ',
  'Asia/Samarkand': 'UZ', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Africa/El_Aaiun': 'EH', 'Asia/Aden': 'YE'
}

/**
 * The strict country this computer seems to be in, by its time zone or its system region, or null.
 * @param {string} zone an IANA time zone @param {string} locale e.g. 'fa-IR'
 * @returns {string | null}
 */
export function strictCountry (zone, locale) {
  const region = (/[-_]([A-Za-z]{2})\b/.exec(locale)?.[1] || '').toUpperCase()
  if (STRICT.has(region)) return region
  const byZone = /** @type {Record<string, string>} */ (ZONES)[zone]
  return byZone || null
}

/**
 * The warning shown before an identity opens within 10 minutes of one of the other kind closing, either way.
 * @param {{ anonymous: number | null, regular: number | null }} last when each kind last closed
 * @param {boolean} anonymous the one opening @param {number} now
 * @returns {string | null}
 */
export function switchWarning (last, anonymous, now) {
  const at = anonymous ? last.regular : last.anonymous
  if (at === null || now - at >= SWITCH_MS) return null
  const ago = now - at < 60000 ? 'just closed' : 'closed ' + Math.round((now - at) / 60000) + ' min ago'
  return (anonymous ? 'A regular identity' : 'An anonymous identity') + ' ' + ago + ' on this computer. Opening ' +
    (anonymous ? 'an anonymous one' : 'a regular one') + ' right after it lets someone watching both link them by timing. Waiting 10 minutes between them is safer.'
}

/**
 * What opening an identity means for the rest of the app: an anonymous one is refused without the page guards (they
 * keep its pages from reaching the regular network), and the updater (regular network, one per app) pauses for it.
 * @param {{ anonymous: boolean }} identity @param {boolean} guards
 * @returns {{ updates: 'pause' | 'run' }}
 */
export function admit (identity, guards) {
  if (identity.anonymous && !guards) throw Object.assign(new Error('An anonymous identity never opens with --no-guards: its pages could reach the regular network.'), { code: 'NOT_ALLOWED' })
  return { updates: identity.anonymous ? 'pause' : 'run' }
}

/**
 * @typedef {{ relay: boolean, upnp: boolean }} Settings relaying on, UPnP on (both by default)
 * @typedef {{ dir: string, anonymous: boolean }} IdentityLike
 */

/**
 * @param {{ home: string, run: import('./router.js').Run, zone: string, locale: string, log: (line: string) => void }} opts
 *   home: the data folder (the router's own folder and i2p.json go there, outside every identity's)
 */
export function i2p ({ home, run, zone, locale, log }) {
  const file = path.join(home, 'i2p.json')
  /** @type {Settings} */
  let settings = { relay: true, upnp: true }
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(file, 'utf-8')) } } catch {}
  const strict = strictCountry(zone, locale)
  /** @type {string[]} */
  let shipped = []
  try { shipped = JSON.parse(fs.readFileSync(path.join(HERE, 'i2p-bootstrap.json'), 'utf-8')) } catch {}
  /** @type {{ anonymous: number | null, regular: number | null }} */
  const last = { anonymous: null, regular: null }

  const options = () => ({ bandwidth: 'O', share: 50, notransit: !!strict || !settings.relay, upnp: settings.upnp })
  const make = () => {
    const r = new Router({ dataDir: path.join(home, 'i2p-router'), run, options: options() })
    r.on('state', (state, reason) => log('i2p router: ' + state + (reason ? ' (' + reason + ')' : '')))
    return r
  }
  let router = make()

  return {
    get router () { return router },
    start: () => router.start(),
    stop: () => router.stop(),
    /** What an identity's engine opens with. @param {IdentityLike} identity */
    open (identity) {
      return {
        transport: identity.anonymous ? 'i2p' : 'dual',
        sam: { port: router.port, bootstrap: [...new Set([...shipped, ...learned(identity)])] },
        ...(identity.anonymous ? { deviceName: '' } : {}) // no computer name in what peers see
      }
    },
    /** The I2P DHT nodes this identity's engine knew, for its next start (its own folder: nothing shared). @param {IdentityLike} identity @param {string[]} nodes */
    learn (identity, nodes) {
      try { fs.writeFileSync(path.join(identity.dir, 'i2p-nodes.json'), JSON.stringify(nodes.slice(0, 64))) } catch {}
    },
    /** @param {IdentityLike} identity */
    closed (identity) { last[identity.anonymous ? 'anonymous' : 'regular'] = Date.now() },
    /** @param {IdentityLike} next @param {IdentityLike} [closing] the one closing now for it */
    warning (next, closing) {
      const now = Date.now()
      const seen = closing ? { ...last, [closing.anonymous ? 'anonymous' : 'regular']: now } : last
      return switchWarning(seen, next.anonymous, now)
    },
    settings: () => ({ ...settings, strict }),
    /** Relaying or UPnP changed: the router restarts with them (i2pd reads its options once per process). @param {Partial<Settings>} next */
    async set (next) {
      settings = { relay: next.relay ?? settings.relay, upnp: next.upnp ?? settings.upnp }
      fs.writeFileSync(file, JSON.stringify(settings))
      const port = router.port
      await router.stop()
      router = make()
      router.port = port // engines keep theirs: they open a new session once it is back
      await router.start()
    }
  }

  /** @param {IdentityLike} identity @returns {string[]} */
  function learned (identity) {
    try { return JSON.parse(fs.readFileSync(path.join(identity.dir, 'i2p-nodes.json'), 'utf-8')).filter((/** @type {unknown} */ n) => typeof n === 'string') } catch { return [] }
  }
}
