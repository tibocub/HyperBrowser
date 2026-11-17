# Feature Specification: 023 — Secure this place, Renew, Trim history

**Feature Branch**: `023-renew` · **Created**: 2026-11-17 · **Status**: Draft (grilled with Tibo, 2026-11-17) ·
**Needs**: hypergraph spec 027 (`specs/027-renew-space/build.md`)

## Requirements

- **FR-001** In a place's "…" menu (Chat conversations, Forum, circles where it applies), for owners and admins:
  **Secure this place…** (new keys now; a checkbox "also delete history before now", off by default, with a plain
  warning), **Trim history…** (keep the last N days / weeks / months / years, private and public places, with a
  warning that copies others already took can't be recalled). No new buttons in lists (Tibo's rule).
- **FR-002** After removing or banning someone, the app suggests **Secure this place** once (a notice with the
  action), dismissable.
- **FR-003** Links, bookmarks and open pages of a renewed place follow its "moved to" pointer by themselves; a removed
  person's app shows that they no longer have access (no new address).
- **FR-004** While renewing: a short progress line; errors in plain words (someone else renewed first: "already
  renewed by …").
- **FR-005** Pages (sites) get no new power: these are shell actions, or site calls behind the existing permission
  checks for owners/admins (the worker says which and why).
- **FR-006** Docs, regression tests (model, engine), the forum scenario tests, framecheck/selftest for the menus, perf.
