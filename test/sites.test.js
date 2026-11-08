// Publishing a folder and opening it by key (spec 001 US1, US2; FR-006..008; SC-001, SC-006).
import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { engine, siteFolder, codeOf, eventually, text } from './helpers.js'

test('site.json is checked before anything is made', async (t) => {
  const e = await engine(t)
  const bad = async (opts) => {
    try {
      await e.rpc.request('site.publish', { folder: siteFolder(t, opts) })
      return null
    } catch (err) {
      return err.code + ': ' + err.message
    }
  }
  t.ok((await bad({ manifest: null })).startsWith('NO_MANIFEST'))
  t.ok((await bad({ manifest: '{ nope' })).startsWith('INVALID_MANIFEST'))
  t.ok((await bad({ manifest: [] })).startsWith('INVALID_MANIFEST'))
  t.ok((await bad({ manifest: { title: '' } })).includes('title'))
  t.ok((await bad({ manifest: { title: 'x', entry: '../up.html' } })).includes('entry'))
  t.ok((await bad({ manifest: { title: 'x', entry: 'missing.html' } })).includes('missing.html'))
  t.ok((await bad({ manifest: { title: 'x', permissions: 'space' } })).includes('permissions'))
  t.ok((await bad({ manifest: { title: 'x', public: 'no' } })).includes('public'))
  t.ok((await bad({ manifest: { title: 'x', types: [] } })).includes('types'))
  t.ok((await bad({ manifest: { title: 'x', types: { profile: { fields: { x: 'string' } } } } })).startsWith('INVALID_TYPE'), "SwarmFS's own type names are refused")
  t.is(await codeOf(e.rpc.request('site.publish', { folder: path.join(e.dir, 'no-such-folder') })), 'NO_MANIFEST')
})

test('publish, publish again: same key; a second engine opens it from the key alone', async (t) => {
  const owner = await engine(t)
  const visitor = await engine(t)
  const folder = siteFolder(t, {
    manifest: { title: 'Docs', entry: 'index.html', icon: 'icon.png', permissions: ['space', 'future-thing'] },
    files: { 'index.html': '<link rel=stylesheet href=style.css><h1>Docs</h1>', 'style.css': 'h1{}', 'icon.png': 'png', 'a/b.html': 'deep' }
  })

  const first = await owner.rpc.request('site.publish', { folder })
  t.is(first.created, true)
  t.is(first.key.length, 52)
  const again = await owner.rpc.request('site.publish', { folder })
  t.is(again.key, first.key, 'same folder, same site')
  t.is(again.created, false)

  const opened = await visitor.rpc.request('site.open', { key: first.key })
  t.is(opened.key, first.key)
  t.alike(opened.manifest, { title: 'Docs', entry: 'index.html', icon: 'icon.png', permissions: ['space', 'future-thing'] })
  t.is(opened.dynamic, true)

  const entry = await visitor.rpc.request('site.read', { key: first.key, path: '' })
  t.is(entry.path, 'index.html')
  t.is(text(entry.bytes), fs.readFileSync(path.join(folder, 'index.html'), 'utf-8'))
  t.is(text((await visitor.rpc.request('site.read', { key: first.key, path: 'style.css' })).bytes), 'h1{}')
  t.is(text((await visitor.rpc.request('site.read', { key: first.key, path: 'a/b.html' })).bytes), 'deep')
  t.is(text((await visitor.rpc.request('site.read', { key: first.key, path: '/a/b.html' })).bytes), 'deep', 'a leading slash is the root')

  for (const p of ['nope.html', '../x', 'a/../index.html', '%2e%2e/x', 'a\\b.html', 'a//b.html', 'a/b.html\0', '.']) {
    t.is(await codeOf(visitor.rpc.request('site.read', { key: first.key, path: p, timeout: 500 })), 'NOT_FOUND', p)
  }

  // the owner's edit reaches the visitor (SwarmFS's linked folder, synced by the engine)
  fs.writeFileSync(path.join(folder, 'style.css'), 'h1{color:red}')
  t.ok(await eventually(async () => text((await visitor.rpc.request('site.read', { key: first.key, path: 'style.css' })).bytes) === 'h1{color:red}', 20000, 250))
})

test('a static site, a site not opened, a key nobody has', async (t) => {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t) })
  const visitor = await engine(t)
  t.is(await codeOf(visitor.rpc.request('site.read', { key, path: '' })), 'NOT_FOUND', 'open it first')
  const opened = await visitor.rpc.request('site.open', { key })
  t.is(opened.dynamic, false)
  t.alike(opened.manifest, { title: 'Test site', entry: 'index.html', permissions: [] })
  const nobody = 'y'.repeat(52)
  t.ok(await codeOf(visitor.rpc.request('site.open', { key: nobody, timeout: 2000 })), 'refused, not a hang')
})

test('site.state: complete and peers, for the shell toolbar (spec 002 FR-006)', async (t) => {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t) })
  const visitor = await engine(t)
  t.is(await codeOf(visitor.rpc.request('site.state', { key })), 'NOT_FOUND', 'open it first')
  t.is(await codeOf(visitor.rpc.request('site.state', { key: 'nope' })), 'INVALID_KEY')
  await visitor.rpc.request('site.open', { key })
  const state = await visitor.rpc.request('site.state', { key })
  t.is(typeof state.complete, 'boolean')
  t.ok(await eventually(async () => (await visitor.rpc.request('site.state', { key })).peers >= 1, 20000, 250), 'the owner is a peer')
  t.ok(await eventually(async () => (await visitor.rpc.request('site.state', { key })).complete, 20000, 250), 'complete once synced')
  await owner.rpc.request('site.open', { key })
  t.is((await owner.rpc.request('site.state', { key })).complete, true, "the owner's own site")
})

test('site.keep and site.held: install a site, the bytes held here (spec 003; SwarmFS F4, F5)', async (t) => {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: siteFolder(t, { files: { 'index.html': '<h1>hi</h1>', 'a.html': 'aaaa' } }) })
  const visitor = await engine(t)
  t.is(await codeOf(visitor.rpc.request('site.held', { key })), 'NOT_FOUND', 'open it first')
  t.is(await codeOf(visitor.rpc.request('site.keep', { key, keep: true })), 'NOT_FOUND', 'open it first')
  await visitor.rpc.request('site.open', { key })
  t.is(await codeOf(visitor.rpc.request('site.keep', { key, keep: 'yes' })), 'INVALID_PARAMS')

  const before = await visitor.rpc.request('site.held', { key })
  t.is(before.kept, false, 'a visited site is not installed')
  t.is(typeof before.bytes, 'number')
  t.alike(await visitor.rpc.request('site.keep', { key, keep: true }), { kept: true })
  const installed = await visitor.rpc.request('site.held', { key })
  t.is(installed.kept, true)
  t.ok(await eventually(async () => (await visitor.rpc.request('site.held', { key })).bytes >= 'aaaa'.length + '<h1>hi</h1>'.length, 20000, 250), 'every page held')
  t.alike(await visitor.rpc.request('site.keep', { key, keep: false }), { kept: false })
  t.is((await visitor.rpc.request('site.held', { key })).kept, false, 'handed back to the cache')
})

// Tibo's forum (2026-11-08): its folder was first published invite-only; a later site.json without "public": false
// reused that site silently, so nobody could load the app. Now it's refused, and --new (fresh) makes a public site.
test('an invite-only site is never made public by a republish; fresh makes a new public site', async (t) => {
  const owner = await engine(t)
  const folder = siteFolder(t, { manifest: { title: 'Forum', public: false } })
  const { key: old } = await owner.rpc.request('site.publish', { folder })
  fs.writeFileSync(path.join(folder, 'site.json'), JSON.stringify({ title: 'Forum' }))
  t.is(await codeOf(owner.rpc.request('site.publish', { folder })), 'PRIVATE_SITE', 'refused: public is never implied')

  const { key, created } = await owner.rpc.request('site.publish', { folder, fresh: true })
  t.ok(created && key !== old, 'a new site, a new key')
  const visitor = await engine(t)
  const opened = await visitor.rpc.request('site.open', { key })
  t.is(opened.manifest.title, 'Forum', 'a stranger opens it: it is public')
  const again = await owner.rpc.request('site.publish', { folder })
  t.is(again.key, key, 'the folder now publishes to the new site')
})
