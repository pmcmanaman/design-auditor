# Changelog

## [Unreleased]

### Added

- **Authenticated auditing**: `--storage-state <file>` audits pages as a signed-in user. Every page is checked for login redirects, 401/403, identity-provider hops and an optional `auth.verify.selector`. Expired sessions fail with exit code 2 instead of auditing the login screen
- **`design-auditor auth [login-url]`**: interactive headed login that saves a Playwright storage state (0600, plus a `*` .gitignore in `.design-auditor/`). sessionStorage is saved and restored too, for SPAs that keep their session there
- **Form login for CI** via `--config` (JSON). Credentials come only from environment variables, with optional two-step `next` and `success` / `verify` conditions
- **Crawling**: `--crawl`, `--max-pages` (100), `--max-depth` (10), `--include`/`--exclude` globs and `--seed` entry points. Same-origin GET navigations only; logout/delete/revoke-style links, downloads, files and non-http schemes are skipped
- **Application-wide design consistency**: cross-page distributions for typography, spacing, colors and components, with high/medium/info outliers. Covers near-miss scale values, off-grid spacing, near-duplicate colors, browser-default fonts and deviations within semantic groups (headings, button variants, inputs, cards, nav items), each reported with selectors
- `--format json|html`, `--output <file>`, `--fail-on high|medium`, `--max-findings`, `--verbose`
- **Fixed-page previews** (`--snapshots`): static, script-free copies of every audited page, plus a version with the page's findings applied as CSS overrides on the exact measured elements. The fixed version has a toolbar to switch fixes on/off and highlight changes. They're linked from the HTML report ("Open fixed version", "Preview fix")
- **HTML report**: self-contained, offline page with filterable findings, recurring issues, per-page reports and design-value charts. `design-auditor report <json>` renders an existing JSON report
- Exit codes: 2 auth failure, 3 navigation failure, 4 `--fail-on` threshold

### Fixed

- Breakpoints: Media Queries 4 range syntax (`(width>=48rem)`, `(48rem <= width)`, `not all and (…)`) is recognized. Tailwind v4 sites were reported as having no media queries

### Changed

- JSON reports gain `pages`, `crawl` and `globalAnalysis`. Existing top-level fields are unchanged
- Single-page audits now exit with code 3 when the page responds with HTTP 4xx/5xx or cannot be loaded
- The single-page audit logic moved into a reusable `auditPage(page, modules)`. Terminal output is unchanged

## [1.1.0] - 2026-07-03

### Changed

- **Requires Node.js 20+** (was 18+). Node 18 reached end-of-life in April 2025 and current dev tooling no longer supports it
- Bumped dev dependencies (vite/vitest) to fix `npm audit` findings

### Fixed

- **Restored the six fixes listed under 1.0.1** — they were documented but lost during a merge and never actually landed in the published code (verified via `git log -S` across all branches):
  - Links extractor: duplicate `:visited` condition; now also matches `.class:visited`, not only the literal `a:visited`
  - Colors extractor: CSS variable coverage scanned inline styles only and reported ~0% on every site; now scans raw `CSSStyleRule` declarations across all stylesheets
  - Typography rules: added `pass` violation for the modular scale check
  - Typography extractor: skip `display:none` / `visibility:hidden` elements
  - Reading width: removed layout containers (`article`, `section`, `main`) from text tags
  - Breakpoints extractor: `matchAll()` captures both values in combined queries like `(min-width: X) and (max-width: Y)`; breakpoint type is stored per match instead of re-derived from the query string
- `--only <modules>` flag was documented but not implemented — now actually filters which audit modules run
- `--version` reported a hardcoded `0.1.0`; now reads the version from package.json
- CLI exits with code 1 on failure (previously always 0, breaking CI usage)
- Components extractor: stylesheet scan for `:hover`/`:focus`/`:disabled` ran once per button (O(buttons × rules)); now runs once per page
- Breakpoints extractor: media queries nested inside `@supports` / `@layer` are now discovered
- Headings: adjacent levels with the _same_ font size now produce a warning instead of a "broken hierarchy" error (strict inversions remain errors)

## [1.0.1] - 2026-03-06

### Fixed

- Links rule: duplicate `:visited` condition
- Colors extractor: CSS variable coverage now scans `CSSStyleRule.style.getPropertyValue()` across all stylesheets
- Typography rules: added `pass` violation for modular scale check
- Typography extractor: filter out `display:none` / `visibility:hidden` elements
- Reading width: removed `section` and `main` from text tags (layout containers caused false positives)
- Breakpoints extractor: use `matchAll()` to capture both values in complex queries

### Added

- Test suite with Vitest (unit + rule tests)
- CI workflow (build, format, test on Node 18/20/22)
- CONTRIBUTING.md

## [1.0.0] - 2026-02-27

### Added

- Initial release
- 9 audit modules: typography, colors, vertical rhythm, components, reading width, images, links, breakpoints, headings
- Terminal reporter with color swatches
- JSON report export (`--save-report`)
- Module filtering (`--only`)
- Weighted scoring system (A-F grades)
- WCAG contrast checking (AA)
- Delta-E color clustering
- Modular scale detection
- 4px/8px grid detection
- Known breakpoint system detection (Tailwind, Bootstrap, etc.)
