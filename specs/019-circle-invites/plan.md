# Implementation Plan: 019 — circle invites

**Branch**: `019-circle-invites` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

## Summary

Shell only and apps only; no engine API change expected (the shell already reaches `contacts.list`,
`contacts.inviteToCircle`, `circles.members` and `circles.join` over its rpc). The circles window gets **Invite
contacts…** and **Join with a link…**; Chat's invite button changes its label; Contacts' "…" becomes a floating menu.

## Technical Context

JavaScript (ESM), Electron 42, Node ≥ 22 and Bare ≥ 1.27. Testing: brittle (`npm test`, `npm run test:bare`),
`npm run test:sandbox`, `npm run framecheck`, `npm run perf`. Constraints: sites are strangers; Chat's record fields
are permanent (no change here).

## Constitution Check

- I. Sites are strangers: joining stays in the shell (FR-002 is the shell's own window); no new page call. ✅
- II. Test-first: the picker's rules (who is selectable, the result line) and the paste errors in `shell/model.js`;
  Chat's label in `sites/chat/lib`; Contacts' menu checked in a real page (self-test or sandbox). ✅
- III. Node and Bare: no engine change; if one turns out needed, `engine/` only. ✅
- V. Smallest: no shared component, no address-field join. ✅

## Research (worker, before code)

- **R1** Who is "already in" (FR-001): `circles.members(key)` identities against `contacts.list` friends. Say if the
  shell's rpc may call `contacts.*` (it's the engine's own client, not a page) or if a shell-side call is needed.
- **R2** Paste-join (FR-002): reuse `frame.js` `joinCircle` with a flag to skip the "Join?" question; map
  `INVITE_INVALID`/used/expired, `CIRCLE_FULL`, and a link that isn't a circle's (say what hypergraph returns for a
  forum's or a site's invite).
- **R3** Contacts' menu (FR-004): a `position: relative` wrapper and an absolutely placed list, or a `<details>` whose
  content floats; whatever keeps keyboard use and survives `draw()` (Chat's `view.menu` pattern keeps it open).
- **R4** Look at Chat's and Forum's "…" in a real page (FR-005) before changing them.

## Project Structure

```text
shell/ui/ui.js, ui.css, index.html   Invite contacts… (picker), Join with a link… (field)
shell/frame.js                       joinCircle(link, name, { asked }) for the pasted link
shell/model.js                       picker rules, paste error text (tested)
sites/chat/app.js, lib/chat.js       the Accept label
sites/contacts/app.js                the floating "…" menu
test/                                model.test.js, chat.test.js, a two-engine test: invite 2 friends from the shell
                                     calls, each sees it in Chat; a pasted link joins
shell/main.js self-test              Contacts' menu opens without moving the row (positions before and after)
perf/circles.mjs                     inviting 10 friends at once (ms)
docs/                                shell.md (circles window), chat.md, contacts section; home site help if it
                                     describes inviting
```

## Order

1. Tests first, failing.
2. Shell: picker, paste-join.
3. Apps: Chat label, Contacts menu (and Chat/Forum menus if R4 finds the same problem).
4. Docs, perf, self-test, framecheck; full suites on Node and Bare, sandbox too.

One worker, one commit per step.

## After merge (Tibo)

`npm run apps:publish -- --dir E:/Code/P2P/hyperbrowser-owner` (Chat and Contacts changed), or `npm run apps:seed` to
publish and stay online.
