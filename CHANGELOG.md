# Changelog

## [1.0.6] - 2026-07-03

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
