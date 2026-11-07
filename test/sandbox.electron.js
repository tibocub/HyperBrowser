// The sandbox self-test and its control run, as a test (spec 001 US3, SC-002). Node only (it starts
// Electron): `npm run test:sandbox`. The guarded run must pass every check; the control run (--no-guards)
// must fail, and fail exactly where a guard of ours does the work.
import test from 'brittle'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = createRequire(import.meta.url)('electron') // the binary's path, from Node

function selftest (...args) {
  return new Promise((resolve) => {
    const p = spawn(ELECTRON, ['.', '--selftest', ...args], { cwd: ROOT })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { out += d })
    const timer = setTimeout(() => p.kill(), 120000)
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }) })
  })
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
    'the page names no space: hyper.subspace(<other site>) is refused'
  ]) t.ok(failed.has(check), 'fails without guards: ' + check)
})
