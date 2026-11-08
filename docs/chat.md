# Contacts and Chat (spec 013)

`sites/contacts` and `sites/chat`: HyperBrowser's two apps for friends and private conversations. What people see
and do: `sites/home/friends.hmd`. The design and Tibo's choices: `specs/013-contacts-chat/`.

## Publish them (owner)

```bash
npm run chat:publish
```

```bash
npm run contacts:publish
```

Each prints its key. Put them in `shell/preset.json` (`preset:chat`, `preset:contacts`): the shell tells the engine
which app owns friends' conversations (`apps.set`) and opens Contacts on a person (`?person=<key>`). Until then the
desktop icons say "not published yet" and `hyper.people.contact` answers `NOT_PUBLISHED`. Publishing again sends
the edited pages to everyone; Chat's new record types reach a conversation when its owner opens it.

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
- No stylesheet in either app: HyperBrowser's default theme.

## Limits (shortcuts)

- A conversation shows its latest 300 messages.
- Requests need both people online at once (no sealed inbox); an incoming list of at most 100.
- An impostor answering under someone's DHT name can spoil (not read) a request: B5.
- A second DHT node per engine for the rendezvous: B6.
- Public rooms: a spec of their own (Tibo, Q2).
