# Feature Specification: 021 — storage numbers in Members

**Feature Branch**: `021-storage-numbers` · **Created**: 2026-11-17 · **Status**: Draft (grilled with Tibo, 2026-11-17)
· **Needs**: hypergraph spec 026 (holders report `share` and `used`)

## Requirements

- **FR-001** A circle's Members list shows, for each person who holds, what they hold out of their share, e.g.
  `0.8/3 GB` (one decimal; under 0.1 GB: `<0.1`); nothing for someone who doesn't hold or hasn't reported yet. It is
  across all their circles (a share is one budget per device): the row's tooltip says so.
- **FR-002** Under the list, a `TOTAL` line: the circle's room after its 5 copies, e.g. `TOTAL ≈ 4.2 GB`
  (hypergraph 026's `total`), with a tooltip "everyone's shares ÷ 5 copies; approximate: shares also serve other
  circles".
- **FR-003** The join notice (018) adds that members see each device's share and how much it holds.
- **FR-004** No layout shift: the numbers fit the existing row (Tibo's rule against cluttered lists: no new button).
- **FR-005** Docs (`docs/`), a regression test (model: the formatting and TOTAL), the self-test or sandbox check of the
  Members window, forum scenario tests untouched unless affected, perf (`perf:circles`) rerun.

## Not covered

Online percentages per member (later, after hypergraph 025). Per-circle use.
