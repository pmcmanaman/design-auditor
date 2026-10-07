<div align="center">

```
██████╗ ███████╗███████╗██╗ ██████╗ ███╗   ██╗
██╔══██╗██╔════╝██╔════╝██║██╔════╝ ████╗  ██║
██║  ██║█████╗  ███████╗██║██║  ███╗██╔██╗ ██║
██║  ██║██╔══╝  ╚════██║██║██║   ██║██║╚██╗██║
██████╔╝███████╗███████║██║╚██████╔╝██║ ╚████║
╚═════╝ ╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
          A U D I T O R
```

### Lighthouse for design consistency

**One command. 9 audit modules. A score from 0 to 100.**

[![npm version](https://img.shields.io/npm/v/design-auditor?color=6366f1&style=flat-square)](https://www.npmjs.com/package/design-auditor)
[![npm downloads](https://img.shields.io/npm/dm/design-auditor?color=6366f1&style=flat-square)](https://www.npmjs.com/package/design-auditor)
[![CI](https://img.shields.io/github/actions/workflow/status/PashaSchool/design-auditor/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/PashaSchool/design-auditor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/design-auditor?color=6366f1&style=flat-square)](LICENSE)
[![snyk](https://snyk.io/test/github/PashaSchool/design-auditor/badge.svg)](https://snyk.io/test/github/PashaSchool/design-auditor)
[![playwright](https://img.shields.io/badge/powered%20by-Playwright-45ba4b?style=flat-square)](https://playwright.dev)
[![website](https://img.shields.io/badge/docs-pashaschool.github.io%2Fdesign--auditor-FFE135?style=flat-square)](https://pashaschool.github.io/design-auditor/)

</div>

---

## What is this?

`design-auditor` opens any website in a real Chromium browser, inspects every element's computed styles, and scores design consistency across **9 modules** — typography, colors, spacing, components, readability, images, links, headings, and breakpoints.

```bash
npx design-auditor https://stripe.com
```

Think of it as **Lighthouse, but for your design system** — not performance, not SEO, but the visual coherence of your product.

| Tool               | What it checks                                            |
| ------------------ | --------------------------------------------------------- |
| **Lighthouse**     | Performance, SEO, best practices                          |
| **axe / WAVE**     | Accessibility compliance                                  |
| **Stylelint**      | CSS source code linting                                   |
| **design-auditor** | **Design system consistency** — the gap no one else fills |

---

## See it in action

![Design Auditor Preview](design-audit-preview.gif)

---

## Quick Start

```bash
# No installation needed
npx design-auditor https://stripe.com

# Audit only specific modules
npx design-auditor https://stripe.com --only colors,typography

# Local dev server
npx design-auditor http://localhost:3000 --local

# Save JSON report for CI
npx design-auditor https://stripe.com --save-report

# Signed-in app: log in once, then crawl and audit every page
npx design-auditor auth https://app.example.com/login
npx design-auditor https://app.example.com --crawl --storage-state .design-auditor/auth.json
```

---

## Scoring

Every audit produces a **weighted score from 0 to 100** with a letter grade:

```
┌──────────────────────────────────────────────────┐
│                DESIGN AUDIT SCORE                │
│                                                  │
│          72 / 100  —  Grade B (Good)             │
│                                                  │
│  Typography        ████████░░  82   (weight 15%) │
│  Colors            ██████░░░░  60   (weight 20%) │
│  Rhythm & Spacing  ████████░░  78   (weight 15%) │
│  Components        ██████░░░░  65   (weight 15%) │
│  Reading Width     █████████░  90   (weight 10%) │
│  Images            ████████░░  80   (weight 10%) │
│  Links             █████████░  85   (weight  5%) │
│  Headings          ██████████  100  (weight  5%) │
│  Breakpoints       ███████░░░  70   (weight  5%) │
└──────────────────────────────────────────────────┘
```

| Grade | Score  | Meaning                              |
| ----- | ------ | ------------------------------------ |
| **A** | 90-100 | Excellent — consistent design system |
| **B** | 75-89  | Good — minor inconsistencies         |
| **C** | 60-74  | Needs Work — visible design drift    |
| **D** | 40-59  | Poor — significant inconsistencies   |
| **F** | 0-39   | Critical — no design system detected |

Use `--save-report` to track your score over time and catch design drift in CI.

---

## 9 Audit Modules

### Typography `weight: 15%`

> _Good type is invisible. Bad type is everywhere._

- Font family count _(recommended: ≤ 3)_
- Unique font sizes and modular scale adherence
- Line-height consistency across text elements
- Outlier sizes that break the visual rhythm

### Colors `weight: 20%`

> _A brand is not a logo. It's a consistent palette._

- Unique color count across the entire page
- **Similar shade clustering** using delta-E color science
- Auto-detection of **primary / secondary / accent** colors by usage frequency
- **WCAG AA contrast** validation for all text/background pairs
- **CSS variable coverage** — are colors tokenized or hardcoded?

### Vertical Rhythm & Spacing `weight: 15%`

> _The baseline grid is the heartbeat of a layout._

- Rhythm unit detection `(font-size x line-height)`
- Line-heights as multiples of the rhythm unit
- **4px / 8px grid** adherence for margins and paddings
- Outlier spacing values like `13px`, `17px`, `22px`

### Components `weight: 15%`

> _Inconsistent buttons are a symptom of an inconsistent system._

- Touch target sizes _(minimum 44x44px per WCAG 2.5.5)_
- Button padding variations _(recommended: ≤ 3 sizes — sm/md/lg)_
- `:hover` and `:focus` interactive states
- Border-radius system _(recommended: ≤ 5 values)_
- Box-shadow elevation levels and light direction consistency
- Z-index organization and "magic numbers"

### Reading Width `weight: 10%`

> _If a line is too long, the reader's eye has a hard time finding the next line._

- Average line character count _(optimal: 45-75 characters)_
- Percentage of text blocks within optimal reading width
- Flags text containers that are too wide (>80 chars) or too narrow (<30 chars)

### Images `weight: 10%`

> _Every image without alt text is a door slammed on a screen reader user._

- Alt text coverage _(error if >30% missing)_
- Aspect ratio consistency _(recommended: ≤ 3 unique ratios)_
- Inconsistent ratios within component groups (e.g. cards with mixed image proportions)

### Links `weight: 5%`

> _A link distinguished only by color is invisible to 8% of men._

- **WCAG 1.4.1** — links must not rely on color alone (needs underline or other indicator)
- Link color consistency across the page
- `:visited` state defined
- `:focus` state for keyboard navigation _(WCAG 2.4.7)_

### Headings `weight: 5%`

> _Headings are the table of contents your DOM never knew it had._

- Exactly one `<h1>` per page
- Logical heading order (no skipped levels like H2 → H4)
- Visual size hierarchy — higher-level headings must appear larger
- Deep nesting warnings (excessive H5/H6 usage)

### Breakpoints `weight: 5%`

> _A responsive design without a breakpoint system is just a flexible mess._

- Known system detection (Bootstrap, Tailwind, etc.)
- Breakpoint count _(recommended: 4-6, error if >8)_
- Strategy check — mobile-first vs desktop-first vs mixed
- Non-standard breakpoint values

---

## Output

```
────────────────────────────────────────────────────────────
  TYPOGRAPHY
────────────────────────────────────────────────────────────
  ✅ Font families: 2 — OK
  ⚠️  Font sizes: 11 unique — recommended ≤ 8
     Found: 12px 14px 16px 18px 22px 24px 32px 40px 48px 56px 64px
  ❌ Line-heights: 22 unique — no vertical rhythm
     Too many line-height values — no baseline grid detected

  COLORS
────────────────────────────────────────────────────────────
  ❌ 54 unique colors found — recommended < 20
  ❌ 40 similar color pairs — palette can be consolidated
     ██ #f0f6fc ≈ ██ #f6f8fa (ΔE=2.6)
     ██ #24292f ≈ ██ #1f2328 (ΔE=2.9)
  ✅ Primary:   ██ #79c0ff  (262 uses)
  ✅ Secondary: ██ #59636e  (100 uses)
  ✅ Color balance: 63% / 24% / 2% — close to 60/30/10 rule

  COMPONENTS
────────────────────────────────────────────────────────────
  ❌ 28/50 buttons smaller than 44px touch target (56%)
     "Sign up" 101×32px, "Explore" 94×36px
  ⚠️  Buttons: 11 padding variations — recommended ≤ 3
  ✅ Interactive states: :hover and :focus present
  ❌ 12 unique border-radius values — recommended ≤ 5

────────────────────────────────────────────────────────────
  SCORE: 72 / 100 — Grade B (Good)
────────────────────────────────────────────────────────────
```

Every color is rendered as a **live color swatch** right in your terminal.

---

## How it works

```
URL  →  Playwright opens a real Chromium browser
         │
         ├── page.evaluate()  ←  runs inside the browser
         │   └── getComputedStyle() on every element
         │       returns actual rendered values
         │
         ├── 9 Extractors collect raw data
         │   ├── typography.ts     — fonts, sizes, line-heights
         │   ├── colors.ts         — delta-E clustering, WCAG contrast
         │   ├── rhythm.ts         — spacing, margins, grid detection
         │   ├── components.ts     — buttons, shadows, z-index
         │   ├── reading-width.ts  — line character counts
         │   ├── images.ts         — alt text, aspect ratios
         │   ├── links.ts          — states, color-only distinction
         │   ├── headings.ts       — hierarchy, visual sizing
         │   └── breakpoints.ts    — media query analysis
         │
         ├── Rules engine evaluates violations (pass / warn / error)
         │
         └── Score calculator → weighted 0-100 score + grade
```

**Unlike static CSS analysis**, `design-auditor` uses a real browser — so it sees computed styles, not source code. It catches values injected by JavaScript, CSS custom properties resolved at runtime, and styles applied by third-party scripts.

---

## Authenticated apps & crawling

Most design drift lives behind a login. `design-auditor` can sign in, crawl an application, run every audit module on each page, and then compare design values **across the whole app** to find the one heading, button or color that doesn't match the rest.

```
AUTHENTICATE → CRAWL → AUDIT EACH PAGE → COLLECT DESIGN VALUES → DETECT OUTLIERS → REPORT
```

### 1. Create an authentication state (interactive)

```bash
design-auditor auth https://app.example.com/login
```

A visible Chromium window opens. Log in as you normally would (SSO, MFA and CAPTCHAs all work, because you are the one typing). Then press **Enter** in the terminal. The session is saved as a Playwright storage state:

```
✔ Authentication state saved → /path/to/project/.design-auditor/auth.json
```

Options:

| Option                  | Default                     | Description                                                     |
| ----------------------- | --------------------------- | --------------------------------------------------------------- |
| `--output-state <path>` | `.design-auditor/auth.json` | Where to save the state                                         |
| `--wait-for-url <text>` | —                           | Finish automatically once the URL contains this text (no Enter) |
| `--timeout <seconds>`   | `600`                       | How long to wait for a manual login                             |
| `--config <path>`       | —                           | Use the form login from a config file instead (see below)       |

The state file holds **cookies, localStorage and sessionStorage**. Playwright's own storage state omits sessionStorage, which many single-page apps use for their session, so `design-auditor` saves it alongside and restores it before any page script runs.

### 2. Audit a signed-in page

```bash
design-auditor https://app.example.com/dashboard --storage-state .design-auditor/auth.json
```

Before auditing, every page is checked for signs that the session is not valid:

- a `401` / `403` response
- a redirect (server-side or client-side) to a login-like path such as `/login`, `/signin`, `/auth` or `/sso`, or to the configured `loginUrl`
- a redirect to another origin, such as an identity provider
- a redirect to a page with a visible password field
- a configured `auth.verify.selector` that is missing (useful for SPAs that render the login form without changing the URL)

If the start page fails these checks, the run stops instead of silently auditing the login screen:

```
Authentication state appears invalid or expired.
Run `design-auditor auth <login-url>` again or provide a valid --storage-state.
Reason: redirected to login page /login
```

### 3. Crawl the application

```bash
design-auditor https://app.example.com --crawl --storage-state .design-auditor/auth.json

# controlled crawl
design-auditor https://app.example.com --crawl \
  --max-pages 50 --max-depth 5 \
  --include "/dashboard/**" --exclude "/admin/**" \
  --storage-state .design-auditor/auth.json
```

The crawler is deliberately conservative:

- **GET navigations only.** It never clicks buttons and never submits forms.
- It discovers routes from rendered `<a href>` links, which includes navigation menus, sidebars and router links. Redirects are followed and recorded.
- It stays on the start URL's **origin**.
- URLs are normalized (fragments, trailing slashes, default ports and query order) and deduplicated, including redirect targets.
- It skips `mailto:`, `tel:`, `javascript:` and `data:` links, `download` links, and files (`.pdf`, `.csv`, images, archives…).
- It skips links whose URL, text, `aria-label` or `title` suggest a state change: **logout / sign out, delete, remove, destroy, unsubscribe, cancel account, terminate, revoke, deactivate**.
- It skips links to routes that may act just by loading, such as creating a draft, starting an AI job, or beginning an OAuth/connect flow. These are any path segment equal to `new`, `add`, `create`, `draft`, `wizard`, `authorize` or `oauth`, or starting with `generate`. Only whole segments count, so `/drafts` and `/news` are crawled. Seeds and the start URL you pass yourself still run.
- `--max-pages` (default **100**) and `--max-depth` (default **10**) bound the crawl and break infinite pagination.
- If several consecutive pages fail authentication mid-crawl, it stops, reports what it has, and exits with code 2.

Include/exclude globs match the URL path: `*` matches within one segment, `**` matches across segments, and `/admin/**` also matches `/admin` itself. Both options are repeatable and accept comma-separated lists. Exclude wins over include.

If parts of your app are only reachable through buttons with click handlers rather than real links, list them as extra entry points:

```bash
design-auditor https://app.example.com --crawl --seed /campaigns --seed /contacts,/reports
```

### 4. Automated login for CI (environment variables)

Credentials are **never** passed on the command line, where they would show up in process listings and shell history. Put the login steps in a JSON config file that references **environment variable names**:

```json
{
  "auth": {
    "type": "form",
    "loginUrl": "https://app.example.com/login",
    "username": {
      "selector": "input[name=\"email\"]",
      "env": "DESIGN_AUDITOR_USERNAME"
    },
    "password": {
      "selector": "input[name=\"password\"]",
      "env": "DESIGN_AUDITOR_PASSWORD"
    },
    "submit": { "selector": "button[type=\"submit\"]" },
    "success": { "urlContains": "/dashboard" },
    "verify": { "selector": "[data-testid=\"user-menu\"]" }
  },
  "crawl": {
    "maxPages": 100,
    "maxDepth": 10,
    "include": [],
    "exclude": ["/admin/**"],
    "seeds": []
  }
}
```

```bash
export DESIGN_AUDITOR_USERNAME=qa@example.com
export DESIGN_AUDITOR_PASSWORD=...        # from your CI secret store
design-auditor https://app.example.com --crawl --config design-auditor.config.json
```

- Selectors are [Playwright selectors](https://playwright.dev/docs/locators), so `button:has-text("Sign In")` works for forms without `name`/`id` attributes or with `type="button"` submit buttons.
- `next` (optional) is a selector clicked between the username and password steps, for two-step logins.
- `success` (optional) is `urlContains` and/or `selector`. Without it, the login is considered complete when the URL leaves the login page.
- `verify.selector` (optional) must exist on every authenticated page.
- The config refuses literal `value`s, tokens and cookies, so secrets can't end up in a committed file.
- To log in once and reuse the session: `design-auditor auth --config design-auditor.config.json`.

> Login forms protected by CAPTCHA or bot detection usually can't be automated. Use the interactive `auth` command and refresh the state file when it expires.

### Application-wide design consistency

During a run, every audited page also contributes computed style values (each with a CSS selector) to an application-wide analysis:

| Area           | Values collected                                                                 |
| -------------- | -------------------------------------------------------------------------------- |
| **Typography** | font family, size, weight, line height, letter spacing                           |
| **Spacing**    | margins, paddings, gaps, vertical and horizontal spacing                         |
| **Colors**     | text, background and border colors, normalized to hex (incl. `oklch()`, `lab()`) |
| **Components** | border radius, border width, box shadow, control heights                         |

Elements are also grouped by role so like is compared with like: H1/H2/H3, body text, labels, links, primary/secondary/danger/icon buttons, inputs, textareas, selects, cards/panels and navigation items.

Findings use three confidence levels. The thresholds favor few false positives over catching everything:

| Signal                                                                                     | Example                                       |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Group deviation**: ≥ 90% of a group agrees (high) or ≥ 75% (medium), the deviant is rare | 66 H2s use `18px / 600`, 1 uses `15px / 500`  |
| **Near-miss scale value**: rare and within ~1px of a token used ≥ 20× more, on ≤ 2 pages   | `font-size: 15px` ×1 next to `14px` ×235      |
| **Off-grid spacing**: ≥ 80% of spacing is on a 4px grid and this value isn't               | `padding-top: 18px` on an `8 / 16 / 24` scale |
| **Near-duplicate color**: ΔE ≤ 2.3 (high) or ≤ 5 (medium) from a color used ≥ 10× more     | `#3a82f6` ×1 vs `#3b82f6` ×80                 |
| **Browser-default font** among custom fonts                                                | `Times New Roman` in an `Inter` app           |

A frequently used value is treated as intentional (a "small" button variant is not a mistake), and an element explained by a group finding isn't reported again by the global checks. Terminal output shows high and medium findings (`--max-findings` per category). The JSON report includes everything, `info` included.

```
APPLICATION-WIDE DESIGN CONSISTENCY

── TYPOGRAPHY ──────────────────────────────────────────────
  HIGH    /settings/billing
    H2 headings (67 sampled)
    font-size / font-weight: 15px / 500  (1×)
    Comparable: 18px / 600  (66×)
    → [data-testid="billing-heading"] "Billing section"
    Possible typography inconsistency — comparable h2 headings use 18px / 600.

── COLORS ──────────────────────────────────────────────────
  HIGH    /settings/profile
    color: #3a82f6  (1×)
    Comparable: #3b82f6  (80×)
    → [data-testid="profile-hint"]
    Possible accidental near-duplicate color — use the existing token.
```

### CI example

```yaml
- run: npm ci && npx playwright install --with-deps chromium
- run: |
    npx design-auditor https://staging.example.com \
      --crawl --config design-auditor.config.json \
      --format json --output audit.json
  env:
    DESIGN_AUDITOR_USERNAME: ${{ secrets.DESIGN_AUDITOR_USERNAME }}
    DESIGN_AUDITOR_PASSWORD: ${{ secrets.DESIGN_AUDITOR_PASSWORD }}
- uses: actions/upload-artifact@v4
  with: { name: design-audit, path: audit.json }
```

Design findings don't fail the build unless you ask: add `--fail-on high` (or `medium`).

### Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | Audit completed                                                 |
| `1`  | Fatal error (bad arguments, invalid config, unexpected failure) |
| `2`  | Authentication failed, or the session expired mid-crawl         |
| `3`  | The start page could not be loaded, or no page could be audited |
| `4`  | `--fail-on` threshold reached                                   |

---

## Options

```bash
design-auditor <url> [options]
design-auditor auth [login-url] [options]
design-auditor report <json-file> [-o file.html]

Arguments:
  url                       Website URL to audit

Options:
  --only <modules>          Run specific modules only
                            Values: typography, colors, spacing, components,
                            reading-width, images, links, headings, breakpoints
  --save-report             Save full report as JSON file
  --local                   Optimize for local dev servers (disables networkidle)
  --storage-state <path>    Playwright storage state to audit as a signed-in user
  --config <path>           JSON config (form login via env vars, crawl settings)
  --crawl                   Follow same-origin links and audit every page found
  --max-pages <n>           Maximum pages to visit when crawling (default 100)
  --max-depth <n>           Maximum link depth when crawling (default 10)
  --include <glob>          Only crawl matching paths (repeatable, comma-separated)
  --exclude <glob>          Never crawl matching paths (repeatable, comma-separated)
  --seed <path>             Extra crawl entry point (repeatable, comma-separated)
  --format <format>         terminal (default), json or html
  --output <file>           Write the JSON/HTML report to a file
  --fail-on <confidence>    Exit 4 on consistency findings: high or medium
  --max-findings <n>        Consistency findings shown per category (default 10)
  --verbose                 Print full per-page module reports when crawling
  --snapshots               Save a static copy of each page (+ a fixed version with html)
  -V, --version             Show version number
  -h, --help                Show help
```

---

## HTML Report

For browsing a multi-page audit, write a single self-contained HTML file:

```bash
design-auditor https://app.example.com --crawl --storage-state .design-auditor/auth.json \
  --format html --output audit.html

# or render a JSON report you already have
design-auditor report audit.json            # → audit.html
```

### Fixed-page previews

Add `--snapshots` to keep a static copy of every audited page and generate a **fixed version** with the page's findings applied:

```bash
design-auditor https://app.example.com --crawl --storage-state .design-auditor/auth.json \
  --snapshots --format html --output audit/audit.html
```

```
audit/
  audit.html
  audit-pages/
    01-dashboard.html          static snapshot, as the crawler saw it
    01-dashboard.fixed.html    same page with high/medium findings applied
    …
```

Each page in `audit.html` gets **Open fixed version** and **Open snapshot** buttons, and each finding gets **Preview fix**, which jumps to the element. The fixed page has a small toolbar: **Fixes on/off** switches between the original and corrected look, **Highlight** outlines the changed elements, and the list of applied fixes scrolls to each one. Open the live site next to it to compare.

Fixes are CSS overrides on the exact element that was measured:

- group typography sets the group's size and weight
- radius, padding, border width, shadow and height take the group's common value
- spacing outliers change only the side that carried the odd value
- near-duplicate colors switch to the common color
- a browser-default font gets the app's font

Palette-level problems, like two gray scales, aren't auto-fixed.

Snapshots are static. App scripts, frames and event handlers are removed, and a CSP blocks network calls and form submissions. Password, hidden-input and CSRF values are stripped, but everything visible on the page is kept, including customer data. The snapshot folder gets a `*` `.gitignore`, files are written `0600`, and they should be handled like screenshots of the app. Images and fonts still load from the live site when you're online. Content that needs a login or a hover state may not appear.

`--snapshots` also works with `--format json`. `design-auditor report audit.json` then generates the fixed versions and links them.

The page has filterable, searchable consistency findings with color swatches and click-to-copy selectors. It also groups recurring module issues across pages, shows per-page reports and score bars, charts the design values in use, and lists the links the crawler skipped. It works offline and makes no network requests, enforced with a Content-Security-Policy. All text from the audited site is escaped. The report can contain page text from the audited application, so share it the way you would share screenshots of that app.

---

## JSON Report

With `--save-report`, the full audit is saved as structured JSON — perfect for CI pipelines, dashboards, or tracking design drift over time.

```json
{
  "url": "https://stripe.com",
  "date": "2026-02-27T10:00:00.000Z",
  "score": {
    "overall": 72,
    "grade": "B",
    "label": "Good"
  },
  "summary": {
    "pass": 7,
    "warn": 5,
    "error": 3
  },
  "modules": [
    {
      "name": "Colors",
      "score": 60,
      "weight": 20,
      "violations": [
        {
          "id": "too-many-colors",
          "severity": "error",
          "message": "54 unique colors found — recommended < 20",
          "hint": "A large palette makes maintenance harder..."
        }
      ]
    }
  ]
}
```

Every report also includes `pages`, `crawl` and `globalAnalysis`. These fields are added alongside the existing ones, so consumers of the single-page format keep working. The top-level `score`/`summary`/`modules` describe the first audited page.

```json
{
  "url": "https://app.example.com/",
  "score": {},
  "summary": {},
  "modules": [],
  "pages": [
    {
      "url": "https://app.example.com/settings/billing",
      "finalUrl": "https://app.example.com/settings/billing",
      "title": "Billing",
      "depth": 1,
      "referrer": "https://app.example.com/dashboard",
      "status": 200,
      "outcome": "audited",
      "score": {},
      "summary": {},
      "modules": []
    }
  ],
  "crawl": {
    "enabled": true,
    "maxPages": 100,
    "maxDepth": 10,
    "visited": 37,
    "audited": 35,
    "averageScore": 78,
    "skipped": [{ "url": "https://app.example.com/logout", "reason": "unsafe" }]
  },
  "globalAnalysis": {
    "pageCount": 35,
    "typography": {
      "fontSizes": [{ "value": "14px", "count": 1826, "pages": 35 }]
    },
    "spacing": { "paddings": [] },
    "colors": { "text": [] },
    "components": { "distributions": {}, "groups": {} },
    "outliers": [
      {
        "category": "typography",
        "confidence": "high",
        "group": "h2",
        "property": "font-size / font-weight",
        "value": "15px / 500",
        "count": 1,
        "dominant": { "value": "18px / 600", "count": 66 },
        "pages": ["https://app.example.com/settings/billing"],
        "examples": [
          {
            "url": "https://app.example.com/settings/billing",
            "selector": "[data-testid=\"billing-heading\"]",
            "text": "Billing section"
          }
        ],
        "reason": "H2 headings: 66 use 18px / 600, 1 uses 15px / 500",
        "suggestion": "Possible typography inconsistency — comparable h2 headings use 18px / 600."
      }
    ]
  }
}
```

Page `outcome` is one of `audited`, `discovery-only` (start page outside `--include`), `duplicate` (redirected to an already-visited page), `off-origin`, `auth-failed` or `nav-failed`.

---

## Design philosophy

> **A design system is a set of constraints. Audit tools should enforce them.**

Most automated tools check if your site _works_ (Lighthouse) or if it's _accessible_ (axe). `design-auditor` checks if your site is _consistent_ — the thing that's hardest to maintain as teams grow.

Based on established standards:

- [WCAG 2.1 / 2.5.5](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) — touch targets, contrast ratios, link distinction
- [8-Point Grid System](https://spec.fm/specifics/8-pt-grid) — spacing consistency
- [Modular Scale](https://www.modularscale.com/) — typographic hierarchy
- [CIE delta-E](http://www.brucelindbloom.com/index.html?Eqn_DeltaE_CIE76.html) — perceptual color similarity
- [60-30-10 rule](https://www.interaction-design.org/literature/article/ui-color-palette) — color balance

---

## Installation

```bash
# Run without installing
npx design-auditor https://stripe.com

# Or install globally
npm install -g design-auditor
design-auditor https://stripe.com
```

**Requirements:** Node.js 20+

---

## Contributing

Contributions are welcome! Whether it's a bug fix, a new audit rule, or an improvement to an existing module — open an issue or submit a PR.

```bash
git clone https://github.com/PashaSchool/design-auditor.git
cd design-auditor
npm install
npx playwright install chromium
npm run dev -- https://example.com
```

See [open issues](https://github.com/PashaSchool/design-auditor/issues) for ideas on where to start.

---

## Limitations

- Without `--crawl`, only the page at the given URL is audited
- The crawler follows links only. Routes reachable solely through click handlers need `--seed`, and nothing behind modals, tabs or forms is explored
- Semantic grouping (button variants, cards…) is heuristic, based on tags, roles, class names and backgrounds
- Pages are crawled one at a time in a single browser tab
- JavaScript-heavy SPAs may need a few seconds to fully render — use `--local` for dev servers
- Media query analysis reads CSS source rules; dynamically injected media queries may be missed
- Color extraction uses computed styles — colors set via `canvas`, `svg`, or `background-image` gradients are not captured
- Contrast checking covers text on elements with an explicit background color; text over inherited/transparent backgrounds or images is skipped

---

## Security

[![snyk](https://snyk.io/test/github/PashaSchool/design-auditor/badge.svg)](https://snyk.io/test/github/PashaSchool/design-auditor)

All dependencies are continuously scanned for vulnerabilities using **Snyk**.

### Handling authentication state

- **A saved storage state is a live session credential.** Anyone with `auth.json` can act as that user until the session expires. Treat it like a password.
- **Never commit it.** `design-auditor auth` writes the file with owner-only permissions (`0600`), and when it writes into `.design-auditor/` it adds a `.gitignore` there containing `*`. Also add these to your project's `.gitignore`:

  ```gitignore
  .design-auditor/
  auth.json
  ```

- Use a **dedicated test account** with the least privileges that can still see the pages you want audited. Prefer staging over production.
- Credentials for automated login come **only from environment variables**. They are never accepted as CLI arguments or config values, never written to disk, and redacted from error messages.
- Cookie, token and storage values are never printed. Errors about state files name the file, never its contents.
- Everything runs locally. Authentication state and page content are never sent anywhere except the site being audited.
- The crawler only follows links and skips logout/destructive-looking ones, but no heuristic is perfect. Point it at an account whose data you can afford to have viewed, and use `--exclude` for sensitive areas.

---

## License

MIT — use it, fork it, build on it.

---

<div align="center">

Built with care for designers who care about consistency.

[Read the story behind design-auditor on dev.to](https://dev.to/__aa5b04f75e3a/i-built-a-cli-that-catches-design-inconsistencies-like-lighthouse-but-for-your-design-system-nc7)

</div>
