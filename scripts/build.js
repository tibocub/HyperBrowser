#!/usr/bin/env node
// Builds the installable HyperBrowser for this machine's OS (spec 011). One command:
//   Windows: <out>/dist/win-unpacked (the HyperBrowser folder: what is released) and HyperBrowser.zip (it, to
//            download); Linux: HyperBrowser.AppImage; macOS: HyperBrowser.zip (the .app, not tested).
//
//   npm run build [-- --version x.y.z] [-- --upgrade pear://...] [-- --out <dir>] [-- --apps-from <dir>]
//
// --apps-from: the owner's engine folder (the one `npm run apps:publish` publishes from): the preset apps'
// own signed data is packed into <out>/app/apps (spec 015, scripts/bundle.js), so a new install opens them
// with nobody online and peers update them. No process may have that folder open. Without it: no apps.
//
// The app's files (shell/, engine/) go to <out>/app with a package.json of their own; the sibling repos this
// repo links (file:../hypergraph, ../SwarmFS... and theirs) are copied in as real folders, without their
// tests, docs and .claude; npm installs it all (--install-links: copies, never links); electron-builder makes
// the files in <out>/dist. --upgrade (default: package.json "upgrade") is the release channel the build
// follows; a build without one never updates. Caches go under <out>/cache (C: is nearly full here).

import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { bundleApps } from './bundle.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const argv = process.argv.slice(2)
const arg = (name, def) => { const i = argv.indexOf(name); return i === -1 ? def : argv[i + 1] }
const version = arg('--version', pkg.version)
const upgrade = arg('--upgrade', pkg.upgrade || null)
const out = path.resolve(arg('--out', path.join(ROOT, 'out')))
const appsFrom = arg('--apps-from', null)
const preset = path.resolve(arg('--preset', path.join(ROOT, 'shell', 'preset.json'))) // a check's copy, as apps-publish's --preset
const app = path.join(out, 'app')
const vendor = path.join(out, 'vendor')
const cache = path.join(out, 'cache')
const SKIP = new Set(['.git', '.claude', '.specify', '.github', 'node_modules', 'test', 'tests', 'docs', 'specs', 'perf', 'bench', 'examples', 'out', 'tmp', '.data'])
const TARGET = { win32: ['--win', 'dir'], linux: ['--linux', 'AppImage'], darwin: ['--mac', 'zip'] }[process.platform]
const ELECTRON = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf-8')).version
const BUILDER = '26.18.0' // electron-builder, pinned: only the build uses it, so it stays out of package.json

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('version must be x.y.z: ' + version)
if (!TARGET) throw new Error('no build for ' + process.platform)
if (!upgrade) console.warn('no release channel (package.json "upgrade" or --upgrade): this build never updates')
if (!appsFrom) console.warn('no --apps-from <owner engine folder>: this build ships no apps (a new install opens them only from peers)')

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, npm_config_cache: path.join(cache, 'npm'), ELECTRON_BUILDER_CACHE: path.join(cache, 'electron-builder') } })
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || src === from })

// Where a file: dependency really is: the folder its node_modules links to (a worktree's ../ is not the repo's).
const linked = (dir, name, spec) => {
  try { return fs.realpathSync(path.join(dir, 'node_modules', name)) } catch { return fs.realpathSync(path.resolve(dir, spec.slice(5))) }
}

// The linked repos: each in vendor/<its folder name>, so their own file:../x links still point at each other.
function vendorOf (dir, done = new Set()) {
  const deps = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).dependencies || {}
  for (const [name, spec] of Object.entries(deps)) {
    if (!spec.startsWith('file:')) continue
    const real = linked(dir, name, spec)
    if (done.has(real)) continue
    done.add(real)
    copy(real, path.join(vendor, path.basename(real)))
    vendorOf(real, done)
  }
  return done
}

fs.mkdirSync(cache, { recursive: true })
fs.writeFileSync(path.join(cache, 'package.json'), '{ "type": "commonjs" }\n') // electron-builder's tools are CommonJS .js files; out/ is inside this "type": "module" repo
fs.rmSync(app, { recursive: true, force: true })
fs.rmSync(vendor, { recursive: true, force: true })
fs.rmSync(path.join(out, 'dist'), { recursive: true, force: true })
for (const d of ['shell', 'engine']) copy(path.join(ROOT, d), path.join(app, d))
fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(app, 'LICENSE'))
fs.copyFileSync(preset, path.join(app, 'shell', 'preset.json'))
if (appsFrom) {
  const presets = JSON.parse(fs.readFileSync(preset, 'utf-8'))
  for (const a of await bundleApps(path.resolve(appsFrom), path.join(app, 'apps'), presets)) console.log('bundled ' + a.id + ': ' + a.key)
}
vendorOf(ROOT)
const dependencies = {}
for (const [name, spec] of Object.entries(pkg.dependencies)) {
  dependencies[name] = spec.startsWith('file:') ? 'file:../vendor/' + path.basename(linked(ROOT, name, spec)) : spec
}
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version, description: pkg.description, license: pkg.license,
  author: 'HyperBrowser', type: pkg.type, main: pkg.main, imports: pkg.imports, upgrade, dependencies,
  devDependencies: { 'electron-builder': BUILDER },
  build: {
    appId: 'org.hyperbrowser.app',
    electronVersion: ELECTRON,
    electronDist: path.join(ROOT, 'node_modules', 'electron', 'dist'), // the one npm start runs: no download
    productName: pkg.productName,
    asar: false, // pear-runtime starts the Bare workers from real files
    directories: { output: path.join(out, 'dist') },
    files: ['shell/**', 'engine/**', 'apps/**', 'package.json', 'LICENSE', 'node_modules/**'],
    win: { icon: 'shell/app.png' },
    linux: { icon: 'shell/app.png', category: 'Network' },
    appImage: { artifactName: '${productName}.AppImage' }, // eslint-disable-line no-template-curly-in-string
    mac: { icon: 'shell/app.png', target: 'zip', artifactName: '${productName}-mac.zip' } // eslint-disable-line no-template-curly-in-string
  }
}, null, 2))

run('npm', ['install', '--install-links', '--no-audit', '--no-fund', '--loglevel=error'], app)
// Native prebuilds for other platforms (android, ios, darwin, arm64...): ~450 MB in every download and
// install. Only this OS and arch stay (Holepunch's template prunes the same way).
const HOST = process.platform + '-' + process.arch
const prune = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const sub = path.join(dir, e.name)
    if (e.name === 'prebuilds') for (const p of fs.readdirSync(sub)) { if (p !== HOST) fs.rmSync(path.join(sub, p), { recursive: true, force: true }) }
    else prune(sub)
  }
}
prune(path.join(app, 'node_modules'))
run('npx', ['electron-builder', ...TARGET, '--publish', 'never'], app)
if (process.platform === 'win32') { // the zip people download: one HyperBrowser folder in it (Windows' own tar)
  const dist = path.join(out, 'dist')
  fs.renameSync(path.join(dist, 'win-unpacked'), path.join(dist, pkg.productName))
  try {
    execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-c', '-f', pkg.productName + '.zip', pkg.productName], { cwd: dist, stdio: 'inherit' })
  } finally {
    fs.renameSync(path.join(dist, pkg.productName), path.join(dist, 'win-unpacked'))
  }
}
const made = fs.readdirSync(path.join(out, 'dist')).filter((f) => /^(HyperBrowser(-mac)?\.(AppImage|zip)|win-unpacked)$/.test(f))
console.log('\nbuilt ' + version + (upgrade ? ' (channel ' + upgrade + ')' : ' (no channel)') + ':\n' + made.map((f) => '  ' + path.join(out, 'dist', f)).join('\n'))
