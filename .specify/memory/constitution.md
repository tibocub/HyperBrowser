<!--
Sync Impact Report
Version: 1.0.0 (first ratification)
Adapted from hypergraph's constitution 1.1.0 and SwarmFS's 1.2.0 for the app that uses them.
Templates: none to edit (copied from hypergraph; the plan's Constitution Check reads this file).
-->

# HyperBrowser Constitution

## Core Principles

### I. Sites Are Strangers (NON-NEGOTIABLE)

A site's code runs only in a sandboxed web view, one per site: no Node, no file system, no other
site's data, no web. It never runs in the engine and never reaches the engine's stream: only the
shell bridges a site to the engine, and the shell names the site itself (from the view), never from
the page's message. A site reaches its own space only; anything more (the person's identity, files,
friends) asks the person, per site, remembered. Every guard has a test that fails when the guard is
turned off (a sandbox test needs a control run).
Rationale: HyperBrowser runs code from anyone; one hole and every site the person visits can read
the others.

### II. Test-First for the Engine and the Protocol (NON-NEGOTIABLE)

The engine, its message protocol and the site API are written test-first (`brittle`), through their
public entry points (`start(ipc)` and messages), with real hypergraph and SwarmFS instances on a local
DHT (`hypergraph/testing`). Every bug fix and behavior change adds or updates a test that fails before
and passes after, in the same change. The shell's guards are tested by the sandbox self-test and its
control run.
Rationale: the engine is the part that holds the person's identity and every site's data.

### III. Node and Bare, Desktop and Mobile

The engine is a worker with one entry, `start(ipc)`, over a duplex byte stream: Bare modules only
(Node built-ins only through the `imports` map to `bare-*`, no `Buffer`, no `process` global), no
Electron or Pear calls, config by messages, never env or globals. Its tests run on Node and on Bare.
The protocol is versioned and framed, the same file on both sides. Site views sit behind one shell
interface, so mobile can use a native WebView later. Code stays platform-neutral: Windows and Linux
are both targets, and their commands are documented.
Rationale: the milestone-1 design's mobile-ready boundary (react-native-bare-kit runs the same engine).

### IV. Compose, Don't Reimplement

HyperBrowser composes hypergraph (`hypergraph/next`: identity, spaces, `hg.scope`), SwarmFS (a site's
files) and Pear (`pear-runtime`: the shell, updates). It has no replication, cryptography, storage
or permission code of its own. They are consumed as `file:../hypergraph` and `file:../SwarmFS` and
never edited from here: what they lack goes into `specs/requests-to-hypergraph.md` or
`specs/requests-to-swarmfs.md`, with why, and is not worked around.
Rationale: the libraries get better where the gap is; the app stays small.

### V. Smallest Complete Design

Build the smallest thing that fully does the job (ponytail): no speculative options, layers or
features. A later need is kept possible by naming it in the spec, not by building for it. What can't
change later (the protocol's messages once released, `site.json`'s fields) is decided carefully and
versioned.
Rationale: one person plus AI sessions must hold the whole project in their head.

## Documentation & the Repo as Memory

Every decision lands in a file (a spec, a plan, `docs/`, this constitution), never only in a
conversation. `specs/<feature>/` (spec → plan → tasks) is the source of truth for new work; direction
across projects lives in hypergraph's `ROADMAP.md`. Docs and regression tests change in the same change
as the behavior they describe; user docs are drafted as each feature lands.

## Governance

This constitution supersedes ad hoc practice. Amendments go through `/speckit-constitution` with
semantic versioning (MAJOR: a principle removed or redefined; MINOR: one added or expanded; PATCH:
wording). Every `/speckit-plan` passes the Constitution Check against this file before research and
again after design. Work merges only after a review in the lead conversation; Tibo pushes.

**Version**: 1.0.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-07
