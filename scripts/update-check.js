#!/usr/bin/env node
// The update path, end to end on this machine (spec 011): version N installed, N+1 released on a channel,
// N picks it up while running and keeps its data. A local DHT (hyperdht testnet) and a throwaway channel
// written here (the drive `pear stage` would write), so nothing reaches the real network's release channel.
//
//   npm run test:update [-- --tmp <dir>] [-- --reuse]
//
// 1. npm run build twice: 1.0.0 and 1.0.1, both following the throwaway channel (--reuse: the last builds).
// 2. 1.0.0 "installed" (a copy in <tmp>/install), a data folder of its own (--user-data-dir) with settings.
// 3. 1.0.0 runs; once its engine is up, 1.0.1 is released on the channel (scripts/release.js's folder).
// 4. Its log says "update: ready 1.0.1". It quits (its window closed, the tray off): what is installed is
//    1.0.1 now (Windows: the HyperBrowser folder, swapped once it has quit; Linux: the AppImage, at once).
// 5. Launched again: it is 1.0.1, same identity, same settings.
// Heavy (two builds, ~10 min): not in npm test. Run on Windows; Linux (.AppImage) not run yet.

import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import createTestnet from 'hyperdht/testnet.js'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import Localdrive from 'localdrive'
import z32 from 'z32'
import { releaseFolder } from './release.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const tmp = path.resolve(argv.includes('--tmp') ? argv[argv.indexOf('--tmp') + 1] : path.join(ROOT, 'out', 'update-check'))
const REUSE = argv.includes('--reuse')
const WIN = process.platform === 'win32'
const N = '1.0.0'
const N1 = '1.0.1'

const results = []
const check = (name, pass, more = '') => { results.push(pass); console.log((pass ? 'PASS ' : 'FAIL ') + name + (more && !pass ? '  (' + more + ')' : '')) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
// the installed version: Windows, the folder's package.json; Linux, the AppImage's bytes (null while it moves)
const versionOf = (p) => {
  try {
    if (WIN) return JSON.parse(fs.readFileSync(path.join(p, 'resources', 'app', 'package.json'), 'utf-8')).version
    return [N, N1].find((v) => hash(p) === hash(built(v))) || null
  } catch { return null }
}

// The channel: a Hyperdrive on the local DHT, its key kept in <tmp> across --reuse runs (the builds carry it).
fs.mkdirSync(tmp, { recursive: true })
if (!REUSE) for (const d of ['channel', 'install', 'data']) fs.rmSync(path.join(tmp, d), { recursive: true, force: true })
const testnet = await createTestnet(3)
const bootstrap = testnet.bootstrap.map((b) => b.host + ':' + b.port).join(',')
const store = new Corestore(path.join(tmp, 'channel'))
const drive = new Hyperdrive(store)
await drive.ready()
const upgrade = 'pear://' + z32.encode(drive.key)
const swarm = new Hyperswarm({ bootstrap: testnet.bootstrap })
swarm.on('connection', (c) => store.replicate(c))
swarm.join(drive.discoveryKey, { server: true, client: false })
await swarm.flush()

// 1. the two builds
const built = (v) => path.join(tmp, 'build-' + v + (WIN ? '' : '.AppImage')) // Windows: the folder
for (const v of [N, N1]) {
  if (REUSE && fs.existsSync(built(v))) continue
  if (REUSE) throw new Error('--reuse: no build ' + v + ' in ' + tmp)
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), '--version', v, '--upgrade', upgrade, '--out', path.join(tmp, 'out')], { stdio: 'inherit' })
  if (WIN) fs.cpSync(path.join(tmp, 'out', 'dist', 'win-unpacked'), built(v), { recursive: true })
  else fs.copyFileSync(path.join(tmp, 'out', 'dist', 'HyperBrowser.AppImage'), built(v))
}
if (REUSE) { // the builds follow the channel of the run that made them: write to that one (its key in <tmp>)
  const saved = fs.readFileSync(path.join(tmp, 'channel.link'), 'utf-8')
  if (saved !== upgrade) throw new Error('--reuse: the channel changed; run without --reuse')
} else fs.writeFileSync(path.join(tmp, 'channel.link'), upgrade)

// 2. installed: 1.0.0, a data folder with settings of its own
const install = path.join(tmp, 'install')
const data = path.join(tmp, 'data')
const installed = path.join(install, WIN ? 'HyperBrowser' : 'HyperBrowser.AppImage')
const program = WIN ? path.join(installed, 'HyperBrowser.exe') : installed
fs.rmSync(install, { recursive: true, force: true })
fs.rmSync(data, { recursive: true, force: true })
fs.mkdirSync(install, { recursive: true })
fs.mkdirSync(data, { recursive: true })
if (WIN) fs.cpSync(built(N), installed, { recursive: true })
else { fs.copyFileSync(built(N), installed); fs.chmodSync(installed, 0o755) }
const settings = { theme: 'dark', accent: '#c2410c', tray: false, trayNoticed: true } // no tray: closing quits
fs.writeFileSync(path.join(data, 'shell.json'), JSON.stringify({ settings }))
const LOG = path.join(data, 'hyperbrowser.log')
const logText = () => { try { return fs.readFileSync(LOG, 'utf-8') } catch { return '' } }

function launch () {
  const p = spawn(program, ['--user-data-dir=' + data], { env: { ...process.env, HYPERBROWSER_UPDATE_BOOTSTRAP: bootstrap, HYPERBROWSER_UPDATE_DELAY: '0' }, stdio: 'ignore', detached: process.platform !== 'win32' })
  p.on('error', (err) => console.error('launch:', err.message))
  return p
}
// Its window closed, as a person quitting (Windows: taskkill without /F; Linux: SIGTERM). Killed after 30 s.
async function stop (p) {
  const exited = new Promise((resolve) => p.once('exit', resolve))
  const kill = (force) => {
    try {
      if (WIN) execFileSync('taskkill', ['/PID', String(p.pid), ...(force ? ['/T', '/F'] : [])], { stdio: 'ignore' }) // /T without /F gives up on the windowless Bare workers
      else process.kill(-p.pid, force ? 'SIGKILL' : 'SIGTERM')
    } catch {}
  }
  kill(false)
  const clean = await Promise.race([exited.then(() => true), sleep(30000).then(() => false)])
  if (!clean) { kill(true); await exited }
  return clean
}
async function until (f, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { const v = f(); if (v) return v }
  return null
}
const identityIn = (text) => [...text.matchAll(/engine up, identity (\S+)/g)].map((m) => m[1])

// 1.0.1's release folder, made now: copying ~430 MB blocks this process, which also seeds the channel
const folder = releaseFolder([built(N1)], { out: path.join(tmp, 'release'), pkg: { name: 'hyperbrowser', productName: 'HyperBrowser', version: N1, upgrade } })

try {
  // 3. 1.0.0 runs, then 1.0.1 is released (with --reuse, the channel has it already: found at launch)
  let app = launch()
  check('1.0.0 starts and follows the channel', !!(await until(() => logText().includes('HyperBrowser ' + N + ', channel ' + upgrade), 60000)), logText().slice(-500))
  const before = await until(() => identityIn(logText())[0], 60000)
  check('its engine is up', !!before)
  const local = new Localdrive(folder)
  await local.mirror(drive).done()
  await local.close()
  console.log('released ' + N1 + ' on ' + upgrade + ' (' + drive.version + ' blocks)')

  // 4. picked up while running
  check('1.0.0 downloads 1.0.1 and installs it ("update: ready 1.0.1")', !!(await until(() => logText().includes('update: ready ' + N1), 300000)), logText().slice(-800))
  check('it quits when its window closes', await stop(app))
  check('what is installed is 1.0.1 now', !!(await until(() => versionOf(installed) === N1, 60000)), versionOf(installed))
  if (WIN) check("1.0.0's folder removed", !!(await until(() => !fs.existsSync(installed + '-' + N), 30000)))

  // 5. the next launch is 1.0.1, with the same data
  fs.appendFileSync(LOG, '--- relaunch\n')
  app = launch()
  const after = await until(() => identityIn(logText().split('--- relaunch\n')[1] || '')[0], 90000)
  const second = logText().split('--- relaunch\n')[1] || ''
  check('the next launch runs 1.0.1', second.includes('HyperBrowser ' + N1 + ', channel'), second.slice(0, 500))
  check('the same identity', !!after && after === before, before + ' → ' + after)
  let saved = null
  try { saved = JSON.parse(fs.readFileSync(path.join(data, 'shell.json'), 'utf-8')).settings } catch {}
  check('the same settings', !!saved && saved.theme === settings.theme && saved.accent === settings.accent)
  check('the same engine folder (identity, sites)', fs.existsSync(path.join(data, 'engine')))
  await sleep(5000)
  check('1.0.1 finds nothing newer', !logText().split('--- relaunch\n')[1].includes('update: ready'))
  await stop(app)
} finally {
  await swarm.destroy()
  await drive.close()
  await store.close()
  await testnet.destroy()
}
const ok = results.length > 0 && results.every(Boolean)
console.log(ok ? 'UPDATE CHECK PASS' : 'UPDATE CHECK FAIL')
process.exit(ok ? 0 : 1)
