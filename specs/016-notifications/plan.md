# Implementation Plan: 016 — notifications

**Branch**: `016-notifications` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

## Summary

An app declares in `site.json` what to watch. Once the person says yes, the engine watches those record types in the
app's instances, with no app code, and finds what's new with a per-log cursor (a small hypergraph addition, B7), not
with dates. The shell shows a counter, a list, icon counts, popups and a tray mark, and adds a Configuration page.

## Technical Context

**Language/Version**: JavaScript (ESM), Node ≥ 22 and Bare ≥ 1.27; Electron 42 for the shell.
**Primary Dependencies**: hypergraph/next (+ B7), SwarmFS. Nothing new.
**Storage**: the person's settings (synced); one JSON file in the engine's folder (this device).
**Testing**: brittle, `npm test` / `npm run test:bare` (local DHT), `npm run test:sandbox`, `npm run framecheck`.
**Target Platform**: Windows and Linux desktop. Android later, same engine code.
**Performance Goals**: SC-001 (5 s), SC-003 (10 minutes for 50 places), SC-005 (200 MB, no sustained CPU).
**Constraints**: sites are strangers; the engine is test-first and runs on Bare; `site.json` is hard to change later.
**Scale/Scope**: 50 watched places per person, 200 kept notifications, 16 watches per app.

## Constitution Check

- I. Sites are strangers: no app code runs for a watch; a page reads nothing back; `viewing` only affects its own app.
  Each guard tested with guards off. ✅
- II. Test-first: engine through `start(ipc)` on real instances; shell by self-test and control run. ✅
- III. Node and Bare: the watcher is engine code, Bare modules only; the protocol change is additive. ✅
- IV. Compose: the missing "what's new" goes to hypergraph (B7), not worked around. ✅
- V. Smallest: one page call, no do-not-disturb, no runtime watches (forum panel spec), no push. ✅

Re-checked after design: no change.

## Research

[research.md](research.md). R1 is the one that shapes the work: **B7 comes first**.

## Project Structure

```text
specs/016-notifications/   spec, plan, research, data-model, contracts, quickstart

hypergraph (own branch, first)
  lib/space.js             since(cursor, { types, limit })
  test/next/...            late arrival, clock ahead, restart; forum scenario
  perf/scenarios/          since: cost follows what's new, not the space's size

HyperBrowser
  engine/manifest.js       parse and check `notifications`
  engine/notifications.js  watches, cursors, turns, items, read state (as engine/contacts.js)
  engine/index.js          notify.* messages, site.permit, instance leave and uninstall clean-up
  shell/main.js            permission question, popups, viewing, click to open
  shell/site-preload.cjs   hyper.notifications.viewing
  shell/tray.js            the mark
  shell/frame.js, ui/      counter, list, icon counts, Configuration page (tray and Devices move there)
  sites/chat, sites/forum, site.json watches, viewing; forum's `#/r/<id>` route
  test/notifications.test.js
  perf/notifications.mjs   SC-005
  docs/                    site-api.md, shell.md, engine.md, chat.md, forum.md
```

## Order

1. hypergraph B7, one worker. Reviewed and merged before the rest. SwarmFS suite after.
2. Engine: manifest, watches, cursors, permission, read state (US1, US3, US4, US6, without UI).
3. Turn-based checking (US5), measured on the public DHT.
4. Shell: counter, list, icon counts, popups, tray, Configuration page (US1, US2, US3).
5. Chat, Forum and Contacts wired in; docs; perf.

Steps 2 to 5 are one worker, one commit per step: they share the engine and the protocol.

## Risks

- Holding many spaces on the public DHT: R3's 20 s is a guess until step 3 measures it.
- Windows popups in an unpackaged build (R8): check by hand early.
- Apps must be published again (`apps:publish`) before their watches reach anyone.
