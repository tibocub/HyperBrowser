# Contract: contacts and the calls between apps (spec 013)

## Engine messages (shell → engine)

| Method | Params | Result |
|---|---|---|
| `apps.set` | `{ chat }` (a site key or null) | `true`: the app whose instances direct conversations are |
| `contacts.request` | `{ identity, name }` | the contact: the shell's call after the person said yes |
| `contacts.get` | `{ identity }` | the contact or null (the shell's "open a chat") |
| `site.permit` | `{ key, permission: 'contacts', allow }` | `true`: the person's answer, remembered |

Through `site.call` (a site with `"contacts"` in `site.json` `permissions`, allowed by the person; else
`NEEDS_PERMISSION` once, then `NOT_ALLOWED` after a no; a site that doesn't declare it: `NOT_ALLOWED`):

| Method | Args | Result |
|---|---|---|
| `contacts.me` | | `{ identity, name, findable }` |
| `contacts.setMe` | `{ name?, findable? }` | `true` |
| `contacts.list` | | `[{ identity, name, state: 'friend' \| 'incoming' \| 'outgoing', chat, at }]` |
| `contacts.request` | `identity, name?` | the contact (outgoing) |
| `contacts.accept` / `decline` / `remove` | `identity` | `true` |
| `contacts.rename` | `identity, name` | `true` |
| `contacts.link` | | `{ link }`: a one-use contact link |
| `contacts.add` | `link` | the contact (friend) |

Event `site.on { event: 'contacts' }`: the list may have changed (same permission).

`instances.create(name, { public?, private? })`: `private: true` makes a private instance (Chat's
conversations); public and private together are `INVALID_PARAMS`.

Errors: `INVALID_PARAMS` (bad key or name), `ALREADY` (yourself, already a friend), `NOT_FOUND` (no such contact),
`NOT_READY` (no chat app yet), `NOT_ALLOWED` (a link that isn't a Chat conversation), `TOO_BIG` (1000 contacts).

## Site API (window.hyper)

```js
// any dynamic site: through HyperBrowser, never touching the contacts
await hyper.people.request(identity, 'Bob')   // HyperBrowser asks "send a friend request?"; no → NOT_ALLOWED
hyper.people.chat(identity)                    // during a click: Chat on your conversation (or their contact page)
hyper.people.contact(identity)                 // during a click: their page in Contacts
// with "permissions": ["space", "contacts"], allowed once:
await hyper.contacts.list()
hyper.contacts.on(() => render())              // returns stop()
```

## DHT presence (engine ↔ engine)

Topic `hash('hyperbrowser/contacts/1/' + identity)`. Frames (framed-stream, JSON, ≤ 4 KB):
`{ t: 'request', link, name }` → `{ t: 'ok', chat }`. A request is kept only if its link is an invite (not a public
link) signed by someone other than the receiver; the sender is the invite's maker.
