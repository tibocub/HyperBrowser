// The IDE through its own code (sites/ide/lib/site.js) on window.hyper as the page gets it: a beginner's
// HyperMD site, a developer's copy of Chat, two co-authors.
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, siteApi, tmpDir, eventually, text } from './helpers.js'
import * as ide from '../sites/ide/lib/site.js'
import { nest } from '../sites/ide/lib/tree.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// An engine with the IDE (sites/ide) published and allowed: { e, hyper, projects }.
async function withIde (t, opts = {}) {
  const e = await engine(t, { projects: tmpDir(t, 'projects'), ...opts })
  const { key } = await e.rpc.request('site.publish', { folder: path.join(ROOT, 'sites', 'ide') })
  return { e, ...(await allow(e, key)) }
}

async function allow (e, key) {
  await e.rpc.request('site.open', { key, timeout: 30000 })
  await e.rpc.request('site.consent', { key, allow: true })
  await e.rpc.request('site.permit', { key, permission: 'projects', allow: true })
  const hyper = siteApi(e, key)
  return { ide: key, hyper, projects: hyper.projects }
}

const page = (e, key, p) => e.rpc.request('site.read', { key, path: p, timeout: 5000 }).then((r) => text(r.bytes), (err) => err.code)

test('HyperMD in the page: pages built with a menu and the layout; links to .hmd become .html', async (t) => {
  const out = ide.buildPages({
    '_layout.hmd': '::menu\n\n::content\n',
    'index.hmd': '::page{order=1}\n\n# Home\n\nSee [about](about.hmd).',
    'about.hmd': '::page{order=2}\n\n# About me\n\n![me](images/me.png)',
    'docs/deep.hmd': '# Deep\n\n[home](/index.hmd)'
  }, ['style.css'])
  t.alike(Object.keys(out).sort(), ['about.html', 'docs/deep.html', 'index.html'], '_layout is not a page')
  t.ok(out['index.html'].includes('href="about.html"'), 'a link to a page')
  t.ok(out['index.html'].includes('About me') && out['about.html'].includes('Home'), 'every page lists the others (the menu)')
  t.ok(out['docs/deep.html'].includes('href="../index.html"') && out['docs/deep.html'].includes('../style.css'), 'a deeper page: relative links and the root style')
  t.ok(out['about.html'].includes('src="images/me.png"'), 'pictures')
})

test('FR-001: a beginner makes a HyperMD site with a title, an icon and two pages, and publishes it', async (t) => {
  t.timeout(120000)
  const { projects } = await withIde(t)
  const p = await ide.create(projects, 'My corner', 'hypermd')
  t.alike((await ide.pages(projects, p.key)).map((x) => x.title), ['My corner'], 'one page, by its title')
  await ide.setManifest(projects, p.key, { title: 'Ann’s corner' })
  await ide.setIcon(projects, p.key, 'me.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  const about = await ide.addPage(projects, p.key, 'About me')
  await ide.save(projects, p.key, about, '::page{order=2}\n\n# About me\n\nI make **sites**.\n')
  t.alike((await ide.pages(projects, p.key)).map((x) => x.title), ['My corner', 'About me'], 'two pages, by their titles')
  const { site, created } = await ide.publish(projects, p.key)
  t.ok(created, 'published')

  const visitor = await engine(t)
  const opened = await visitor.rpc.request('site.open', { key: site, timeout: 30000 })
  t.is(opened.manifest.title, 'Ann’s corner', 'its title')
  t.is(opened.manifest.icon, 'icon.png', 'its icon')
  const home = await page(visitor, site, '')
  t.ok(home.includes('My corner') && home.includes('href="about-me.html"'), 'the home page, its menu naming the second page')
  t.ok((await page(visitor, site, 'about-me.html')).includes('<strong class="hmd-Strong">sites</strong>'), 'the second page')
  t.is((await page(visitor, site, 'icon.png')).length, 8, 'the icon is a page of the site')
  t.is(await ide.setManifest(projects, p.key, { entry: 'nowhere.html' }).catch((err) => err.code), 'INVALID_MANIFEST', 'a broken site.json is never written')
})

test('FR-002: a developer opens a copy of Chat, changes its JS, previews it on a throwaway space, publishes, rolls back', async (t) => {
  t.timeout(180000)
  const { e, projects } = await withIde(t)
  const { key: chat } = await e.rpc.request('site.publish', { folder: path.join(ROOT, 'sites', 'chat') })
  const copy = await projects.openCopy(chat)
  const js = await ide.read(projects, copy.key, 'app.js')
  t.ok(js.length > 100, "Chat's app.js in the copy")
  await ide.save(projects, copy.key, 'app.js', '// mine\n' + js)

  const { key: draft } = await projects.preview(copy.key)
  await e.rpc.request('site.open', { key: draft })
  t.ok((await page(e, draft, 'app.js')).startsWith('// mine'), 'the preview runs the change')
  await e.rpc.request('site.call', { key: draft, method: 'put', args: ['message', { text: 'test' }] })
  const { key: fresh } = await projects.resetPreview(copy.key)
  await e.rpc.request('site.open', { key: fresh })
  t.is((await e.rpc.request('site.call', { key: fresh, method: 'query', args: ['message'], chain: [['latest', [5]]] })).items.length, 0, 'Reset data: an empty space')

  const first = await ide.publish(projects, copy.key)
  t.ok(first.created && first.site !== chat, 'published as their own site')
  await ide.save(projects, copy.key, 'app.js', '// mine, v2\n' + js)
  t.is((await ide.publish(projects, copy.key)).version, 2)
  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: first.site, timeout: 30000 })
  t.ok(await eventually(async () => (await page(visitor, first.site, 'app.js')).startsWith('// mine, v2'), 30000), 'version 2 for visitors')
  await projects.rollBack(copy.key, 1)
  t.ok(await eventually(async () => (await page(visitor, first.site, 'app.js')).startsWith('// mine\n'), 30000), 'rolled back to version 1')
})

test('FR-003: two people co-author one project: both edit, either publishes', async (t) => {
  t.timeout(240000)
  const alice = await withIde(t)
  const p = await ide.create(alice.projects, 'Together', 'hypermd')
  const { site } = await ide.publish(alice.projects, p.key)
  const { link } = await alice.projects.invite(p.key)

  const bobEngine = await engine(t, { projects: tmpDir(t, 'bob') })
  const bob = await allow(bobEngine, alice.ide)
  const joined = await bob.projects.join(link)
  t.is(joined.key, p.key)
  t.ok(await eventually(async () => (await ide.paths(bob.projects, p.key).catch(() => [])).includes('index.hmd'), 60000), 'bob has the files')
  const page2 = await ide.addPage(bob.projects, p.key, 'By Bob')
  t.ok(await eventually(async () => (await ide.paths(alice.projects, p.key)).includes(page2), 30000), "bob's page reaches alice")
  await ide.save(alice.projects, p.key, 'index.hmd', '::page{order=1}\n\n# Together\n\nEdited by Alice.\n')
  t.ok(await eventually(async () => (await ide.read(bob.projects, p.key, 'index.hmd').catch(() => '')).includes('Alice'), 30000), "alice's edit reaches bob")

  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: site, timeout: 30000 })
  const byBob = await eventually(() => ide.publish(bob.projects, p.key).catch(() => null), 60000, 1000)
  t.ok(byBob && byBob.site === site, 'bob publishes the same site')
  t.ok(await eventually(async () => (await page(visitor, site, '')).includes('Edited by Alice') && (await page(visitor, site, 'by-bob.html')).includes('By Bob'), 30000), 'visitors get both edits')
  await ide.save(alice.projects, p.key, 'by-bob.hmd', '::page{order=2}\n\n# By Bob\n\nAnd Alice.\n')
  t.ok((await ide.publish(alice.projects, p.key)).version > 1, 'alice publishes too')
  t.ok(await eventually(async () => (await page(visitor, site, 'by-bob.html')).includes('And Alice'), 30000), 'her version for visitors')
})

test('spec 026 B1: sites/home (HyperMD, entry index.html) previews and publishes as a project', async (t) => {
  t.timeout(120000)
  const { e, projects } = await withIde(t)
  const folder = path.join(tmpDir(t, 'home'), 'home')
  fs.cpSync(path.join(ROOT, 'sites', 'home'), folder, { recursive: true })
  const p = await projects.openFolder(folder)
  t.is(await projects.preview(p.key).catch((err) => err.code), 'INVALID_MANIFEST', 'without the build: index.html is not there yet')
  const { key: draft } = await ide.preview(projects, p.key)
  const opened = await e.rpc.request('site.open', { key: draft })
  t.is(opened.manifest.entry, 'index.html')
  const home = await page(e, draft, '')
  t.ok(home.includes('<html') && home.includes('hmd-'), 'the preview shows the home page, built')
  t.ok((await page(e, draft, 'start.html')).includes('hmd-'), 'and every other page, not only the open one')
  t.alike(fs.readdirSync(folder).filter((n) => n.endsWith('.html')), [], 'nothing built into the folder itself (spec 026)')
  const { site } = await ide.publish(projects, p.key)
  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: site, timeout: 30000 })
  t.ok((await page(visitor, site, 'news.html')).includes('hmd-'), 'published, every page')
})

test('spec 026: the file tree nests paths: folders first, then by name; implied and empty folders', async (t) => {
  const tree = nest([{ path: 'b.txt' }, { path: 'src/z.js' }, { path: 'src/lib/a.js' }, { path: 'empty', folder: true }, { path: 'a.txt' }])
  const names = (list) => list.map((n) => n.name + (n.folder ? '/' : ''))
  t.alike(names(tree), ['empty/', 'src/', 'a.txt', 'b.txt'])
  const src = tree.find((n) => n.name === 'src')
  t.alike(names(src.children), ['lib/', 'z.js'])
  t.is(src.children[0].children[0].path, 'src/lib/a.js', 'paths kept whole')
  t.alike(tree.find((n) => n.name === 'empty').children, [], 'an empty folder')
})

test('spec 026: built pages live outside the project; a hand-written .html wins; the IDE’s old ones are cleaned up', async (t) => {
  t.timeout(120000)
  const { e, projects } = await withIde(t)
  const p = await ide.create(projects, 'Mine', 'hypermd')
  t.absent((await ide.paths(projects, p.key)).some((x) => x.endsWith('.html')), 'no .html in the project after a build')
  const sources = { '_layout.hmd': await ide.read(projects, p.key, '_layout.hmd'), 'index.hmd': await ide.read(projects, p.key, 'index.hmd') }
  await projects.write(p.key, 'index.html', ide.buildPages(sources)['index.html']) // what an older IDE wrote beside its page
  t.alike((await ide.build(projects, p.key)).hidden, [], 'an .html exactly as the build makes it: the IDE’s own')
  t.absent((await ide.paths(projects, p.key)).includes('index.html'), 'removed')
  await projects.write(p.key, 'index.html', '<p>written by hand</p>')
  t.alike((await ide.build(projects, p.key)).hidden, ['index.html'], 'any other: the person’s, said to hide the page')
  t.is(await ide.read(projects, p.key, 'index.html'), '<p>written by hand</p>', 'never deleted')
  const { key: draft } = await ide.preview(projects, p.key)
  await e.rpc.request('site.open', { key: draft })
  t.is(await page(e, draft, ''), '<p>written by hand</p>', 'the preview: the hand-written page wins')
  const { site, hidden } = await ide.publish(projects, p.key)
  t.alike(hidden, ['index.html'])
  const visitor = await engine(t)
  await visitor.rpc.request('site.open', { key: site, timeout: 30000 })
  t.is(await page(visitor, site, ''), '<p>written by hand</p>', 'published: the hand-written page wins')
  await projects.remove(p.key, 'index.html')
  await ide.publish(projects, p.key)
  t.ok(await eventually(async () => (await page(visitor, site, '')).includes('hmd-'), 30000), 'removed: the built page again')
  t.is(await projects.build(p.key, { '../x.html': '' }).catch((err) => err.code), 'INVALID_PATH', 'built pages stay in the site')
  t.is(await projects.build(p.key, { 'x.js': '' }).catch((err) => err.code), 'INVALID_PATH', '.html only')
})
