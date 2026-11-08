# Data model: 009 — federated apps

## App (unchanged)

A dynamic site: `site.json` with `permissions: ["space"]`, its `types`; **public** (anyone loads its code). Its
space may still hold the app's own records (none for the forum).

## Instance (new)

A top space, created by `sfs.createSite(name, { app, types })`:

| What | Value | Who writes it |
|------|-------|---------------|
| owner | the person who created it (hypergraph: the creator) | — |
| name | 1 to 200 characters | owner, admins (hypergraph's name) |
| `site` record | `{ pages: null, app: '<app key>' }` (SwarmFS type, field `app` added at the end) | who may decide: owner, admins |
| types | the app's `site.json` types at creation; later additions declared by an owner or admin opening it | owner, admins |
| public | `false` by default; `create(name, { public: true })` makes it public for good | owner, admins |
| members, roles, invites, sub-spaces, records | as any hypergraph space | as today |

Rules:
- An instance is reachable by app A only if its `site` record's `app` is A's key **and** it is in A's list (below).
- No pages: reading a page of an instance is `NOT_FOUND`; its code is the app's.

## The person's instances of an app (new)

One setting of the person (replicated to their devices):

```
hyperbrowser/app/<app key>/instances → { "<instance key>": true, ... }
```

- Written by the engine only: `instances.create` and `instances.join` add, `instances.leave` removes, opening an
  instance's link in the address field adds (R4).
- Never written by a page (pages' own settings live under `hyperbrowser/site/<key>/`).
- Bounded: at most 1000 instances per app (`TOO_BIG` past that): a setting replicates to every device.

## Transitions

```
(none) --create / join / open its link--> listed (held here, reachable by its app)
listed --leave--> (none)        dropped from this device and from the list; membership unchanged
listed --instance's site record names another app--> unreachable (NOT_ALLOWED), still listed until left
listed --consent for the app turned off--> unreachable (NOT_ALLOWED)
```
