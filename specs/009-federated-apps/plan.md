# Implementation Plan: 009 — federated apps

**Branch**: `claude/009-federated-apps-143ff9` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-federated-apps/spec.md`

## Summary

An app's page gets instances: `hyper.instances.create / join / list / leave` and `hyper.instance(key)`, a handle
with the whole site API on one instance. An instance is a SwarmFS site with no pages whose `site` record names its
app (written only by its owner or admins), owned by its creator, with the app's types. The engine lets an app
reach an instance only if the instance names that app and is in the person's list for that app (a setting only
the engine writes). Code stays in the app's site: a new version reaches every instance. The official forum
becomes the forum app (public) plus Tibo's "HyperBrowser" instance. Details: [research.md](research.md),
[data-model.md](data-model.md), [contracts/site-api.md](contracts/site-api.md), [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: JavaScript (ES modules), Node 22 and Bare (engine); Electron (shell)

**Primary Dependencies**: hypergraph (`hypergraph/next`), SwarmFS (`file:../SwarmFS`)

**Storage**: hypergraph spaces (instances); the person's settings (each app's list of instances)

**Testing**: `brittle`, engines on a local DHT (`hypergraph/testing`), Node and Bare; the sandbox self-test

**Target Platform**: Windows, Linux (desktop); the engine stays mobile-ready

**Project Type**: desktop app (shell + engine worker) and its sites

**Performance Goals**: no new hot path: one settings read per call that names an instance (already done per call
for consent); instance handles cached per view like the site's own scope

**Constraints**: constitution I (an app reaches only its instances; guards with control runs); protocol additions only

**Scale/Scope**: up to 1000 instances per app per person; hypergraph opens them while used

## Constitution Check

| Principle | Check |
|-----------|-------|
| I. Sites are strangers | Pass. The shell still names the site from the view; the page's `instance` is data checked in the engine against a list only the engine writes **and** the instance's own mark. Each guard gets a test with a control run (sandbox self-test: a page naming another site's key as `instance`). |
| II. Test-first | Pass. `test/instances.test.js` written first, through `start(ipc)` and the site API; Node and Bare. |
| III. Node and Bare | Pass. No new modules; settings and SwarmFS calls only. |
| IV. Compose | Pass. The instance mark is SwarmFS's (`site` record gains `app`): asked in `specs/requests-to-swarmfs.md` F7 and done on a SwarmFS branch with its tests, not worked around. No hypergraph change expected. |
| V. Smallest design | Pass. Four calls and one handle; no directory, no per-instance consent, no new origin. `site.json` unchanged. |

Re-checked after design: no change.

## Project Structure

### Documentation (this feature)

```text
specs/009-federated-apps/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/site-api.md
├── checklists/requirements.md
└── tasks.md             # after the lead's answers (/speckit-tasks)
```

### Source Code

```text
engine/index.js          # instances.* calls, `instance` in target(), site.open of an instance, hosting skips
engine/cli.js            # publish --instance
shell/main.js            # bridge passes `instance`; openSite of an instance → app view with ?instance=
shell/frame.js           # the tab keeps the instance's key as its address
shell/site-preload.cjs   # hyper.instances, hyper.instance(key)
shell/selftest/          # guard: a page naming a foreign key as instance (and its control run)
test/instances.test.js   # new: the done-when list
test/helpers.js          # siteApi(): instances, instance(key)
test/forum.test.js       # runs against an instance
sites/forum/             # after the lead's go (008 merged): app page with no instance; lib/ handed hyper.instance(key)
docs/site-api.md, docs/forum.md, sites/home/forum.hmd
specs/requests-to-swarmfs.md   # F7
SwarmFS (own worktree, branch 007-app-instances): lib/types.js, lib/swarmfs.js, lib/site.js, test
```

**Structure Decision**: the existing layout; one new test file.

## Order of work

1. SwarmFS branch: `site` record `app`, `createSite(name, { app })` without pages, `site()` of an instance. Its suite.
2. Engine (tests first): `instances.*`, `instance` param, guards, `site.open` of an instance, hosting rule, CLI.
   Tested against the SwarmFS branch through a junction in this worktree's `node_modules` (said in the report).
3. Shell: preload, bridge, address of an instance tab; sandbox self-test guard + control run.
4. Docs: `docs/site-api.md`.
5. **Wait for the lead's go** (008-ui-polish merged), then the forum: start page with no instance, `lib/` on
   `hyper.instance(key)`, tests against an instance, `docs/forum.md`, `sites/home/forum.hmd`, publish script.

## Open questions (for Tibo, through the lead) — each with the recommendation

- **Q1. How people find instances.** Recommend: links (invite, public link, key) plus "your forums" in the app,
  and the official forum shown on the app's start page. No public directory now (it needs a shared list someone
  moderates: a later feature, maybe an instance of its own).
- **Q2. The app's default page.** Recommend: opening the forum app with no instance shows your forums, create,
  join by link, and the official forum; the preset's forum icon opens the official instance directly.
- **Q3. The existing test forum's data.** Recommend: drop it. The app is published fresh and **public** (code must
  load for anyone; making the old invite-only forum public would publish its test data for good). **So the
  preset's forum key changes**: it becomes the official instance's key; Tibo republishes, the lead updates the preset.
- **Q4. Who may create instances.** Recommend: anyone who allowed the app. The app's author can't limit it (that
  would be authority over others' forums); an app's own page may hide the button if its author wants.
- **Q5. Instance types.** Recommend: instances carry the app's types (and their additions, declared when an owner
  or admin opens a newer version); no types of their own (the code couldn't trust them).
- **Q6. Identity consent.** Recommend: once per app, covering every instance of it. Per instance would ask again
  for each forum joined; the app's code is the same either way.
- **Q7. Hosting joined instances.** Recommend: never dropped automatically (an invite-only forum would be lost
  when its tab closes); online while used. Owned instances: always hosted, as own sites. Leave = the person's act.
- **Q8. Default privacy of a new instance.** Recommend: invite-only, with a "public" choice at creation (public is
  for good, hypergraph's rule).

## Complexity Tracking

None.
