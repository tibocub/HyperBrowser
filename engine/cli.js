#!/usr/bin/env node
import process from 'process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { start, guard } from './index.js'
import { connect, pair } from './protocol.js'
import { publish } from './publish.js'
import { helper } from './helper.js'
import { configFile, parse, merge, template } from './helper-config.js'

const USAGE = `usage:
  publish <folder>   publish a site folder (made the first time; same key after), then stay online
  open <key>         open a site by its key (or an hg: link), then stay online
  helper             the always-on helper (docs/helper.md): its config file, circles, apps; until stopped
options: --dir <engine folder> (default ~/.hyperbrowser)  --bootstrap host:port,...  --once
  --invite member|admin   (publish) then print a one-use invite link to the site (an invite-only site's way in)
  --instance <name>       (publish) an app's instance owned by this engine: made once, the same one after;
                          the app's \`official\` record names it if the app has that type; --invite is then to it
  --new                   (publish) a fresh site for this folder, with a new key; the folder's old site is left
  --config <file>         (helper) default ~/.config/hyperbrowser-helper.conf; --join hg:... (repeatable) a circle invite`

const opts = { dir: path.join(os.homedir(), '.hyperbrowser'), dirGiven: false, bootstrap: undefined, once: false, invite: null, instance: null, fresh: false, config: null, join: [] }
const args = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') { opts.dir = argv[++i]; opts.dirGiven = true }
  else if (argv[i] === '--config') opts.config = argv[++i]
  else if (argv[i] === '--join') opts.join.push(argv[++i])
  else if (argv[i] === '--bootstrap') opts.bootstrap = argv[++i].split(',').map((hp) => ({ host: hp.split(':')[0], port: Number(hp.split(':')[1]) }))
  else if (argv[i] === '--once') opts.once = true
  else if (argv[i] === '--invite') opts.invite = argv[++i]
  else if (argv[i] === '--instance') opts.instance = argv[++i]
  else if (argv[i] === '--new') opts.fresh = true
  else args.push(argv[i])
}
const [cmd, target] = args

if (cmd === 'helper' && !target) {
  runHelper().catch((err) => {
    console.error(`${err.code || 'ERROR'}: ${err.message}`)
    process.exit(1)
  })
} else if (!['publish', 'open'].includes(cmd) || !target || (opts.invite !== null && !['member', 'admin'].includes(opts.invite))) {
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

// Watch the folder, not the file: editors replace the file on save.
async function runHelper () {
  const file = opts.config || configFile()
  const preset = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shell', 'preset.json')
  const read = () => {
    let text
    try { text = fs.readFileSync(file, 'utf-8') } catch {
      text = template()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
      console.log(`config: ${file} written with the defaults`)
    }
    const { values, errors } = parse(text)
    for (const e of errors) console.log(`config: ${e}`)
    return merge({ dir: opts.dirGiven ? opts.dir : undefined, join: opts.join.length ? opts.join : undefined }, values)
  }
  let config = read()
  const [a, b] = pair()
  const engine = start(a)
  guard(engine, process, { stack: false }) // one line in the journal; a restart would re-join everything
  const rpc = connect(b)
  await rpc.request('init', { dir: config.dir, bootstrap: opts.bootstrap })
  console.log(`helper ${(await rpc.request('contacts.me')).identity} in ${config.dir}`)
  const h = helper({ rpc, dir: config.dir, preset })
  let timer = null
  const watcher = fs.watch(path.dirname(file), (event, name) => {
    if (name && name !== path.basename(file)) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const next = read()
      if (next.dir !== config.dir) console.log(`config: dir is ${config.dir} until the next start`)
      config = { ...next, dir: config.dir }
      h.apply(config)
    }, 500)
  })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    watcher.close()
    clearTimeout(timer)
    await h.close()
    await rpc.request('close').catch(() => {})
    await engine.closed
    console.log('stopped')
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  await h.apply(config)
  await h.report()
  console.log('online; stop with Ctrl+C or systemctl stop')
}
