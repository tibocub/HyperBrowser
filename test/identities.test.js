import test from 'brittle'
import fs from 'fs'
import path from 'path'
import { SwarmFS } from 'swarmfs'
import { engine, siteFolder, tmpDir, bootstrap } from './helpers.js'

// shell/identities.js is the Electron shell's (Node's crypto); the engines it points at are tested on Bare everywhere else
const BARE = typeof Bare !== 'undefined'
const { identities } = BARE ? /** @type {any} */ ({}) : await import('../shell/identities.js')
if (BARE) test('identities: skipped on Bare (the list is the Electron shell one)', (t) => t.pass('skipped on Bare'))

const CHAT = { manifest: { title: 'Chat', permissions: ['space', 'contacts'], types: { message: { fields: { text: 'text' } } } } }

if (!BARE) {
/** One engine at a time on an identity's folder, as the shell runs them; closed before the next. */
  async function opened (t, dir, chat, net) {
    const e = await engine(t, { dir, bootstrap: net })
    await e.rpc.request('apps.set', { chat })
    await e.rpc.request('site.open', { key: chat })
    await e.rpc.request('site.consent', { key: chat, allow: true })
    await e.rpc.request('site.permit', { key: chat, permission: 'contacts', allow: true })
    const c = (method, ...args) => e.rpc.request('site.call', { key: chat, method: 'contacts.' + method, args })
    return { ...e, c, close: () => e.rpc.request('close') }
  }

  test('an install from before identities: its engine folder is Main, the same identity', async (t) => {
    t.timeout(120000)
    const home = tmpDir(t, 'home')
    const net = await bootstrap(t)
    const old = await engine(t, { dir: path.join(home, 'engine'), bootstrap: net })
    const { identity } = await old.rpc.request('devices.list')
    await old.rpc.request('close')

    const ids = identities(home)
    t.alike(ids.list().map((i) => i.name), ['Main'])
    const main = ids.current()
    t.is(main.dir, path.join(home, 'engine'), 'nothing moved')
    t.is(main.shell, path.join(home, 'shell.json'), 'its desktop where it was')
    t.is(main.prefix, '', 'its site sessions where they were')
    t.ok(fs.existsSync(path.join(home, 'identities.json')), 'the list is written at once: Main keeps its id')
    t.is(identities(home).current().id, main.id)
    const again = await engine(t, { dir: main.dir, bootstrap: net })
    t.is((await again.rpc.request('devices.list')).identity, identity)
  })

  test('the list: names checked, the open one never deleted, a broken list never read as empty', async (t) => {
    const home = tmpDir(t, 'home')
    const ids = identities(home)
    const work = ids.create(' Work ')
    t.ok(/^[0-9a-f]{16}$/.test(work), 'a random id')
    t.is(ids.get(work).name, 'Work')
    t.exception(() => ids.create('work'), /Another identity has that name/)
    t.exception(() => ids.create('  '), /A name of 1 to 64/)
    t.exception(() => ids.create('x'.repeat(65)), /A name of 1 to 64/)
    ids.rename(work, 'Job')
    t.is(identities(home).get(work).name, 'Job', 'saved')
    t.exception(() => ids.remove(ids.current().id), /this one is open/)
    ids.use(work)
    t.is(identities(home).current().id, work)
    fs.writeFileSync(path.join(home, 'identities.json'), '{ broken')
    t.exception(() => identities(home), 'throws: starting with Main alone would hide the others')
  })

  test('two identities share no key, space or contact; deleting one leaves the other', async (t) => {
    t.timeout(240000)
    const home = tmpDir(t, 'home')
    const net = await bootstrap(t)
    const owner = await engine(t, { bootstrap: net })
    const { key: chat } = await owner.rpc.request('site.publish', { folder: siteFolder(t, CHAT) })
    const someone = await opened(t, tmpDir(t, 'someone'), chat, net)
    const stranger = (await someone.c('me')).identity

    const ids = identities(home)
    const a = ids.current()
    const b = ids.get(ids.create('Work'))

    const A = await opened(t, a.dir, chat, net)
    const aKeys = await A.rpc.request('devices.list')
    await A.rpc.request('site.publish', { folder: siteFolder(t, { manifest: { title: 'Mine' } }) })
    await A.c('setMe', { name: 'Ann', findable: false })
    await A.c('request', stranger, 'Someone')
    t.is((await A.c('list')).length, 1, 'A has a contact')
    const aHosts = (await A.rpc.request('hosting')).sites
    await A.close()

    ids.use(b.id)
    const B = await opened(t, b.dir, chat, net)
    const bKeys = await B.rpc.request('devices.list')
    t.not(bKeys.identity, aKeys.identity, 'identity keys differ')
    t.not(bKeys.devices[0].publicKey, aKeys.devices[0].publicKey, 'device keys differ')
    t.alike(await B.c('list'), [], "A's contact isn't under B")
    t.not((await B.c('me')).name, 'Ann', "nor A's name")
    t.is((await B.rpc.request('hosting')).sites, 1, 'B holds only the Chat it opened')
    t.ok(aHosts > 1, 'A held its site too')
    await B.close()

    // the swarm key pair is the device's in hypergraph; checked on the folders themselves
    const swarmKey = async (dir) => {
      const sfs = await SwarmFS.open(dir, { bootstrap: net })
      const k = sfs.hg._network.keyPair.publicKey.toString('hex') // private: no public getter for the swarm's key pair
      await sfs.close()
      return k
    }
    t.not(await swarmKey(a.dir), await swarmKey(b.dir), 'swarm key pairs differ')

    ids.use(a.id)
    const gone = ids.remove(b.id)
    t.absent(fs.existsSync(b.dir), "B's folder is gone")
    t.is(gone.prefix, b.id + '-', 'the caller clears these sessions')
    t.alike(ids.list().map((i) => i.id), [a.id])
    const A2 = await opened(t, a.dir, chat, net)
    t.is((await A2.rpc.request('devices.list')).identity, aKeys.identity, 'A intact')
    t.is((await A2.c('list')).length, 1, 'with its contact')
  })

  test('delete refuses any folder but one closed engine folder, and deletes nothing then', async (t) => {
    const root = tmpDir(t, 'root')
    const home = path.join(root, 'data')
    const ids = identities(home)
    const open = ids.current()
    fs.mkdirSync(path.join(open.dir, 'cores'), { recursive: true })
    const engineAt = (dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'instance.json'), '{}') }
    fs.mkdirSync(path.join(root, 'x'))
    fs.writeFileSync(path.join(root, 'x', 'keep.txt'), 'mine')
    fs.mkdirSync(path.join(home, 'plain'))
    fs.writeFileSync(path.join(home, 'plain', 'keep.txt'), 'mine')
    engineAt(path.join(home, 'nest', 'inner'))
    engineAt(path.join(home, 'nest'))
    engineAt(path.join(root, 'outside'))
    const list = JSON.parse(fs.readFileSync(path.join(home, 'identities.json'), 'utf-8'))
    const bad = { '.': 'the data folder', '..': 'a parent', '../x': '../x, not an engine folder', plain: 'not an engine folder', nest: "holding another identity's folder" }
    for (const [dir, name] of Object.entries(bad)) list.list.push({ id: Buffer.from(dir.padEnd(8, '_')).toString('hex').slice(0, 16), name, dir })
    list.list.push({ id: 'aaaaaaaaaaaaaaaa', name: 'inner', dir: 'nest/inner' })
    list.list.push({ id: 'bbbbbbbbbbbbbbbb', name: 'outside', dir: '../outside' })
    fs.writeFileSync(path.join(home, 'identities.json'), JSON.stringify(list))
    const again = identities(home)
    for (const i of again.list().filter((i) => Object.values(bad).includes(i.name))) {
      t.exception(() => again.remove(i.id), /Not deleted/, 'refused: ' + i.name)
    }
    t.ok(fs.existsSync(path.join(root, 'x', 'keep.txt')) && fs.existsSync(path.join(home, 'plain', 'keep.txt')), 'nothing deleted')
    t.ok(fs.existsSync(path.join(home, 'identities.json')) && fs.existsSync(path.join(open.dir, 'cores')) && fs.existsSync(path.join(home, 'nest', 'inner', 'instance.json')))
    t.is(again.list().length, 8, 'all still listed')
    again.remove('aaaaaaaaaaaaaaaa')
    t.absent(fs.existsSync(path.join(home, 'nest', 'inner')), 'an engine folder is deleted')
    again.remove('bbbbbbbbbbbbbbbb')
    t.absent(fs.existsSync(path.join(root, 'outside')), 'outside the data folder too (Main by --dir), being an engine folder')
    const fresh = again.create('Never opened')
    again.remove(fresh)
    t.absent(again.list().some((i) => i.id === fresh), 'one never opened has no folder: just unlisted')
  })

  test('sweep: session folders of deleted identities only', async (t) => {
    const home = tmpDir(t, 'home')
    const parts = tmpDir(t, 'parts')
    const ids = identities(home)
    const kept = ids.get(ids.create('Kept'))
    const lost = 'aaaaaaaaaaaaaaaa'
    const mk = (name) => { fs.mkdirSync(path.join(parts, name)); return path.join(parts, name) }
    const keep = [mk('site-x'), mk(kept.prefix + 'site-x'), mk('other'), mk('bbbbbbbbbbbbbbbb-site-x')]
    fs.mkdirSync(path.join(home, 'identity-bbbbbbbbbbbbbbbb')) // a folder of its own: never swept, listed or not
    const swept = mk(lost + '-site-x')
    ids.sweep(parts)
    t.absent(fs.existsSync(swept))
    for (const k of keep) t.ok(fs.existsSync(k), path.basename(k))
  })
}
