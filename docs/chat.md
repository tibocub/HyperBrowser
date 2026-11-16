# Contacts and Chat (spec 013)

`sites/contacts` and `sites/chat`: HyperBrowser's two apps for friends and private conversations. What people see
and do: `sites/home/friends.hmd`. The design and Tibo's choices: `specs/013-contacts-chat/`.

## Publish them (owner)

```bash
npm run apps:publish -- --dir E:/Code/P2P/hyperbrowser-owner
```

It publishes both (with the other official apps) and writes their keys into `shell/preset.json` (`preset:chat`,
`preset:contacts`; see [engine.md](engine.md)): the shell tells the engine which app owns friends' conversations
(`apps.set`) and opens Contacts on a person (`?person=<key>`). Until then the desktop icons say "not published
yet", Chat says "no chat app yet" and its Contacts links show "Contacts is not published yet" (`NOT_PUBLISHED`).
Publishing again sends the edited pages to everyone; Chat's new record types reach a conversation when its owner opens it.

## How it is made

- **Contacts live in the engine** (`engine/contacts.js`), in the person's settings, so every device of theirs
  has them: `hyperbrowser/contacts` (`{ [identity]: { name, state, chat, link?, delivered?, named?, at } }`),
  `hyperbrowser/contact-links`, `hyperbrowser/findable`, and SwarmFS's `name` (the person's name, one for all apps).
- **A request is a conversation.** The sender's engine makes a private instance of Chat (spec 009,
  `createSite({ private: true })`), writes its `profile` (name) there, keeps a one-use member invite, and sends it:
  over the DHT (a Hyperswarm of the engine, topic `hash('hyperbrowser/contacts/1/' + identity)`; the recipient's
  devices announce it while "findable"; the sender looks it up every 15 s until delivered), or as a contact link.
  The receiver reads the sender from the invite's signature (`hypergraph/lib/invites.js`), never from the message.
- **Accepting** joins the conversation (`joinInstance`: refused unless it is a Chat instance). The sender's watch
  (every 2 s, pending conversations only) sees the join: friend; anyone else who joined is banned (B5).
- **Chat** is an ordinary app with instances: direct conversations (named by the contact whose `chat` they are) and
  groups (`instances.create(name, { private: true })`). Its lib (`sites/chat/lib/chat.js`, tested on engines in
  `test/chat.test.js`) uses only the site API. Rights are hypergraph roles: `member`, Chat's own `inviter`
  (`post`, `invite`: adds people, gives no rights), `moderator`, `admin`. A friend is added to a group by an
  `invite` record (link + name) in the direct conversation.
- **Calls between apps** go through the shell (`hyper.people`, `shell/main.js` `people()`): open needs a click
  (the preload passes `navigator.userActivation.isActive`), a request needs the person's yes in a dialog.
- **A redraw keeps your place.** The message list opens at the latest message and follows new ones while you are
  at the end; scrolled up, it stays put; sending takes you to the end (`sites/chat/lib/scroll.js`). The caret and
  selection in the draft stay where they were.
- **Unread and "New messages"** (spec 017): the conversation list shows each one's unread number
  (`hyper.notifications.unread()`, Chat's own conversations only). A conversation opened with unread messages
  shows a "New messages" line above the first of them (the last `count` messages from others,
  `sites/chat/lib/scroll.js` `newLine`), in view; else it opens at the latest message. Every conversation, group or
  direct, reads oldest at the top.
- **One "…" per message** (spec 017): your own messages' Edit and Delete (a moderator's Delete) behind it; a
  `<details>`, opened with Enter or Space.
- No stylesheet in either app: HyperBrowser's default theme.

## Circle invites (spec 018)

A friend is invited to a circle from Contacts (… → **Invite to circle ▸ <circle>**): the engine
(`contacts.inviteToCircle(identity, circle)`) writes a `message` in your direct conversation with them, with two
fields added to Chat's `message` type (permanent once published, additions only):

- `circle` (string): the circle's invite link (`hg:…`, one use, 7 days);
- `circleName` (string): the circle's name as you see it.

Its `text` is `Join my circle "<name>": <link>`, so an older Chat shows the plain link. This Chat shows a
**Join "<name>"** button instead, which calls `hyper.circles.join(link, name)`: HyperBrowser's own question, never a
join by the page. A conversation whose owner hasn't opened this Chat yet has the old `message` type and refuses the
new fields: the engine then writes the text only. Chat's `invite` type (group invites) isn't reused: an older Chat
would join a circle's link as a group and spend its one use.

**Copies and Change key** (spec 018): a conversation's **…** (next to its name) says "Kept by N of 5 copies, M
online" (`hyper.instance(k).copies()`, refreshed on its `copies` event) when your circles keep it, with "Few copies
online: people may not get this while you're offline" under 2 online; its owner gets **Change key**
(`rotateKey()`: a new key from now on, for a lost device or a suspected leak). Contacts' **…** per friend lists
**Invite to circle ▸** your circles (`contacts.circles()`: those you own or are admin of).

## Notifications (spec 016)

Chat's `site.json` watches `message` (its text) and `invite` ("invited you to a group"); its page calls
`hyper.notifications.viewing(<conversation>)` when it shows one, so an open conversation never pops up. Chat asks
"Let Chat notify you?" like any app. Its conversations stay online first (up to 24). A new `site.json` reaches
people only once Chat is published again (`npm run chat:publish`).

## Limits (shortcuts)

- A conversation shows its latest 300 messages; past that, a new message shifts your place by the one that drops.
- Requests need both people online at once (no sealed inbox); an incoming list of at most 100.
- An impostor answering under someone's DHT name can spoil (not read) a request: B5.
- A second DHT node per engine for the rendezvous: B6.
- Public rooms: a spec of their own (Tibo, Q2).
