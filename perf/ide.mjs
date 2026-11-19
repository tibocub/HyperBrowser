// what the IDE costs. Runs the self-test (its IDE check prints PERF lines: the IDE's start, CodeMirror's first
// load, the page's memory before and after it, a preview's reload) and the size of the two bundles (sites/ide/vendor).
//   npm run perf:ide   (appends to perf/history.jsonl)
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { spawnSync, execSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const ELECTRON = createRequire(import.meta.url)('electron')
const r = spawnSync(ELECTRON, ['.', '--selftest'], { cwd: ROOT, encoding: 'utf-8', timeout: 300000 })
const out = (r.stdout || '') + (r.stderr || '')
if (!out.includes('SELFTEST PASS')) {
  console.error(out.split('\n').filter((l) => l.startsWith('FAIL') || l.includes('SELFTEST')).join('\n') || out.slice(-2000))
  process.exit(1)
}
const rows = []
for (const [, name, value, unit] of out.matchAll(/^PERF (\S+) (\d+) (\S+)$/gm)) rows.push([name, unit, Number(value)])
for (const f of ['editor.js', 'hmd.js']) {
  const bytes = fs.readFileSync(path.join(ROOT, 'sites', 'ide', 'vendor', f))
  rows.push([`ide.bundle.${f.replace('.js', '')}`, 'KB', Math.round(bytes.length / 1024)])
  rows.push([`ide.bundle.${f.replace('.js', '')}.gzip`, 'KB', Math.round(zlib.gzipSync(bytes).length / 1024)])
}
for (const [name, unit, v] of rows) console.log(`${name}: ${v} ${unit}`)
record(rows)

function record (list) {
  const git = (c) => { try { return execSync('git ' + c, { cwd: HERE }).toString().trim() } catch { return null } }
  const now = new Date().toISOString()
  const common = {
    date: now, run: now, sha: git('rev-parse HEAD'), dirty: !!git('status --porcelain'), runtime: 'electron', version: process.version,
    machine: { cores: os.cpus().length, cpu: os.cpus()[0].model, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${process.platform} ${os.release()}` }
  }
  const line = ([scenario, unit, v]) => JSON.stringify({ ...common, scenario, size: 1, unit, better: 'lower', median: v, spread: 0, n: 1, min: v, max: v })
  fs.appendFileSync(path.join(HERE, 'history.jsonl'), list.map(line).join('\n') + '\n')
}
