// The sandbox self-test and its control run, as a test (spec 001 US3, SC-002), then the frame check
// (spec 002 US6, FR-010, FR-013), then the textures check at 100, 125, 150 % (spec 008), then the tray
// (spec 010: close to the tray, one HyperBrowser a data folder, Quit, the setting). Node only (it starts
// Electron): `npm run test:sandbox`. The guarded run must pass every check; the control run (--no-guards)
// must fail, and fail exactly where a guard of ours does the work.
import test from 'brittle'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = createRequire(import.meta.url)('electron') // the binary's path, from Node

function selftest (...args) {
  return run(['.', ...(args.includes('--framecheck') ? [] : ['--selftest']), ...args])
}

const run = (args) => launch(args).done

// → { done: Promise<{ code, out }>, saw(text): resolves once the output has it (or the process ended) }
function launch (args) {
  const p = spawn(ELECTRON, args, { cwd: ROOT })
  let out = ''
  const waiters = []
  const add = (d) => {
    out += d
    for (const w of waiters.filter((w) => out.includes(w.text))) w.resolve()
  }
  p.stdout.on('data', add)
  p.stderr.on('data', add)
  const timer = setTimeout(() => p.kill(), 120000)
  const done = new Promise((resolve) => p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }) }))
  const saw = (text) => Promise.race([done, new Promise((resolve) => { if (out.includes(text)) resolve(); else waiters.push({ text, resolve }) })])
  return { done, saw }
}

const fails = (out) => out.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.replace(/^FAIL \S+\s+/, '').trim())

test('the self-test passes with the guards on', { timeout: 150000 }, async (t) => {
  const { code, out } = await selftest()
  t.is(fails(out).length, 0, fails(out).join('; '))
  t.ok(out.includes('SELFTEST PASS'))
  t.is(code, 0)
})

test('the control run (guards off) fails where our guards work', { timeout: 150000 }, async (t) => {
  const { code, out } = await selftest('--no-guards')
  const failed = new Set(fails(out))
  t.ok(out.includes('SELFTEST FAIL'))
  t.is(code, 1)
  for (const check of [
    "other site's files: <script src=hyper://<other>/probe.js> doesn't run",
    'no web: <img src=https://...> fails to load (needs internet to mean anything)',
    'the page names no space: hyper.subspace(<other site>) is refused',
    'the page names no space: hyper.instance(<other site>) is refused',
    'people: opening a chat without a click opens nothing', // spec 013
    'people: a friend request the person refused is NOT_ALLOWED',
    'hyper.people: nothing opened without a click',
    'hyper.people: a request the person refused sent nothing',
    'apps: installing a site without a click installs nothing', // spec 014
    'apps: opening a site without a click opens nothing',
    'hyper.apps: nothing installed or opened without a click',
    "hyper.apps: a click and the person's no install nothing"
  ]) t.ok(failed.has(check), 'fails without guards: ' + check)
})

test('the frame: no OS frame, no app menu, sites under the bars', { timeout: 150000 }, async (t) => {
  const { code, out } = await selftest('--framecheck')
  t.is(fails(out).length, 0, fails(out).join('; '))
  t.ok(out.includes('FRAMECHECK PASS'))
  t.is(code, 0)
})

test('the textures: whole device pixels at 100, 125, 150 %, still when the page scrolls', { timeout: 150000 }, async (t) => {
  for (const scale of ['1', '1.25', '1.5']) {
    const { code, out } = await run(['shell/selftest/pixels.cjs', '--force-device-scale-factor=' + scale])
    t.is(fails(out).length, 0, scale + ': ' + fails(out).join('; '))
    t.ok(out.includes('PIXELS PASS'), scale)
    t.is(code, 0)
  }
})

test('the tray: closing keeps it running, a second launch shows it, Quit ends it; turned off, closing quits', { timeout: 300000 }, async (t) => {
  const tmp = process.env.HG_TEST_TMP || os.tmpdir()
  fs.mkdirSync(tmp, { recursive: true })
  const profile = fs.mkdtempSync(path.join(tmp, 'hb-tray-'))
  t.teardown(() => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }))
  const user = '--user-data-dir=' + profile

  const first = launch(['.', user, '--traycheck', 'quit'])
  await first.saw('TRAYCHECK WAITING')
  const second = await run(['.', user])
  t.is(second.code, 0, 'the second launch ends by itself')
  t.absent(second.out.includes('engine up'), 'without starting a second engine')
  const one = await first.done
  t.is(fails(one.out).length, 0, fails(one.out).join('; '))
  t.ok(one.out.includes('TRAYCHECK QUIT'))
  t.is(one.code, 0, "the tray's Quit ends the process")

  // the same data folder: an engine left running by the first would hold it, and this one couldn't start
  const two = await run(['.', user, '--traycheck', 'off'])
  t.ok(two.out.includes('engine up'), 'the engine starts again on the same folder')
  t.is(fails(two.out).length, 0, fails(two.out).join('; '))
  t.ok(two.out.includes('TRAYCHECK CLOSE'))
  t.is(two.code, 0, 'with the setting off, closing the window ends the process')
  t.is(JSON.parse(fs.readFileSync(path.join(profile, 'shell.json'), 'utf-8')).settings.tray, false, 'the setting is remembered')
})
