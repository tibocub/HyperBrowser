import test from 'brittle'
import fs from 'fs'
import path from 'path'
import b4a from 'b4a'
import process from 'process'
import { spawnSync } from 'child_process'
import { engine, siteApi, siteFolder, tmpDir, eventually, codeOf, bootstrap, text } from './helpers.js'
import { linkOrCopy } from '../engine/projects.js'

const IDE = { title: 'IDE', permissions: ['space', 'projects'] }
const SITE = JSON.stringify({ title: 'My page' })

async function ide (t, opts = {}) {
  const e = await engine(t, { projects: tmpDir(t, 'projects'), ...opts })
  const { key } = await e.rpc.request('site.publish', { folder: siteFolder(t, { manifest: IDE }) })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  await e.rpc.request('site.permit', { key, permission: 'projects', allow: true })
  const p = (method, ...args) => e.rpc.request('site.call', { key, method: 'projects.' + method, args })
  return { ...e, ide: key, p }
}

const read = async (p, project, file) => text(await p('read', project, file))
// unlinked, never deleted through: a junction is a folder on Windows (rmdir), a symlink elsewhere (unlink)
const unlinkLink = (at) => (process.platform === 'win32' ? fs.rmdirSync(at) : fs.unlinkSync(at))
const disk = (file) => { try { return fs.readFileSync(file, 'utf-8') } catch { return null } } // null meanwhile: SwarmFS replaces files by renames

test('the projects permission: declared, asked once, refused after a no; none for other sites', async (t) => {
  const e = await engine(t, { projects: tmpDir(t, 'projects') })
  const { key } = await e.rpc.request('site.publish', { folder: siteFolder(t, { manifest: IDE }) })
  await e.rpc.request('site.open', { key })
  await e.rpc.request('site.consent', { key, allow: true })
  const list = () => e.rpc.request('site.call', { key, method: 'projects.list', args: [] })
  t.is(await codeOf(list()), 'NEEDS_PERMISSION', 'asked first')
  await e.rpc.request('site.permit', { key, permission: 'projects', allow: false })
  t.is(await codeOf(list()), 'NOT_ALLOWED', 'after a no')
  await e.rpc.request('site.permit', { key, permission: 'projects', allow: true })
  t.alike(await list(), [], 'after a yes')
  const { key: other } = await e.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Other', permissions: ['space'] } }) })
  await e.rpc.request('site.open', { key: other })
  await e.rpc.request('site.consent', { key: other, allow: true })
  t.is(await codeOf(e.rpc.request('site.call', { key: other, method: 'projects.list', args: [] })), 'NOT_ALLOWED', "a site that doesn't declare it")
  t.is(await codeOf(e.rpc.request('site.permit', { key: other, permission: 'projects', allow: true })), 'NOT_ALLOWED', "and can't be given it")
})

test('files: create, write, read, list, rename, remove; .git and node_modules ignored; paths checked', async (t) => {
  const { p } = await ide(t)
  const made = await p('create', 'Blog')
  t.is(made.name, 'Blog')
  t.ok(fs.existsSync(made.folder), 'a folder on disk: ' + made.folder)
  const ignore = fs.readFileSync(path.join(made.folder, '.swarmfsignore'), 'utf-8')
  t.ok(ignore.includes('.git/') && ignore.includes('node_modules/'), 'sync ignores .git and node_modules')
  await p('write', made.key, 'index.html', '<h1>hello</h1>')
  await p('write', made.key, 'css/site.css', b4a.from('body{}'))
  t.is(await read(p, made.key, 'index.html'), '<h1>hello</h1>')
  t.is(fs.readFileSync(path.join(made.folder, 'css', 'site.css'), 'utf-8'), 'body{}', 'on disk, in its folder')
  fs.mkdirSync(path.join(made.folder, '.git'))
  fs.writeFileSync(path.join(made.folder, '.git', 'HEAD'), 'ref')
  const files = (await p('files', made.key)).map((f) => f.path).sort()
  t.alike(files, ['.swarmfsignore', 'css/site.css', 'index.html'], 'listed, without what is ignored: ' + files)
  await p('rename', made.key, 'css/site.css', 'style/main.css')
  t.is(await read(p, made.key, 'style/main.css'), 'body{}', 'renamed, into a new folder')
  await p('remove', made.key, 'style')
  t.alike((await p('files', made.key)).map((f) => f.path).sort(), ['.swarmfsignore', 'index.html'], 'a folder removed with what is in it')
  t.alike((await p('list')).map((x) => x.name), ['Blog'], 'listed')

  for (const bad of ['../x', '/etc/passwd', 'C:\\x', 'a\\..\\..\\b', 'a/../../b', 'a:b', 'con', 'NUL.txt', '', '.']) {
    t.is(await codeOf(p('write', made.key, bad, 'x')), 'INVALID_PATH', 'refused: ' + JSON.stringify(bad))
  }
  const outside = tmpDir(t, 'outside')
  let linked = true
  try { fs.symlinkSync(outside, path.join(made.folder, 'out'), 'junction') } catch { linked = false }
  if (linked) {
    t.is(await codeOf(p('write', made.key, 'out/x.txt', 'x')), 'NOT_ALLOWED', 'a link out of the project')
    t.is(await codeOf(p('read', made.key, 'out')), 'NOT_ALLOWED', 'read through it too')
    t.absent(fs.existsSync(path.join(outside, 'x.txt')), 'nothing written outside')
    unlinkLink(path.join(made.folder, 'out'))
  } else t.comment('no junction on this runtime: link escape not checked here')
  t.is(await codeOf(p('read', 'y'.repeat(52), 'index.html')), 'NOT_FOUND', 'not one of the projects')
})

test('what the project never syncs is out of reach: .git, node_modules, ignored paths, .hyperbrowser.json', async (t) => {
  const { p } = await ide(t)
  const { key, folder } = await p('create', 'Guarded')
  fs.mkdirSync(path.join(folder, '.git', 'hooks'), { recursive: true })
  fs.writeFileSync(path.join(folder, '.git', 'config'), '[core]')
  fs.appendFileSync(path.join(folder, '.swarmfsignore'), 'secrets/\n')
  fs.mkdirSync(path.join(folder, 'secrets'))
  fs.writeFileSync(path.join(folder, 'secrets', 'k.txt'), 'k')
  await p('write', key, 'a.txt', 'a')
  for (const bad of ['.git/hooks/pre-commit', '.GIT/config', '.Git/hooks/post-checkout', 'node_modules/x/i.js', 'src/node_modules/y.js', 'secrets/k.txt', 'secrets/new.txt']) {
    t.is(await codeOf(p('write', key, bad, 'x')), 'NOT_ALLOWED', 'write refused: ' + bad)
    t.is(await codeOf(p('read', key, bad)), 'NOT_ALLOWED', 'read refused: ' + bad)
    t.is(await codeOf(p('remove', key, bad)), 'NOT_ALLOWED', 'remove refused: ' + bad)
    t.is(await codeOf(p('rename', key, 'a.txt', bad)), 'NOT_ALLOWED', 'rename into it refused: ' + bad)
  }
  t.is(await codeOf(p('rename', key, '.git/config', 'b.txt')), 'NOT_ALLOWED', 'rename out of .git refused')
  t.is(await codeOf(p('rename', key, 'secrets/k.txt', 'b.txt')), 'NOT_ALLOWED', 'rename out of an ignored folder refused')
  t.absent(fs.existsSync(path.join(folder, '.git', 'hooks', 'pre-commit')), 'no hook written')
  t.is(fs.readFileSync(path.join(folder, 'secrets', 'k.txt'), 'utf-8'), 'k', 'the ignored file untouched')
  fs.writeFileSync(path.join(folder, '.hyperbrowser.json'), '{}')
  t.is(await codeOf(p('write', key, '.hyperbrowser.json', '{"site":"x"}')), 'NOT_ALLOWED', '.hyperbrowser.json: no write')
  t.is(await codeOf(p('write', key, '.HyperBrowser.json', '{}')), 'NOT_ALLOWED', 'whatever the case')
  t.is(await codeOf(p('remove', key, '.hyperbrowser.json')), 'NOT_ALLOWED', 'no remove')
  t.is(await codeOf(p('rename', key, '.hyperbrowser.json', 'c.txt')), 'NOT_ALLOWED', 'no rename from it')
  t.is(await codeOf(p('rename', key, 'a.txt', '.hyperbrowser.json')), 'NOT_ALLOWED', 'no rename onto it')
  t.is(await read(p, key, '.hyperbrowser.json'), '{}', 'read is fine')
  await p('write', key, '.swarmfsignore', 'dist/\n')
  const rules = fs.readFileSync(path.join(folder, '.swarmfsignore'), 'utf-8')
  t.ok(rules.includes('.git/') && rules.includes('node_modules/') && rules.includes('dist/'), 'the ignore file keeps .git/ and node_modules/: ' + JSON.stringify(rules))
})

test('short names (GIT~1) and links inside the project to its .git are refused too', async (t) => {
  const { p } = await ide(t)
  const { key, folder } = await p('create', 'Short')
  fs.mkdirSync(path.join(folder, '.git', 'hooks'), { recursive: true })
  fs.mkdirSync(path.join(folder, 'node_modules'))
  for (const bad of ['GIT~1/hooks/pre-commit', 'NODE_M~1/x.js', 'a/GI3F2~1/b']) {
    t.is(await codeOf(p('write', key, bad, 'x')), 'INVALID_PATH', 'a short name: ' + bad)
  }
  let short = null
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('cmd', ['/c', 'for %I in (.git) do @echo %~sI'], { cwd: folder })
      short = String(r.stdout || '').trim().split(/[\\/]/).pop() || null // the last segment of the short path
    } catch {}
  }
  if (short && short !== '.git') t.is(await codeOf(p('write', key, short + '/hooks/pre-commit', 'x')), 'INVALID_PATH', "the disk's own short name for .git: " + short)
  else t.comment('no short name for .git here: not checked')
  let linked = true
  try { fs.symlinkSync(path.join(folder, '.git'), path.join(folder, 'docs'), 'junction') } catch { linked = false }
  if (linked) {
    t.is(await codeOf(p('write', key, 'docs/hooks/pre-commit', 'x')), 'NOT_ALLOWED', 'a link inside the project to its .git')
    t.is(await codeOf(p('read', key, 'docs/hooks')), 'NOT_ALLOWED', 'read through it too')
    unlinkLink(path.join(folder, 'docs'))
  } else t.comment('no junction on this runtime: not checked here')
  t.absent(fs.existsSync(path.join(folder, '.git', 'hooks', 'pre-commit')), 'no hook written')
})

test('removing a folder: links in it are unlinked, their targets survive; a nested .git stays', async (t) => {
  const { p } = await ide(t)
  const { key, folder } = await p('create', 'Links')
  const outside = tmpDir(t, 'target')
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
  await p('write', key, 'dir/a.txt', 'a')
  fs.mkdirSync(path.join(folder, 'dir', 'sub', '.git'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'dir', 'sub', '.git', 'HEAD'), 'ref')
  let linked = true
  try { fs.symlinkSync(outside, path.join(folder, 'dir', 'link'), 'junction') } catch { linked = false }
  await p('remove', key, 'dir')
  t.absent(fs.existsSync(path.join(folder, 'dir', 'a.txt')), 'its files removed')
  t.ok(fs.existsSync(path.join(folder, 'dir', 'sub', '.git', 'HEAD')), 'a nested .git stays (never synced, never reached)')
  if (linked) {
    t.absent(fs.existsSync(path.join(folder, 'dir', 'link')), 'the junction unlinked')
    t.is(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf-8'), 'keep', 'its target survives')
  } else t.comment('no junction on this runtime: not checked here')
})

test('publish: refused with a broken site.json; versions; visitors get each; roll back', async (t) => {
  t.timeout(180000)
  const { p } = await ide(t)
  const { key: project, folder } = await p('create', 'Page')
  await p('write', project, 'site.json', JSON.stringify({ title: 'My page', entry: 'missing.html' }))
  t.is(await codeOf(p('publish', project)), 'INVALID_MANIFEST', 'an entry that is not there')
  await p('write', project, 'site.json', '{ nope')
  t.is(await codeOf(p('publish', project)), 'INVALID_MANIFEST', 'not JSON')
  t.alike(await p('versions', project), [], 'nothing published')
  await p('write', project, 'site.json', SITE)
  await p('write', project, 'index.html', 'v1')
  fs.mkdirSync(path.join(folder, 'node_modules', 'x'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'node_modules', 'x', 'i.js'), 'dep')
  const first = await p('publish', project)
  t.ok(first.created && first.version === 1, 'the site made, version 1')
  t.is(JSON.parse(fs.readFileSync(path.join(folder, '.hyperbrowser.json'))).site, first.site, 'the project names its site')
  t.is((await p('list'))[0].site, first.site)

  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: first.site })
  const page = (p2) => visitor.rpc.request('site.read', { key: first.site, path: p2, timeout: 5000 }).then((r) => text(r.bytes), (err) => err.code)
  t.is(await page(''), 'v1', 'a visitor reads it')
  t.is(await page('node_modules/x/i.js'), 'NOT_FOUND', 'node_modules not published')
  t.is(await page('.hyperbrowser.json'), 'NOT_FOUND', 'nor the project file')

  await p('write', project, 'index.html', 'v2')
  await p('write', project, 'about.html', 'about')
  t.is((await p('publish', project)).version, 2)
  t.ok(await eventually(async () => (await page('')) === 'v2' && (await page('about.html')) === 'about', 30000), 'version 2 reaches the visitor')
  await p('write', project, 'index.html', 'v3, not published')
  t.is(await page(''), 'v2', 'saving never publishes')

  const back = await p('rollBack', project, 1)
  t.is(back.version, 3, 'a roll back is a new version')
  t.ok(await eventually(async () => (await page('')) === 'v1' && (await page('about.html')) === 'NOT_FOUND', 30000), 'version 1 again for visitors')
  t.alike((await p('versions', project)).map((v) => v.version), [3, 2, 1], 'newest first')
  t.is(await read(p, project, 'index.html'), 'v3, not published', "the project's files are left as they are")
  t.is(await codeOf(p('rollBack', project, 9)), 'NOT_FOUND', 'no such version')
})

test('a hard link that fails: the file is copied', async (t) => {
  const dir = tmpDir(t, 'versions')
  fs.writeFileSync(path.join(dir, 'a'), 'same')
  const fail = () => Promise.reject(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }))
  await linkOrCopy(path.join(dir, 'a'), path.join(dir, 'b'), fail)
  t.is(fs.readFileSync(path.join(dir, 'b'), 'utf-8'), 'same', 'copied')
  fs.writeFileSync(path.join(dir, 'b'), 'changed')
  t.is(fs.readFileSync(path.join(dir, 'a'), 'utf-8'), 'same', 'a copy, not the same file')
  await linkOrCopy(path.join(dir, 'a'), path.join(dir, 'c'))
  t.is(fs.readFileSync(path.join(dir, 'c'), 'utf-8'), 'same', 'linked when it can')
})

test('open a copy of a site; open a folder', async (t) => {
  t.timeout(120000)
  const { p, rpc } = await ide(t)
  const src = siteFolder(t, { manifest: { title: 'Theirs' }, files: { 'index.html': 'theirs', 'img/a.txt': 'pic' } })
  const { key: site } = await rpc.request('site.publish', { folder: src })
  const copy = await p('openCopy', site)
  t.is(copy.name, 'Theirs (copy)')
  t.is(await read(p, copy.key, 'index.html'), 'theirs')
  t.is(await read(p, copy.key, 'img/a.txt'), 'pic')
  const mine = await p('publish', copy.key)
  t.ok(mine.created && mine.site !== site, 'publishing it makes a new site')

  const folder = siteFolder(t, { manifest: { title: 'Cloned' }, files: { 'index.html': 'cloned', 'src/app.js': 'app' } })
  const opened = await p('openFolder', folder)
  t.is(opened.folder, path.resolve(folder), 'the folder itself')
  t.ok((await p('files', opened.key)).some((f) => f.path === 'src/app.js'), 'its files')
  t.is(await codeOf(p('openFolder', folder)), 'EXISTS', 'not twice')
})

test('preview: a draft on this device, its own throwaway space; reset data', async (t) => {
  t.timeout(120000)
  const { p, rpc } = await ide(t)
  const { key: project } = await p('create', 'App')
  await p('write', project, 'site.json', JSON.stringify({ title: 'App', permissions: ['space'], types: { note: { fields: { text: 'text' } } } }))
  await p('write', project, 'index.html', 'draft 1')
  const { key: draft } = await p('preview', project)
  const opened = await rpc.request('site.open', { key: draft })
  t.ok(opened.dynamic, 'opens as the app')
  const page = async () => text((await rpc.request('site.read', { key: draft, path: '' })).bytes)
  t.is(await page(), 'draft 1', 'its files, from the project')
  await p('write', project, 'index.html', 'draft 2')
  t.is(await page(), 'draft 2', 'edits show at once')
  await rpc.request('site.call', { key: draft, method: 'put', args: ['note', { text: 'test data' }] })
  const notes = () => rpc.request('site.call', { key: draft, method: 'query', args: ['note'], chain: [['latest', [10]]] })
  t.is((await notes()).items.length, 1, 'its data, in its own space (no consent asked)')
  t.alike(await p('preview', project), { key: draft }, 'the same draft again')
  t.alike(await p('versions', project), [], 'nothing published')
  const { key: fresh } = await p('resetPreview', project)
  t.not(fresh, draft, 'a new space')
  await rpc.request('site.open', { key: fresh })
  t.is((await rpc.request('site.call', { key: fresh, method: 'query', args: ['note'], chain: [['latest', [10]]] })).items.length, 0, 'empty')
  t.is(await codeOf(rpc.request('site.read', { key: draft, path: '../site.json' })), 'NOT_FOUND', 'paths checked')
})

test('two devices: edits follow, .git and node_modules stay; one file edited on both at once: both kept', async (t) => {
  t.timeout(240000)
  const pc = await ide(t, { deviceName: 'pc' })
  const { key: project, folder: pcFolder } = await pc.p('create', 'Shared')
  await pc.p('write', project, 'a.txt', 'one')
  const { code } = await pc.rpc.request('devices.add')
  const laptop = await engine(t, { init: false })
  await laptop.rpc.request('init', { dir: laptop.dir, bootstrap: await bootstrap(t), joinCode: code, deviceName: 'laptop', joinTimeout: 60000, projects: tmpDir(t, 'laptop-projects') })
  const ide2 = await eventually(() => laptop.rpc.request('site.open', { key: pc.ide, timeout: 30000 }).then(() => true, () => false), 30000)
  t.ok(ide2, 'the IDE opens on the laptop')
  await laptop.rpc.request('site.consent', { key: pc.ide, allow: true }) // answers follow devices; said again for the test
  await laptop.rpc.request('site.permit', { key: pc.ide, permission: 'projects', allow: true })
  const lp = (method, ...args) => laptop.rpc.request('site.call', { key: pc.ide, method: 'projects.' + method, args })
  const there = await eventually(async () => (await lp('list').catch(() => [])).find((x) => x.key === project), 60000)
  t.ok(there, 'the project is on the laptop')
  const lpFolder = there.folder
  t.ok(await eventually(() => disk(path.join(lpFolder, 'a.txt')) === 'one', 60000), 'its file too')

  fs.mkdirSync(path.join(pcFolder, '.git'))
  fs.writeFileSync(path.join(pcFolder, '.git', 'HEAD'), 'ref')
  fs.mkdirSync(path.join(pcFolder, 'node_modules'))
  fs.writeFileSync(path.join(pcFolder, 'node_modules', 'x.js'), 'dep')
  await lp('write', project, 'b.txt', 'from the laptop')
  t.ok(await eventually(() => fs.existsSync(path.join(pcFolder, 'b.txt')), 30000), 'an edit on the laptop shows on the PC')
  t.absent(fs.existsSync(path.join(lpFolder, '.git')) || fs.existsSync(path.join(lpFolder, 'node_modules')), '.git and node_modules never synced')

  await new Promise((resolve) => setTimeout(resolve, 2500))
  fs.writeFileSync(path.join(pcFolder, 'a.txt'), 'pc edit')
  fs.writeFileSync(path.join(lpFolder, 'a.txt'), 'laptop edit')
  const versions = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('a')).sort().map((n) => disk(path.join(dir, n))).sort()
  const both = await eventually(() => {
    const a = versions(pcFolder)
    return a.length === 2 && JSON.stringify(a) === JSON.stringify(versions(lpFolder)) && a
  }, 60000)
  t.alike(both, ['laptop edit', 'pc edit'], 'both versions on both devices: ' + fs.readdirSync(pcFolder))
})

test('co-authors: invite, join, edit, publish; removed: no publish, no new edits', async (t) => {
  t.timeout(240000)
  const alice = await ide(t)
  const { key: project, folder } = await alice.p('create', 'Team site')
  await alice.p('write', project, 'site.json', SITE)
  await alice.p('write', project, 'index.html', 'by alice')
  const { site } = await alice.p('publish', project)
  const { link } = await alice.p('invite', project)

  const bob = await engine(t, { projects: tmpDir(t, 'bob-projects') })
  await bob.rpc.request('site.open', { key: alice.ide })
  await bob.rpc.request('site.consent', { key: alice.ide, allow: true })
  await bob.rpc.request('site.permit', { key: alice.ide, permission: 'projects', allow: true })
  const bp = (method, ...args) => bob.rpc.request('site.call', { key: alice.ide, method: 'projects.' + method, args })
  const joined = await bp('join', link)
  t.is(joined.key, project, 'in the project')
  const bobFolder = joined.folder
  t.ok(await eventually(() => fs.existsSync(path.join(bobFolder, 'index.html')), 60000), 'its files arrive')
  t.ok(await eventually(async () => (await bp('list'))[0]?.site === site, 30000), 'it knows the site')
  const roles = await alice.p('members', project)
  t.ok(roles.some((m) => m.role === 'editor'), 'bob is a co-author (editor): ' + JSON.stringify(roles.map((m) => m.role)))

  await bp('write', project, 'index.html', 'by bob')
  t.ok(await eventually(() => disk(path.join(folder, 'index.html')) === 'by bob', 30000), 'his edit reaches alice')
  const published = await eventually(() => bp('publish', project).catch(() => null), 60000, 1000)
  t.ok(published && published.site === site && !published.created, 'he publishes the same site (an admin of it)')
  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: site })
  t.ok(await eventually(async () => text((await visitor.rpc.request('site.read', { key: site, path: '' })).bytes) === 'by bob', 30000), "visitors get bob's version")

  const { identity: bobId } = await bob.rpc.request('site.call', { key: alice.ide, method: 'info' })
  await alice.p('removeMember', project, bobId)
  t.ok(await eventually(async () => (await codeOf(bp('publish', project))) === 'NOT_ALLOWED', 30000), 'removed: his publish is refused')
  await alice.p('write', project, 'secret.txt', 'after bob left')
  await new Promise((resolve) => setTimeout(resolve, 8000))
  t.absent(fs.existsSync(path.join(bobFolder, 'secret.txt')), "alice's new edits never reach him")
})

// A git index (version 2) naming `entries` ([{ path, size, mtime (s) }]), as git writes it (sorted, NUL-padded to 8).
function gitIndex (entries) {
  const parts = [b4a.from('DIRC'), u32(2), u32(entries.length)]
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const name = b4a.from(e.path)
    const fixed = b4a.alloc(62)
    const v = new DataView(fixed.buffer, fixed.byteOffset, 62)
    v.setUint32(8, e.mtime)
    v.setUint32(24, 0o100644)
    v.setUint32(36, e.size)
    v.setUint16(60, Math.min(name.length, 0xfff))
    const len = Math.ceil((62 + name.length + 1) / 8) * 8
    parts.push(fixed, name, b4a.alloc(len - 62 - name.length))
  }
  return b4a.concat(parts)
}
function u32 (n) {
  const b = b4a.alloc(4)
  new DataView(b.buffer, b.byteOffset, 4).setUint32(0, n)
  return b
}

test('status: the git branch and changed files (read only), devices and co-authors online', async (t) => {
  const { p } = await ide(t)
  const { key, folder } = await p('create', 'Git')
  t.is((await p('status', key)).git, null, 'no .git: null')
  await p('write', key, 'a.txt', 'one')
  await p('write', key, 'b.txt', 'two')
  fs.mkdirSync(path.join(folder, '.git'))
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  fs.writeFileSync(path.join(folder, '.gitignore'), 'tmp/\n')
  const st = (f) => { const s = fs.statSync(path.join(folder, f)); return { path: f, size: s.size, mtime: Math.floor(s.mtimeMs / 1000) } }
  fs.writeFileSync(path.join(folder, '.git', 'index'), gitIndex([st('a.txt'), st('b.txt'), st('.swarmfsignore'), st('.gitignore')]))
  await p('write', key, 'tmp/scratch.txt', 'x')
  let s = await p('status', key)
  t.is(s.git.branch, 'main')
  t.alike(s.git.changed, [], 'nothing changed; .gitignore\'d files not listed')
  await p('write', key, 'a.txt', 'one, longer')
  await p('remove', key, 'b.txt')
  await p('write', key, 'c.txt', 'new')
  s = await p('status', key)
  t.alike(s.git.changed, [{ path: 'a.txt', state: 'modified' }, { path: 'b.txt', state: 'deleted' }, { path: 'c.txt', state: 'new' }])
  t.is(s.devices, 0, 'no other device online')
  t.is(s.coauthors, 0, 'no co-author online')
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), '0123456789abcdef\n')
  t.is((await p('status', key)).git.branch, '0123456 (detached)')
})

test('leave a project (its folder kept) or delete it (its synced files gone, .git kept); a files event', async (t) => {
  t.timeout(60000)
  const e = await ide(t)
  const { p } = e
  const kept = await p('create', 'Kept')
  await p('write', kept.key, 'a.txt', 'a')
  const changes = []
  const stop = siteApi(e, e.ide).projects.on((d) => changes.push(d))
  await p('write', kept.key, 'b.txt', 'b')
  t.ok(await eventually(() => changes.some((c) => c.project === kept.key), 15000), 'an event names the project whose files changed')
  stop()
  await p('leave', kept.key)
  t.alike((await p('list')).map((x) => x.key), [], 'off the list')
  t.is(fs.readFileSync(path.join(kept.folder, 'a.txt'), 'utf-8'), 'a', 'its folder kept')
  t.is(await codeOf(p('files', kept.key)), 'NOT_FOUND', 'no longer reachable')

  const gone = await p('create', 'Gone')
  await p('write', gone.key, 'src/a.js', 'a')
  fs.mkdirSync(path.join(gone.folder, '.git'))
  fs.writeFileSync(path.join(gone.folder, '.git', 'HEAD'), 'ref')
  await p('leave', gone.key, { deleteFiles: true })
  t.absent(fs.existsSync(path.join(gone.folder, 'src')), 'its files deleted')
  t.ok(fs.existsSync(path.join(gone.folder, '.git', 'HEAD')), '.git never touched')
})

test('spec 026: folders listed on request (a file tree), mkdir, refused where a page may not reach', async (t) => {
  const { p } = await ide(t)
  const { key } = await p('create', 'Tree')
  await p('mkdir', key, 'empty/inside')
  await p('write', key, 'src/a.js', 'a')
  t.alike((await p('files', key)).map((f) => f.path).sort(), ['.swarmfsignore', 'src/a.js'], 'files only, as before')
  t.alike((await p('files', key, { folders: true })).filter((f) => f.folder).map((f) => f.path).sort(), ['empty', 'empty/inside', 'src'], 'and the folders, empty ones too')
  t.is(await codeOf(p('mkdir', key, 'src')), 'EXISTS')
  t.is(await codeOf(p('mkdir', key, '.git/hooks')), 'NOT_ALLOWED', 'never into .git')
  t.is(await codeOf(p('mkdir', key, '../out')), 'INVALID_PATH')
})
