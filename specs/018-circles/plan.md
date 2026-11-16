# Implementation Plan: 018 — circles

**Branch**: `018-circles` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

## Summary

The engine gains circle and holding calls for the shell (like `devices.*`), the share-full notification, and two
site calls: `hyper.copies()` and `rotateKey`. The shell gets the Configuration section, the circles window, the
notices and the join flow. Contacts gets a "…" menu per row; Chat shows invites, copies and Change key; Forum shows
copies and Change key on private boards. No hypergraph change expected (R2 says if one is needed).

## Technical Context

**Language/Version**: JavaScript (ESM), Node ≥ 22 and Bare ≥ 1.27; Electron 42.
**Primary Dependencies**: hypergraph/next with 023/024 (`createCircle`, `setHolding`, `holding()`, `copiesOf`,
`rotateKey`), SwarmFS. Nothing new.
**Testing**: brittle (`npm test`, `npm run test:bare`), `npm run test:sandbox`, `npm run framecheck`, `npm run perf`.
**Target Platform**: Windows and Linux desktop.
**Constraints**: sites are strangers (constitution I); `site.json` fields and Chat's record fields are permanent once
released (additions only).
**Scale**: 50 members per circle, a few circles per person, 1 GB default share.

## Constitution Check

- I. Sites are strangers: `hyper.copies()` and `rotateKey` only on the page's own space, sub-spaces and instances;
  joining a circle only through the shell's own flow (FR-009). Each guard has a control-run check in the self-test. ✅
- II. Test-first: engine through `start(ipc)`; shell logic in `shell/model.js`; apps' logic in their `lib/`. ✅
- III. Node and Bare: engine changes in `engine/` only; free space via `fs.statfs` (Node) and `bare-fs` `statfs`. ✅
- IV. Compose: hypergraph's circle API as it is. ✅
- V. Smallest: no pause switch (Q14), no circle chat (Q11). ✅

## Research (worker, before code)

- **R1 Engine calls** (shell only, never a page): `circles.list` → `[{ key, name, members, holders, role }]`,
  `circles.create({ name })`, `circles.rename`, `circles.leave`, `circles.invite(key)` → link (one use, 7 days),
  `circles.join(link)`, `circles.members(key)`, `circles.setRole`, `circles.remove`; `holding.get` →
  `{ on, bytes, used, free }`, `holding.set({ on, bytes })`; a `circles` event when any of it changes. Say where the
  circle list comes from (`hg.spaces()` and `space.circle`).
- **R2 "Holds" per member** (FR-004): from the circle's `hg/holder` records (newest per device, `on`), read by the
  engine. If hypergraph gives no clean way, stop and tell the lead (a small hypergraph request instead).
- **R3 Free space** (FR-006): `statfs` on the engine's folder, Node and Bare; the check lives in the engine
  (`holding.set` refuses with `TOO_BIG` and the free amount), the shell only shows it.
- **R4 Share full** (FR-007): watch `holding().used` against `bytes` (hypergraph's events or a timer); one
  notification through spec 016's path, as a HyperBrowser item (not an app's).
- **R5 Invite in Chat** (FR-008/009): Contacts' "…" calls a new contacts call (`contacts.inviteToCircle(identity,
  circle)`) that writes the link as a message field in the direct conversation (the engine already makes those).
  Chat renders it as a button calling `hyper.circles.join(link)`, which only opens the shell's join flow (the person
  confirms there). Check older Chat versions still show something readable (the plain link in the text).
- **R6 Copies** (FR-010/011): `copies` in the site calls with the own-space/instance guard; Chat and Forum refresh on
  hypergraph's 'copies' event (passed as a page event) rather than a timer.
- **R7 Change key** (FR-012): `rotateKey` in the site calls; the apps show it to the owner only (hypergraph also
  lets deciders and moderators).

## Contracts (additions)

```js
hyper.copies(key)              // { wanted, kept, online }; own space, sub-spaces, instances
hyper.rotateKey()              // on a space or instance handle the person may change
hyper.on('copies', fn)         // copies may have changed
hyper.circles.join(link)       // opens HyperBrowser's join flow; resolves { joined: true | false }
hyper.contacts.inviteToCircle(identity, circleKey)   // contacts permission only (Contacts)
```

Engine messages for the shell: `circles.*`, `holding.*`, a `circles` event (R1).

## Project Structure

```text
engine/index.js           circles.*, holding.* (shell), copies and rotateKey in CALLS, circles.join (page → shell)
engine/contacts.js        inviteToCircle
engine/notifications.js   share full (R4)
shell/ui/                 Configuration's Circles section, the circles and members windows, notices
shell/model.js            share field checks, lists (tested)
shell/site-preload.cjs    hyper.copies, hyper.rotateKey, hyper.circles.join, contacts.inviteToCircle
sites/contacts/           a "…" per row: Invite to circle ▸
sites/chat/               invite button, copies line and warning, Change key
sites/forum/              copies line and warning on private boards, Change key
test/                     circles.test.js (engine), model.test.js, chat.test.js, forum.test.js, two-engines.test.js
shell/main.js self-test   guards (control run): copies and rotateKey on another key refused, join only via shell
perf/circles.mjs          Configuration open with 3 circles of 50; engine idle CPU while holding 1 GB
docs/                     shell.md (Circles), site-api.md (copies, rotateKey, circles.join), chat.md, forum.md
```

## Order

1. Tests first (engine calls, model checks, guards), failing.
2. Engine: R1–R4, R6, R7.
3. Shell: Configuration section, windows, notices, join flow.
4. Apps: Contacts "…" (R5), Chat, Forum.
5. Docs, perf, self-test, framecheck; full suites on Node and Bare (sandbox too).

One worker, one commit per step.

## Risks

- R2 may need a hypergraph addition (who holds, per member): the worker stops and asks.
- The Chat message field for invites is permanent once published: the lead reviews it before step 4.
- Holding 1 GB on a laptop's disk: the free-space check (R3) is the only guard; measured in perf.
