#!/usr/bin/env node
// The release folder `pear stage` takes (spec 011), from what npm run build made on each OS:
//
//   npm run release -- <build> [<build> ...] [--out <dir>] [--mac-arch arm64|x64]
//   e.g. npm run release -- out/dist/win-unpacked ../HyperBrowser.AppImage
//
// → <out>/hyperbrowser-<version>/package.json (name, productName, version, upgrade: what the updater reads)
//   and by-arch/<platform>-<arch>/app/<HyperBrowser...>, the layout pear-runtime's updater looks for (what
//   `pear build` makes; done here because Windows ships a folder). Which OS, from the build:
//   a folder (win-unpacked) win32-x64, as app/HyperBrowser/; .AppImage linux-x64; -mac.zip darwin (the .app).

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export function releaseFolder (builds, { out = path.join(ROOT, 'out', 'release'), pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')), macArch = 'arm64' } = {}) {
  if (!pkg.upgrade) throw new Error('package.json has no "upgrade" link: run `pear touch` first (docs/packaging.md)')
  const dir = path.join(out, pkg.name + '-' + pkg.version)
  fs.rmSync(dir, { recursive: true, force: true })
  for (const build of builds) {
    const folder = fs.statSync(build).isDirectory()
    const host = folder ? 'win32-x64' : build.endsWith('.AppImage') ? 'linux-x64' : build.endsWith('.zip') ? 'darwin-' + macArch : null
    if (!host) throw new Error('not a HyperBrowser build: ' + build)
    if (folder && !fs.existsSync(path.join(build, pkg.productName + '.exe'))) throw new Error('no ' + pkg.productName + '.exe in ' + build)
    const app = path.join(dir, 'by-arch', host, 'app')
    fs.mkdirSync(app, { recursive: true })
    if (folder) fs.cpSync(build, path.join(app, pkg.productName), { recursive: true })
    else if (host === 'linux-x64') fs.copyFileSync(build, path.join(app, pkg.productName + '.AppImage'))
    else execFileSync('unzip', ['-q', build, '-d', app]) // the .app, kept a folder
  }
  const { name, productName, version, upgrade } = pkg
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, productName, version, upgrade }, null, 2) + '\n')
  return dir
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2)
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv.splice(i, 2)[1] }
  const out = opt('--out')
  const macArch = opt('--mac-arch')
  if (!argv.length) { console.error('usage: npm run release -- <out/dist/win-unpacked | HyperBrowser.AppImage | HyperBrowser-mac.zip> ... [--out dir]'); process.exit(1) }
  const dir = releaseFolder(argv, { out: out && path.resolve(out), macArch })
  const { upgrade } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
  console.log('release folder: ' + dir + '\nnext: pear stage ' + upgrade + ' "' + dir + '"')
}
