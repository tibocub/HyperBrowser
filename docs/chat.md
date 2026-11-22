# Contacts and Chat

`sites/contacts` and `sites/chat` are HyperBrowser's apps for friends and private conversations. What people
see and do: `sites/home/friends.hmd`. Design: `specs/013-contacts-chat/`.

## Publishing them

```bash
npm run apps:publish -- --dir <owner engine folder>
```

This publishes both with the other official apps and writes their keys into `shell/preset.json`
(`preset:chat`, `preset:contacts`; see [engine.md](engine.md#the-official-apps)). The shell then tells the engine
which app owns friends' conversations (`apps.set`) and opens Contacts on a person with `?person=<key>`. Until
they are published, the desktop icons say "not published yet", Chat says "no chat app yet", and its Contacts
links show "Contacts is not published yet" (`NOT_PUBLISHED`).

Publishing again sends the edited pages to everyone. Chat's new record types reach a conversation when its
owner opens it. A new `site.json` (new watches, for example) reaches people only once Chat is published again
(`npm run chat:publish`).

## How it works

- **Contacts live in the engine** (`engine/contacts.js`), in the person's settings, so every device of theirs
  has them: `hyperbrowser/contacts` (`{ [identity]: { name, state, chat, link?, delivered?, named?, at } }`),
  `hyperbrowser/contact-links`, `hyperbrowser/findable`, and SwarmFS's `name` (the person's name, one for all
  apps).
- **A request is a conversation.** The sender's engine makes a private instance of Chat
  (`createSite({ private: true })`), writes its `profile` (name) there, keeps a one-use member invite, and sends
  it either over the DHT or as a contact link. Over the DHT, the topic is
  `hash('hyperbrowser/contacts/1/' + identity)` on the engine's own Hyperswarm: the recipient's devices announce
  it while "findable", and the sender looks it up every 15 s until delivered. The receiver reads who sent it from
  the invite's signature (`hypergraph/lib/invites.js`), never from the message.
- **Accepting** joins the conversation (`joinInstance`, refused unless it is a Chat instance). The sender's watch
  (every 2 s, pending conversations only) sees the join and makes them a friend; anyone else who joined is
  banned.
- **Chat** is an ordinary app with instances: direct conversations (named after the contact whose `chat` they
  are) and groups (`instances.create(name, { private: true })`). Its logic (`sites/chat/lib/chat.js`, tested on
  real engines in `test/chat.test.js`) uses only the site API. Rights are hypergraph roles: `member`, Chat's own
  `inviter` (`post`, `invite`: may add people, gives no rights), `moderator`, `admin`. A friend is added to a
  group by an `invite` record (link and name) in the direct conversation.
- **Calls between apps** go through the shell (`hyper.people`, `people()` in `shell/main.js`): opening needs a
  click (the preload passes `navigator.userActivation.isActive`), a request needs the person's yes in a dialog.
- **A redraw keeps your place.** The message list opens at the latest message and follows new ones while you
  are at the end; scrolled up, it stays put; sending takes you to the end (`sites/chat/lib/scroll.js`). The
  caret and selection in the draft stay where they were.
- **Unread**: the conversation list shows each conversation's unread number (`hyper.notifications.unread()`). A
  conversation opened with unread messages shows a "New messages" line above the first of them (the last
  `count` messages from others, `newLine` in `scroll.js`); otherwise it opens at the latest message. Every
  conversation reads oldest at the top.
- **One "…" per message**: your own messages' Edit and Delete (a moderator's Delete) behind it, a `<details>`
  opened with Enter or Space. Its content floats under it and moves nothing; a click outside or Escape closes it.
- **Long words** (an `hg:` link) wrap anywhere, in messages, names and the conversation list, rather than widen
  the page.
- No stylesheet in either app: they use HyperBrowser's default theme.

## Notifications

Chat's `site.json` watches `message` (its text) and `invite` ("invited you to a group"). Its page calls
`hyper.notifications.viewing(<conversation>)` when it shows one, so an open conversation never pops up. Chat's
conversations are the ones the engine keeps online first (up to 24).

## Circle invites

A friend is invited to a circle from Contacts (… → **Invite to "<circle>"**) or from the circles window
(… → **Invite contacts…**). The engine (`contacts.inviteToCircle(identity, circle)`) writes a `message` in the
direct conversation with two extra fields on Chat's `message` type:

- `circle` (string): the circle's invite link (`hg:…`, one use, 7 days);
- `circleName` (string): the circle's name as the sender sees it.

Its `text` is `Join my circle "<name>": <link>`, so an older Chat shows the plain link. The current Chat shows an
**Accept <sender>'s invitation to "<name>"** button instead, which calls `hyper.circles.join(link, name)`:
HyperBrowser's own question, never a join by the page. A conversation whose owner hasn't opened the current Chat
yet still has the old `message` type and refuses the new fields; the engine then writes the text only.

Chat's `invite` type (group invites) isn't reused for this: an older Chat would join a circle's link as a group
and spend its one use.

Contacts' **…** per friend (a button apart from **Message**, its menu floating under it; Enter or Space opens it,
Tab reaches its items, a choice, a click outside or Escape closes it, a refresh keeps it open) lists **Invite to
"<circle>"** for each circle the person owns or administers (`contacts.circles()`), or "No circle to invite to".

## Copies, Change key, Secure

A conversation's **…** (next to its name) says "Kept by N of 5 copies, M online"
(`hyper.instance(k).copies()`, refreshed on its `copies` event) when the person's circles keep it, with "Few
copies online: people may not get this while you're offline" under 2 online. Its owner gets **Change key**
(`rotateKey()`: a new key from now on, for a lost device or a suspected leak).

In a **group**, its owner and admins also get **Secure this group…** (new keys and a new address, with an
optional "Also delete history before now") and **Trim history…** (keep the last N days, weeks, months or
years). A removal or a ban offers **Secure this group…** once, under the messages; a member left out sees "You
no longer have access to this group". Not in a direct conversation, which belongs to the two people's contacts
entry.

## Encrypted conversations

Every conversation hides its history (hypergraph's secure conversations, spec 031): the engine calls
`setHistory('hidden')` on each direct conversation it creates (`engine/contacts.js`) and Chat on each group
(`chat.group`). Each message has its own key; a newcomer, or a member's new device, reads from its join on.
The person's `profile` (their name) is written once this device holds the key, whenever that is: right after
`chat.join` if a member who may change the key is online, else when its `status` event says access turned
`'full'` (`chat.keepProfile`, also run when a conversation opens, so a restart catches up). SwarmFS's `site` and `profile` are hypergraph *shared* types, so a newcomer reads the
site record and everyone's names; someone removed keeps reading those (not messages) until the group is
secured.

- **Both people of a direct conversation are admins**: the engine makes the friend an admin once it sees
  them join (`joined()` in `engine/contacts.js`), so either one's devices change the key.
- The conversation's **…** says "Encrypted. New members and new devices read from when they join." (or
  "Encrypted. New members read the whole history." after **Keep history**). The UI says "encrypted", never more,
  until an outside review of the cryptography.
- **Messages disappear**: Off, 1 hour, 1 day, 7 days, 30 days (`setDisappearing`), set by owners and admins,
  with "a modified app can still keep them".
- **Keep history for new members…** (groups, owners and admins, after a warning): `setHistory('visible')`;
  **Stop keeping history…** switches back.
- **"X added a device"**: a line in the conversation for each device of a member after their first, at its
  `members()` device's `added` time, refreshed on the `devices` event.

## Limits

- A conversation shows its latest 300 messages; past that, a new message shifts your place by the one that drops.
- Requests need both people online at once (there is no sealed inbox); at most 100 incoming requests.
- An impostor answering under someone's DHT topic can spoil (not read) a request (`specs/requests-to-hypergraph.md` B5).
- The rendezvous uses a second DHT node per engine (B6 there).
- No public rooms yet.
