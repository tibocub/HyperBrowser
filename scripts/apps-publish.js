#!/usr/bin/env node
// npm run apps:publish -- --dir <owner engine folder>: publishes every official app (scripts/apps.js) once, from
// that engine folder (default ~/.hyperbrowser, as engine/cli.js), writes their keys into shell/preset.json and
// says which changed. A different key already in preset.json is kept unless --replace. Then stops: run `node engine/cli.js publish <folder>` to stay online for visitors.
import process from 'process'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { start } from '../engine/index.js'
import { connect, pair } from '../engine/protocol.js'
import { publishApps } from './apps.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const opts = { dir: path.join(os.homedir(), '.hyperbrowser'), bootstrap: undefined, preset: path.join(ROOT, 'shell', 'preset.json'), replace: false }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') opts.dir = argv[++i]
  else if (argv[i] === '--bootstrap') opts.bootstrap = argv[++i].split(',').map((hp) => ({ host: hp.split(':')[0], port: Number(hp.split(':')[1]) }))
  else if (argv[i] === '--replace') opts.replace = true
  else if (argv[i] === '--preset') opts.preset = argv[++i] // the tests' copy
  else { console.error('usage: apps-publish [--dir <engine folder>] [--bootstrap host:port,...] [--preset <file>] [--replace]'); process.exit(1) }
}

const [a, b] = pair()
const engine = start(a)
const rpc = connect(b)
let code = 0
try {
  await rpc.request('init', { dir: opts.dir, bootstrap: opts.bootstrap })
  const changed = await publishApps(rpc, { root: ROOT, preset: opts.preset, replace: opts.replace, log: console.log })
  for (const c of changed) {
    console.log(c.kept
      ? `preset.json: ${c.id} KEPT ${c.was}; this engine folder published it as ${c.key} (another checkout or --dir? --replace to write it)`
      : `preset.json: ${c.id} ${c.was ? c.was + ' -> ' : ''}${c.key}`)
  }
  const n = changed.filter((c) => !c.kept).length
  console.log(n ? `preset.json: ${n} key(s) written` : 'preset.json: no change')
  if (changed.some((c) => c.kept)) code = 1
} catch (err) {
  console.error(`${err.code || 'ERROR'}: ${err.message}`)
  code = 1
}
await rpc.request('close').catch(() => {})
await engine.closed
process.exit(code)
