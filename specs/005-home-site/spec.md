# Feature Specification: 005 — the official site

**Feature Branch**: `005-home-site`

**Created**: 2026-11-07

**Status**: Built (text drafted, for Tibo to edit)

**Input**: lead session, 2026-11-07: build `sites/home`, HyperBrowser's official site (user docs and news), a
static hypersite in HyperMD, published in HyperBrowser and on GitHub Pages from one source; the look from
`docs/design-milestone-1.md` "Visual identity".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the docs in HyperBrowser (Priority: P1)

Someone opens the official site's key in HyperBrowser (or its preset icon on the desktop) and reads how to open
a site, use tabs and the desktop, install or bookmark, what "hosted" means, how to publish a site, and the news.

**Independent Test**: publish the built site on one engine; a second engine reads every page and file.

**Acceptance Scenarios**:

1. **Given** the built `sites/home` published, **When** another peer opens its key, **Then** it gets the
   manifest ("HyperBrowser", static) and every page and file, byte for byte.
2. **Given** the site on the desktop, **Then** it shows the site's own 1-bit icon (`site.json` `icon`).

### User Story 2 - The same site on the web (Priority: P1)

The same pages are on GitHub Pages, built by `hypermd build`, for people who don't have HyperBrowser yet.

**Acceptance Scenarios**:

1. **Given** `sites/home`, **When** built, **Then** every page builds and every link, anchor, stylesheet, font
   and image points at something in the built site.
2. **Given** a push to `main` touching `sites/home`, **Then** the workflow builds and deploys it (Tibo turns
   Pages on; not run yet).

### Edge Cases

- HyperBrowser doesn't render HyperMD itself: the built HTML is what is published (see plan).
- Links leaving the site (GitHub, nodejs.org) do nothing inside HyperBrowser (the sandbox keeps a site to its
  own key); on the web they work.
- Fractional screen scaling (125 %…) makes the 2 px dither show moiré, as on the shell's desktop.

## Requirements *(mandatory)*

- **FR-001**: Pages in HyperMD: home, Get started, Publish a site, News (one entry); a shared layout with the
  menu; text drafted from what is built (specs 001–003, `docs/shell.md`, the `publish` command); what isn't
  built is "coming" or left out.
- **FR-002**: Install and hosting as `004-hosting` makes them (installed: served even when closed; bookmark:
  served while open, plus a short time after). **Flagged for review**: the "Install or bookmark" and "What
  hosted means" sections of `start.hmd`, written before 004 lands.
- **FR-003**: The look: System 1 window per page, striped title bar, dithered desktop, box-drawing ToC,
  black and white plus one accent (`#1f4fd1`, the shell's), dark = swapped; Cozette for titles and the menu,
  IBM Plex Mono for text, bundled with their licences.
- **FR-004**: `site.json` with `entry: index.html` and a 32×32 1-bit `icon.svg`.
- **FR-005**: `npm run home:build`, `npm run home:publish`; `.github/workflows/pages.yml` for GitHub Pages.
- **FR-006**: Tests in `npm test` (Node and Bare): the build check (US2.1) and the two-peer load (US1.1).

## Success Criteria *(mandatory)*

- **SC-001**: Every page builds; no link or asset of the built site is missing.
- **SC-002**: A second peer reads every file of the published site.

## Assumptions

- The GitHub repo is `tibocub/HyperBrowser` and HyperMD is public at `tibocub/HyperMD` (the workflow checks it
  out). The pages link GitHub for the source code only.
- No script in the site yet: dark mode follows the system, no toggle.
- Screenshots (`screenshot-start-light.png`, `screenshot-start-dark.png`): Electron, the built page from disk,
  not inside the HyperBrowser window.
