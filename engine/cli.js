#!/usr/bin/env node
// The engine without a window (specs/001-engine/contracts/cli.md): the same start() as the shell's
// worker, on one end of an in-process stream. Node or Bare:
//   node engine/cli.js publish <folder> [--dir d] [--bootstrap host:port,...] [--instance name] [--invite member|admin] [--once]
//   node engine/cli.js open <key> [--dir d] [--bootstrap host:port,...] [--once]
import process from 'process'
import os from 'os'
import path from 'path'
import { start } from './index.js'
import { connect, pair } from './protocol.js'
import { publish } from './publish.js'

const USAGE = `usage:
  publish <folder>   publish a site folder (made the first time; same key after), then stay online
  open <key>         open a site by its key (or an hg: link), then stay online
options: --dir <engine folder> (default ~/.hyperbrowser)  --bootstrap host:port,...  --once
  --invite member|admin   (publish) then print a one-use invite link to the site (an invite-only site's way in)
  --instance <name>       (publish) an app's instance owned by this engine (spec 009): made once, the same one after;
                          the app's \`official\` record names it if the app has that type; --invite is then to it
  --new                   (publish) a fresh site for this folder, with a new key; the folder's old site is left`

const opts = { dir: path.join(os.homedir(), '.hyperbrowser'), bootstrap: undefined, once: false, invite: null, instance: null, fresh: false }
const args = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') opts.dir = argv[++i]
  else if (argv[i] === '--bootstrap') opts.bootstrap = argv[++i].split(',').map((hp) => ({ host: hp.split(':')[0], port: Number(hp.split(':')[1]) }))
  else if (argv[i] === '--once') opts.once = true
  else if (argv[i] === '--invite') opts.invite = argv[++i]
  else if (argv[i] === '--instance') opts.instance = argv[++i]
  else if (argv[i] === '--new') opts.fresh = true
  else args.push(argv[i])
}
const [cmd, target] = args

if (!['publish', 'open'].includes(cmd) || !target || (opts.invite !== null && !['member', 'admin'].includes(opts.invite))) {
  console.error(USAGE)
  process.exit(1)
} else {
  const [a, b] = pair()
  const engine = start(a)
  const rpc = connect(b)
  const stop = async (code) => {
    await rpc.request('close').catch(() => {})
    await engine.closed
    process.exit(code)
  }
  process.on('SIGINT', () => stop(0))
  run(rpc).then(
    () => (opts.once ? stop(0) : console.log('online; Ctrl+C to stop')),
    (err) => {
      console.error(`${err.code || 'ERROR'}: ${err.message}`)
      stop(1)
    }
  )
}

async function run (rpc) {
  await rpc.request('init', { dir: opts.dir, bootstrap: opts.bootstrap })
  if (cmd === 'publish') {
    const r = await publish(rpc, target, { fresh: opts.fresh, instance: opts.instance, invite: opts.invite })
    console.log(`key: ${r.key}${r.created ? ' (created)' : ''}`)
    if (r.instance) console.log(`instance: ${r.instance}${r.instanceCreated ? ' (created)' : ''}`)
    if (r.invite) console.log(`invite (${opts.invite}, one use${r.instance ? ', to the instance' : ''}): ${r.invite}`)
    return
  }
  const { key, manifest, dynamic } = await rpc.request('site.open', { key: target })
  console.log(`key: ${key}\ntitle: ${manifest.title}\nentry: ${manifest.entry}\ndynamic: ${dynamic}`)
  const { bytes } = await rpc.request('site.read', { key, path: '' })
  console.log(`entry bytes: ${bytes.byteLength}`)
}
