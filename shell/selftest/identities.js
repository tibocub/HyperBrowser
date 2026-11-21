// Two identities on one profile, through the frame's own controls: a switch leaves nothing of the first running,
// site storage stays with its identity, a delete takes all of one and nothing of the other.
// Used by test/sandbox.electron.js (--identitycheck run, then --identitycheck sweep on the same profile).
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { createSiteView } from '../views.js'

/**
 * @typedef {ReturnType<typeof import('../frame.js').startFrame>} Frame
 * @typedef {import('../../engine/protocol.js').Rpc} Rpc
 */

const SITE = 'idcheck'
const serve = async () => ({ bytes: new TextEncoder().encode('<!doctype html><title>id</title><p>id'), type: 'text/html' })
const WRITE = `(async () => {
  localStorage.setItem('k', 'set')
  await new Promise((resolve, reject) => {
    const r = indexedDB.open('db', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('s')
    r.onerror = reject
    r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put('set', 'k'); t.oncomplete = () => { r.result.close(); resolve(null) } }
  })
  return 'written'
})()`
const READ = "(async () => JSON.stringify({ ls: localStorage.getItem('k'), idb: (await indexedDB.databases()).some((d) => d.name === 'db') }))()"

/**
 * @param {object} o
 * @param {() => Frame | null} o.ui
 * @param {ReturnType<typeof import('../identities.js').identities>} o.ids
 * @param {() => Rpc} o.engine
 * @param {() => number | undefined} o.pid the engine worker's process
 * @param {() => boolean} o.switching
 */
export async function identitycheck ({ ui, ids, engine, pid, switching }) {
  let all = true
  /** @param {string} name @param {unknown} pass */
  const ok = (name, pass) => { all = all && !!pass; console.log((pass ? 'PASS ' : 'FAIL ') + 'identities  ' + name) }
  /** @param {number} ms */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  /** @param {() => unknown} f */
  const until = async (f, ms = 60000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await f()) return true
    return false
  }
  const keys = async () => {
    const d = await engine().request('devices.list')
    return { identity: d.identity, device: d.devices.find((/** @type {{ current: boolean }} */ x) => x.current)?.publicKey }
  }
  const frameOf = () => /** @type {Frame} */ (ui())
  /** @param {string} js */
  const inFrame = async (js) => {
    const { fwc } = frameOf().inspect()
    await until(() => !fwc.isLoading())
    await until(() => fwc.executeJavaScript('!!document.getElementById("me-name") && document.getElementById("me-name").textContent !== "You"'))
    return fwc.executeJavaScript(js, true)
  }
  /** @param {string} prefix @param {string} js */
  const site = async (prefix, js) => {
    const v = createSiteView(SITE, { dynamic: false, serve, prefix })
    await until(() => v.webContents.getURL().startsWith('hyper://') && !v.webContents.isLoading())
    const out = await v.webContents.executeJavaScript(js)
    v.close()
    return out
  }

  const a = ids.current()
  const aKeys = await keys()
  ok('an install from before identities: one, "Main", on the engine folder', ids.list().length === 1 && a.name === 'Main' && a.dir === path.join(app.getPath('userData'), 'engine') && a.prefix === '')

  await inFrame(`document.getElementById('hb').click(); document.getElementById('m-new').click()
    document.getElementById('id-name').value = 'Work'; document.getElementById('id-create').click()`)
  await until(() => ids.list().length === 2)
  const b = ids.get(ids.list().find((i) => i.name === 'Work')?.id)
  ok('New identity… makes "Work", Main still open', ids.list().length === 2 && ids.current().id === a.id)
  ok('its id is random hex, its own folder and desktop', /^[0-9a-f]{16}$/.test(b.id) && b.dir !== a.dir && b.shell !== a.shell && b.prefix === b.id + '-')

  ok("a site's localStorage and IndexedDB, set under Main", await site(a.prefix, WRITE) === 'written')
  const underB = JSON.parse(await site(b.prefix, READ))
  ok('are not under Work', underB.ls === null && underB.idb === false)
  const underA = JSON.parse(await site(a.prefix, READ))
  ok('and still under Main', underA.ls === 'set' && underA.idb === true)
  const partitions = path.join(app.getPath('userData'), 'Partitions')
  const bSessions = path.join(partitions, b.prefix + 'site-' + SITE)
  ok("Work's site sessions have their own folder", fs.existsSync(bSessions) && fs.existsSync(path.join(partitions, 'site-' + SITE)))

  const first = frameOf()
  const firstTray = first.inspect().tray
  const aPid = pid()
  await inFrame("document.getElementById('hb').click(); document.querySelector('#switch .item').click()")
  ok('Switch to Work: a new window', await until(() => ui() && ui() !== first && !switching()))
  ok('the old window is gone, with its views', first.win.isDestroyed())
  ok('the tray is a new one', !firstTray || frameOf().inspect().tray !== firstTray)
  ok("Main's engine process is gone", typeof aPid === 'number' && await until(() => { try { process.kill(aPid, 0); return false } catch { return true } }))
  ok('one engine runs, a new process', typeof pid() === 'number' && pid() !== aPid)
  const bKeys = await keys()
  ok('Work has its own identity key and device key (its swarm key pair)', !!bKeys.identity && bKeys.identity !== aKeys.identity && !!bKeys.device && bKeys.device !== aKeys.device)
  ok('the menu and the top bar name it', await inFrame("document.getElementById('me-name').textContent + '|' + document.getElementById('hb-text').textContent") === 'Work|HyperBrowser · Work ▾')

  await inFrame("document.getElementById('hb').click(); document.querySelector('#switch .item').click()")
  ok('Switch to Main: Main again, the same keys', await until(() => ids.current().id === a.id && ui() && !switching()) && JSON.stringify(await keys()) === JSON.stringify(aKeys))

  const phrase = await inFrame(`frame.send('identities.phrase', { id: ${JSON.stringify(b.id)} })`)
  ok("Work's recovery phrase, read while closed (24 words)", phrase?.result?.words?.split(' ').length === 24)
  const refused = await inFrame(`frame.send('identities.delete', { id: ${JSON.stringify(a.id)} })`)
  ok('the open identity cannot be deleted', refused?.error?.code === 'NOT_ALLOWED' && fs.existsSync(a.dir))
  const deleted = await inFrame(`frame.send('identities.delete', { id: ${JSON.stringify(b.id)} })`)
  ok('Delete Work: its folder and desktop are gone, and it is unlisted', deleted?.result === true && !fs.existsSync(b.dir) && !fs.existsSync(b.shell) && ids.list().length === 1)
  ok('its site data is cleared', JSON.parse(await site(b.prefix, READ)).ls === null)
  const afterA = JSON.parse(await site(a.prefix, READ))
  ok('Main is intact: its folder, keys and site data', fs.existsSync(a.dir) && JSON.stringify(await keys()) === JSON.stringify(aKeys) && afterA.ls === 'set' && afterA.idb === true)
  console.log('IDENTITYCHECK LEFT ' + bSessions) // a session opened since launch keeps its folder: the next start sweeps it
  console.log(all ? 'IDENTITYCHECK PASS' : 'IDENTITYCHECK FAIL')
  frameOf().win.destroy()
}
