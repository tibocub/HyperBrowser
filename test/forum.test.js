// The official forum (spec 006): sites/forum's own code (lib/) on the site API, on an instance of the forum app
// (spec 009), engines on a local DHT playing the flows: create, invite, join, boards, post, reply, vote, edit, delete, moderate, sorting, unread, mentions,
// names and icons. Node and Bare.
import test from 'brittle'
import path from 'path'
import { fileURLToPath } from 'url'
import { engine, siteApi, codeOf, eventually, text } from './helpers.js'
import { forum, people } from '../sites/forum/lib/forum.js'
import { summarize, sortThreads, tree, visible, tally, score, voteOf, nextVote, unread, staleRead, boardTree } from '../sites/forum/lib/view.js'
import { render, mentioned, toStored, toDraft } from '../sites/forum/lib/text.js'
import * as icon from '../sites/forum/lib/icon.js'

const FORUM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sites', 'forum')
const WAIT = 20000

// `key`: the forum app; `inst`: the forum (an instance of it) the lib works on.
async function allowed (e, key, inst) {
  await e.rpc.request('site.consent', { key, allow: true })
  return forum(siteApi(e, key).instance(inst))
}

// The owner publishes the forum app as it is in the repo, and makes a forum with it (invite-only).
async function published (t) {
  const owner = await engine(t)
  const { key } = await owner.rpc.request('site.publish', { folder: FORUM })
  await owner.rpc.request('site.open', { key })
  await owner.rpc.request('site.consent', { key, allow: true })
  const { key: inst } = await siteApi(owner, key).instances.create('Test forum')
  return { owner, key, inst, a: await allowed(owner, key, inst) }
}

// A newcomer with an invite from `by`, pasted as HyperBrowser's address field would (site.open of the link).
async function invited (t, by, key, inst, role = 'member') {
  const e = await engine(t)
  const link = await by.invite({ role })
  const o = await e.rpc.request('site.open', { key: link })
  t.alike([o.key, o.instance], [key, inst], 'in with the invite: the forum app, on that forum')
  return { e, f: await allowed(e, key, inst) }
}

const items = async (f, type, filters = []) => {
  let q = f.hyper.query(type)
  for (const [k, ...a] of filters) q = q[k](...a)
  return (await q.latest(500)).items
}
const has = (f, type, id) => eventually(async () => (await items(f, type)).some((r) => r.id === id), WAIT)

test('invite-only; boards by admins, sub-boards; threads seen by every member, live (US1, US3.1-2)', async (t) => {
  const { owner, key, inst, a } = await published(t)
  const opened = await owner.rpc.request('site.open', { key })
  t.is(opened.dynamic, true)
  t.is(opened.manifest.public, undefined, 'the app is public: its code loads for everyone')

  const stranger = await engine(t)
  t.ok(await codeOf(stranger.rpc.request('site.open', { key: inst, timeout: 3000 })), 'the forum is invite-only: no invite, no way in')

  const { e: be, f: b } = await invited(t, a, key, inst)
  t.ok(text((await be.rpc.request('site.read', { key, path: '' })).bytes).includes('app.js'), 'the forum\'s pages reach the member')
  t.is((await b.me()).role, 'member')

  const start = await a.makeBoard({ name: 'Getting started', about: 'First steps', order: 1 })
  const windows = await a.makeBoard({ name: 'Windows', parent: start.id })
  t.is(await codeOf(b.makeBoard({ name: 'Mine' })), 'NOT_ALLOWED', 'a member makes no board')
  t.is(await codeOf(a.makeBoard({ name: ' ' })), 'INVALID_INPUT')
  t.ok(await has(b, 'board', windows.id), 'the member sees the boards')
  const shape = boardTree(await items(b, 'board'))
  t.alike(shape.map((x) => [x.board.name, x.subs.map((s) => s.name)]), [['Getting started', ['Windows']]], 'Windows is inside Getting started')

  // a live view of threads on the owner's side gets the member's thread (SC-002)
  let seen = []
  const stop = a.hyper.query('thread').live(({ items }) => { seen = items }, { limit: 50 })
  const th = await b.post(start.id, { title: 'How do I open a site?', text: 'From its **key**?' })
  t.ok(await eventually(() => seen.some((x) => x.id === th.id), WAIT), 'the owner\'s open page shows it without reloading')
  stop()
  t.is(await codeOf(b.post(start.id, { title: '' })), 'INVALID_INPUT')
  const onBoard = await items(a, 'thread', [['on', start.id]])
  t.alike(onBoard.map((x) => x.title), ['How do I open a site?'], 'listed on its board')
  t.alike(await items(a, 'thread', [['on', windows.id]]), [], 'not on the other')

  await a.editBoard(windows.id, { name: 'Windows & Linux' })
  t.ok(await eventually(async () => (await items(b, 'board')).some((x) => x.name === 'Windows & Linux'), WAIT), 'renamed for everyone')
})

test('replies in a tree, votes, edit and delete (US2)', async (t) => {
  const { key, inst, a } = await published(t)
  const { f: b } = await invited(t, a, key, inst)
  const { f: c } = await invited(t, a, key, inst)
  const me = { b: (await b.me()).identity, c: (await c.me()).identity }
  const board = await a.makeBoard({ name: 'General' })
  await has(b, 'board', board.id)
  const th = await b.post(board.id, { title: 'Disk use', text: 'What stays?' })
  await has(c, 'thread', th.id)

  const rb = await b.reply(th.id, th.id, 'Only what you looked at.')
  const rc = await c.reply(th.id, rb.id, 'Images too?')
  const rd = await a.reply(th.id, th.id, 'And it is capped.')
  const all = () => items(a, 'comment', [['on', th.id]])
  t.ok(await eventually(async () => (await all()).length === 3, WAIT), 'every reply reaches the owner')
  const rows = tree(await all(), th.id)
  t.alike(rows.map((r) => [r.comment.text, r.segs.join(' ')]), [
    ['Only what you looked at.', 'tee'],
    ['Images too?', 'pipe elbow'],
    ['And it is capped.', 'elbow']
  ], 'c under b under the thread; one step per level')
  t.alike(visible(rows, new Set([rb.id])).map((r) => r.id), [rb.id, rd.id], 'folding b hides what is under it')

  // votes: the latest per member counts; the same again takes it back
  await b.vote(rc.id, 1)
  await c.vote(rc.id, 1)
  await c.vote(rc.id, nextVote(1, -1))
  const votes = () => items(a, 'vote')
  t.ok(await eventually(async () => score(tally(await votes()), rc.id) === 0, WAIT), '+1 and -1: 0')
  t.is(voteOf(tally(await votes()), rc.id, me.c), -1, "c's vote is their latest")
  await b.vote(rc.id, nextVote(1, 1))
  t.ok(await eventually(async () => score(tally(await votes()), rc.id) === -1, WAIT), 'b took theirs back')
  t.is(nextVote(0, 1), 1)
  t.is(nextVote(-1, 1), 1)

  // edit and delete: the author only
  await c.edit(rc, { text: 'Images too, then?' })
  t.ok(await eventually(async () => { const r = (await all()).find((x) => x.id === rc.id); return r?.text === 'Images too, then?' && r.edited }, WAIT), 'edited, marked so')
  t.is(await codeOf(b.edit(rc, { text: 'hijack' })), 'NOT_ALLOWED', "someone else's reply")
  t.is(await codeOf(b.remove(rd.id)), 'NOT_ALLOWED')
  await b.remove(rb.id)
  t.ok(await eventually(async () => !(await all()).some((x) => x.id === rb.id), WAIT), 'deleted for everyone')
  const after = tree(await all(), th.id)
  t.is(after[0].comment, null, 'its place stays, "(deleted)"')
  t.is(after.find((r) => r.id === rc.id).segs.join(' '), 'pipe elbow', 'the reply under it stays under it')
  t.is(await codeOf(c.reply(th.id, th.id, '  ')), 'INVALID_INPUT')
})

test('moderation: report, hide, reveal, ban; admins make moderators (US3.3-6)', async (t) => {
  const { key, inst, a } = await published(t)
  const { f: b } = await invited(t, a, key, inst)
  const { f: c } = await invited(t, a, key, inst)
  const me = { b: (await b.me()).identity, c: (await c.me()).identity }
  const board = await a.makeBoard({ name: 'General' })
  await has(c, 'board', board.id)
  const th = await c.post(board.id, { title: 'Spam', text: 'buy now' })
  await has(b, 'thread', th.id)

  t.is(await codeOf(b.hide(th.id)), 'NOT_ALLOWED', 'a member hides nothing')
  await b.report(th.id, 'spam')
  t.ok(await eventually(async () => (await a.hyper.reports()).items.some((it) => it.on === th.id && it.reports.some((r) => r.reason === 'spam')), WAIT), 'the owner reads the report')
  t.is(await codeOf(b.hyper.reports()), 'NOT_ALLOWED', 'members see no report')

  await a.setRole(me.b, 'moderator')
  t.ok(await eventually(async () => (await b.me()).role === 'moderator', WAIT), 'b is a moderator')
  t.ok(await eventually(async () => { try { await b.hide(th.id, 'spam'); return true } catch { return false } }, WAIT), 'and hides the thread')
  t.ok(await eventually(async () => !(await items(c, 'thread')).some((x) => x.id === th.id), WAIT), 'in nobody\'s list')
  t.ok((await items(b, 'thread', [['moderated', 'hidden']])).some((x) => x.id === th.id), 'in the hidden list')
  await b.reveal(th.id)
  t.ok(await eventually(async () => (await items(c, 'thread')).some((x) => x.id === th.id), WAIT), 'shown again')

  const report = (await a.hyper.reports()).items.find((it) => it.on === th.id).reports[0]
  await a.dismiss(report)
  t.ok(await eventually(async () => !(await a.hyper.reports()).items.some((it) => it.on === th.id), WAIT), 'report dismissed')

  await b.ban(me.c, 'spam')
  t.ok(await eventually(async () => (await codeOf(c.post(board.id, { title: 'more', text: 'spam' }))) === 'NOT_ALLOWED', WAIT), 'banned: posts refused')
  t.ok((await a.hyper.members()).find((m) => m.identity === me.c).banned, 'listed as banned')
  t.is(await codeOf(c.setRole(me.b, 'member')), 'NOT_ALLOWED', 'and no say in roles')
})

test('sorting, unread and new, mentions with the current name; names and icons (US4, US5)', async (t) => {
  const { owner, key, inst, a } = await published(t)
  const { f: b } = await invited(t, a, key, inst)
  const { f: c } = await invited(t, a, key, inst)
  const me = { a: (await a.me()).identity, b: (await b.me()).identity, c: (await c.me()).identity }
  const board = await a.makeBoard({ name: 'General' })
  await has(b, 'board', board.id)

  const old = await b.post(board.id, { title: 'Old one', text: '' })
  const top = await b.post(board.id, { title: 'Top one', text: '' })
  const fresh = await a.post(board.id, { title: 'Newest one', text: '' })
  await has(b, 'thread', fresh.id)
  await c.vote(top.id, 1)
  await b.vote(top.id, 1)
  await has(c, 'thread', old.id)
  const r1 = await c.reply(old.id, old.id, 'bump')
  const r2 = await b.reply(old.id, r1.id, 'again')

  const sums = async () => {
    const [ts, cs, vs] = await Promise.all([items(a, 'thread'), items(a, 'comment'), items(a, 'vote')])
    return summarize(ts, cs, vs)
  }
  t.ok(await eventually(async () => (await sums()).get(old.id)?.replies === 2 && (await sums()).get(top.id)?.score === 2, WAIT), 'replies and votes reach the owner')
  const order = async (how) => sortThreads([...(await sums()).values()], how).map((s) => s.thread.title)
  t.alike(await order('activity'), ['Old one', 'Newest one', 'Top one'], 'activity: a reply brings a thread back up')
  t.alike(await order('newest'), ['Newest one', 'Top one', 'Old one'])
  t.alike((await order('top'))[0], 'Top one')
  t.alike((await order('lively'))[0], 'Old one', 'lively: two replies beat two votes, ties by activity')

  // unread: never read, then read, then a new reply; kept on the person's settings across a restart
  const activity = (await sums()).get(old.id).activity
  t.ok(unread(activity, (await a.mine())['read/' + old.id]), 'never opened: unread')
  await a.markRead(old.id, activity)
  await a.setSort('top')
  t.absent(unread(activity, (await a.mine())['read/' + old.id]), 'opened: read')
  await owner.rpc.request('close')
  const again = await engine(t, { dir: owner.dir })
  await again.rpc.request('site.open', { key })
  const a2 = forum(siteApi(again, key).instance(inst))
  const kept = await a2.mine()
  t.is(kept.sort, 'top', 'the sort chosen, kept')
  const r3 = await c.reply(old.id, old.id, 'one more')
  t.ok(await eventually(async () => (await items(a2, 'comment')).some((x) => x.id === r3.id), WAIT))
  const now = summarize(await items(a2, 'thread'), await items(a2, 'comment'), await items(a2, 'vote')).get(old.id).activity
  t.ok(unread(now, kept['read/' + old.id]), 'a new reply: unread again')
  t.alike((await items(a2, 'comment', [['on', old.id]])).filter((x) => x.stamp > kept['read/' + old.id]).map((x) => x.id), [r3.id], 'and only that reply is new')
  t.ok(r2.stamp <= kept['read/' + old.id])

  // bounded: read state of a thread no longer shown (here: deleted) is dropped
  await a2.markRead(fresh.id, Date.now())
  await a2.remove(fresh.id)
  const shown = new Set((await items(a2, 'thread')).map((x) => x.id))
  const stale = staleRead(await a2.mine(), shown)
  t.alike(stale, ['read/' + fresh.id], "the deleted thread's read state is stale")
  await a2.forget(stale)
  t.alike(Object.keys(await a2.mine()).filter((n) => n.startsWith('read/')), ['read/' + old.id], 'one entry per shown thread read')

  // mentions: the stored text has the key, the list is c's, the name shown is the current one
  await c.setName('cee')
  await b.setName('bee')
  const nameOf = async (f) => { const p = people(await items(f, 'profile'), await items(f, 'avatar')); return (k) => p.get(k)?.name || null }
  t.ok(await eventually(async () => (await nameOf(b))(me.c) === 'cee', WAIT), 'b knows c by name')
  const stored = toStored('thanks @cee!', { cee: me.c })
  t.is(stored, `thanks @${me.c}!`, 'the key is stored, not the name')
  const m = await b.reply(old.id, old.id, stored)
  t.alike(mentioned(m.text), [me.c])
  t.ok(await eventually(async () => (await items(c, 'mention', [['where', { who: me.c }]])).some((x) => x.on === m.id && x.author === me.b), WAIT), "in c's mentions")
  t.alike(await items(a2, 'mention', [['where', { who: me.a }]]), [], 'nobody mentioned the owner')
  t.ok(render(m.text, await nameOf(b)).includes('＠cee</a>'), 'shown with the name')
  await c.setName('cee two')
  t.ok(await eventually(async () => render(m.text, await nameOf(b)).includes('＠cee two</a>'), WAIT), 'and with the new name once changed')
  t.alike(toDraft(m.text, await nameOf(b)), { draft: 'thanks @cee two!', picks: { 'cee two': me.c } }, 'editing shows names again')

  // icons: from the key by default, the same everywhere; a drawn one seen by others
  t.alike(icon.fromKey(me.c), icon.fromKey(me.c))
  t.unlike(icon.fromKey(me.c), icon.fromKey(me.b))
  const drawn = new Uint8Array(icon.BYTES)
  icon.set(drawn, 0, 0, true)
  icon.set(drawn, 15, 15, true)
  await c.setIcon(drawn)
  t.is(await codeOf(c.setIcon(new Uint8Array(3))), 'INVALID_INPUT')
  t.ok(await eventually(async () => { const p = people(await items(b, 'profile'), await items(b, 'avatar')); return p.get(me.c)?.icon?.[0] === 0x80 && p.get(me.c).icon[31] === 0x01 }, WAIT), "b sees c's icon")
  t.is(icon.path(drawn), 'M0 0h1v1H0zM15 15h1v1H15z')
})

test('post text: the subset only, never HTML or scripts', (t) => {
  const key = 'y'.repeat(52)
  const html = render(`**bold** _it_ \`<b>\` [site](hyper://abc/page) [web](https://evil.example) ![pic](img/a.png) ![x](https://x/y.png)
> quoted <script>alert(1)</script>
\`\`\`
<img src=x onerror=alert(1)>
\`\`\`
@${key} <img src=x onerror=alert(1)> [x](javascript:alert(1)) ![a](../up.png)`, () => 'ann')
  t.ok(html.includes('<strong>bold</strong>'))
  t.ok(html.includes('<em>it</em>'))
  t.ok(html.includes('<code>&lt;b&gt;</code>'))
  t.ok(html.includes('<a href="hyper://abc/page">site</a>'))
  t.ok(html.includes('<img src="img/a.png" alt="pic">'))
  t.ok(html.includes('<blockquote>quoted &lt;script&gt;'))
  t.ok(html.includes('<pre><code>&lt;img src=x onerror=alert(1)&gt;</code></pre>'))
  t.ok(html.includes('＠ann</a>'))
  t.absent(/<script|<img src=x|href="https|href="javascript|src="https|src="\.\./.test(html), 'nothing else becomes a tag')
})
