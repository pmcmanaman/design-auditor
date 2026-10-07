import type { AppJsonReport, JsonReport, PageJson } from '@reporters/json.js';
import type { ModuleReport, Violation } from '@/types.js';
import type { PageLinks } from '@reporters/snapshots.js';
import { fixAnchor } from '@reporters/fixes.js';

type Links = Map<string, PageLinks>;

// Self-contained HTML report: inline CSS/JS, no external requests, so it can
// be opened offline and never leaks audit data. Everything that comes from
// the audited site (titles, text, selectors, URLs) is escaped.

type Finding = AppJsonReport['globalAnalysis']['outliers'][number];
type ValueCount = { value: string; count: number; pages: number };

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const IS_HEX = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

// escaped text with a color swatch in front of every hex value
function withSwatches(text: string): string {
  return esc(text).replace(
    HEX,
    (hex) =>
      `<span class="sw" style="background:${hex}"></span><code>${hex}</code>`
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? esc(url) : '#';
}

function scoreClass(score: number): string {
  if (score >= 90) return 's-a';
  if (score >= 75) return 's-b';
  if (score >= 60) return 's-c';
  if (score >= 40) return 's-d';
  return 's-f';
}

function count(
  reports: ModuleReport[] | undefined,
  sev: Violation['severity']
) {
  return (reports ?? []).reduce(
    (n, m) => n + m.violations.filter((v) => v.severity === sev).length,
    0
  );
}

// Accept older single-page reports too
function normalize(report: JsonReport | AppJsonReport): AppJsonReport {
  const app = report as Partial<AppJsonReport>;
  if (app.pages && app.globalAnalysis) return report as AppJsonReport;
  const page: PageJson = {
    url: report.url,
    finalUrl: report.url,
    title: '',
    depth: 0,
    referrer: null,
    status: null,
    outcome: 'audited',
    score: report.score,
    summary: report.summary,
    modules: report.modules,
  };
  return {
    ...report,
    pages: [page],
    crawl: {
      enabled: false,
      maxPages: 1,
      maxDepth: 0,
      include: [],
      exclude: [],
      visited: 1,
      audited: 1,
      averageScore: report.score.overall,
      unvisited: 0,
      skipped: [],
    },
    globalAnalysis: {
      pageCount: 1,
      typography: {},
      spacing: {},
      colors: {},
      components: { distributions: {}, groups: {} },
      outliers: [],
    },
  };
}

// ─── Sections ─────────────────────────────────────────────────────────────────

// relative file link from audit.html; encodes each path segment
function fileHref(rel: string, anchor = ''): string {
  return esc(
    rel.split('/').map(encodeURIComponent).join('/') +
      (anchor ? `#${anchor}` : '')
  );
}

function previewLink(f: Finding, links: Links): string {
  const anchor = fixAnchor(f.id);
  for (const page of f.pages) {
    const l = links.get(page);
    if (l && l.anchors.has(anchor)) {
      return `<a class="btn" href="${fileHref(l.fixed, anchor)}" target="_blank" rel="noopener">Preview fix</a>`;
    }
  }
  return '';
}

function findingCard(f: Finding, links: Links): string {
  const where =
    f.pages.length === 1
      ? `<a href="${safeHref(f.pages[0])}" target="_blank" rel="noopener noreferrer">${esc(pathOf(f.pages[0]))}</a>`
      : `${f.pages.length} pages`;
  const group = f.group
    ? `<div class="muted">${esc(f.group)} · ${esc(f.groupSize)} sampled</div>`
    : '';
  const examples = f.examples
    .map(
      (e) => `<li>
        ${f.pages.length > 1 ? `<span class="muted">${esc(pathOf(e.url))}</span> ` : ''}
        <code class="sel" title="Click to copy">${esc(e.selector)}</code>
        ${e.text ? `<span class="muted">“${esc(e.text)}”</span>` : ''}
      </li>`
    )
    .join('');
  const search = [
    f.property,
    f.value,
    f.reason,
    f.group,
    ...f.pages,
    ...f.examples.map((e) => e.selector + ' ' + (e.text ?? '')),
  ]
    .join(' ')
    .toLowerCase();

  return `<article class="finding" data-confidence="${esc(f.confidence)}" data-category="${esc(f.category)}" data-search="${esc(search)}">
    <header>
      <span class="badge b-${esc(f.confidence)}">${esc(f.confidence)}</span>
      <span class="cat">${esc(f.category)}</span>
      <span class="where">${where}</span>
    </header>
    ${group}
    <div class="value"><span class="muted">${esc(f.property)}:</span> ${withSwatches(f.value)} <span class="muted">×${esc(f.count)}</span></div>
    ${f.dominant ? `<div class="value"><span class="muted">comparable:</span> ${withSwatches(f.dominant.value)} <span class="muted">×${esc(f.dominant.count)}</span></div>` : ''}
    <ul class="examples">${examples}</ul>
    <p class="reason">${withSwatches(f.reason)}</p>
    <p class="suggest">${esc(f.suggestion)}</p>
    ${previewLink(f, links)}
  </article>`;
}

function findingsSection(findings: Finding[], links: Links): string {
  const categories = [...new Set(findings.map((f) => f.category))];
  const n = (c: string) => findings.filter((f) => f.confidence === c).length;
  if (findings.length === 0) {
    return `<section id="findings"><h2>Consistency findings</h2><p class="muted">No application-wide outliers were found.</p></section>`;
  }
  return `<section id="findings">
    <h2>Consistency findings</h2>
    <div class="filters" role="group" aria-label="Filter findings">
      <label><input type="checkbox" data-filter="confidence" value="high" checked> High (${n('high')})</label>
      <label><input type="checkbox" data-filter="confidence" value="medium" checked> Medium (${n('medium')})</label>
      <label><input type="checkbox" data-filter="confidence" value="info"> Info (${n('info')})</label>
      <span class="sep"></span>
      ${categories
        .map(
          (c) =>
            `<label><input type="checkbox" data-filter="category" value="${esc(c)}" checked> ${esc(c)}</label>`
        )
        .join('')}
      <input type="search" id="q" placeholder="Search selector, page, value…" aria-label="Search findings">
    </div>
    <p class="muted" id="shown"></p>
    <div class="grid">${findings.map((f) => findingCard(f, links)).join('')}</div>
  </section>`;
}

function violationList(modules: ModuleReport[]): string {
  return modules
    .map((m) => {
      const issues = m.violations.filter((v) => v.severity !== 'pass');
      const passes = m.violations.filter((v) => v.severity === 'pass');
      const item = (v: Violation) =>
        `<li class="v-${esc(v.severity)}"><span class="icon" aria-hidden="true"></span><div>${withSwatches(v.message)}${v.hint ? `<div class="muted">${withSwatches(v.hint)}</div>` : ''}</div></li>`;
      return `<div class="module"><h4>${esc(m.name)}</h4><ul class="violations">${[
        ...issues.filter((v) => v.severity === 'error'),
        ...issues.filter((v) => v.severity === 'warn'),
      ]
        .map(item)
        .join(
          ''
        )}</ul>${passes.length ? `<details class="passes"><summary>${passes.length} passed</summary><ul class="violations">${passes.map(item).join('')}</ul></details>` : ''}</div>`;
    })
    .join('');
}

function pageButtons(p: PageJson, links: Links): string {
  // duplicates share the final URL with the audited row; only that one links
  const l = p.modules ? links.get(p.finalUrl) : undefined;
  if (!l) return '';
  return `<div class="page-actions">
    <a class="btn primary" href="${fileHref(l.fixed)}" target="_blank" rel="noopener">Open fixed version (${l.fixCount} ${l.fixCount === 1 ? 'fix' : 'fixes'})</a>
    <a class="btn" href="${fileHref(l.snapshot)}" target="_blank" rel="noopener">Open snapshot</a>
    <span class="muted">Static copies captured during the crawl. Use the toolbar in the fixed version to switch fixes on and off.</span>
  </div>`;
}

function pagesSection(pages: PageJson[], links: Links): string {
  // audited pages first (crawl order), then duplicates/failures
  const ordered = [
    ...pages.filter((p) => p.modules),
    ...pages.filter((p) => !p.modules),
  ];
  const rows = ordered
    .map((p) => {
      const audited = !!p.modules;
      // unaudited rows show what was requested (e.g. "/" → duplicate of /dashboard)
      const shownUrl = audited ? p.finalUrl : p.url;
      const score = p.score?.overall;
      return `<details class="page" ${pages.length === 1 ? 'open' : ''}>
        <summary>
          <span class="path"><a href="${safeHref(shownUrl)}" target="_blank" rel="noopener noreferrer">${esc(pathOf(shownUrl))}</a>
          ${p.title ? `<span class="muted">${esc(p.title)}</span>` : ''}</span>
          ${
            audited && score !== undefined
              ? `<span class="bar"><span class="${scoreClass(score)}" style="width:${score}%"></span></span>
                 <span class="score ${scoreClass(score)}-t">${score}</span>
                 <span class="counts"><span class="c-err">${count(p.modules, 'error')} errors</span> <span class="c-warn">${count(p.modules, 'warn')} warnings</span></span>`
              : `<span class="outcome">${esc(p.outcome)}${p.outcome === 'duplicate' ? ` of ${esc(pathOf(p.finalUrl))}` : ''}${p.error ? ` — ${esc(p.error)}` : ''}</span>`
          }
        </summary>
        ${pageButtons(p, links)}
        ${audited ? `<div class="modules">${violationList(p.modules!)}</div>` : ''}
        <div class="muted meta">depth ${esc(p.depth)}${p.referrer ? ` · from ${esc(pathOf(p.referrer))}` : ''}${p.status ? ` · HTTP ${esc(p.status)}` : ''}${audited && p.url !== p.finalUrl ? ` · requested ${esc(pathOf(p.url))}` : ''}</div>
      </details>`;
    })
    .join('');
  const hint =
    links.size === 0 && ordered.some((p) => p.modules)
      ? `<p class="muted">Run with <code>--snapshots</code> to get a static copy of each page plus a version with the findings applied, linked from here.</p>`
      : '';
  return `<section id="pages"><h2>Pages</h2>${hint}${rows}</section>`;
}

// Same issue on many pages, grouped by message shape ("15/27 buttons…")
function recurringSection(pages: PageJson[]): string {
  const audited = pages.filter((p) => p.modules);
  if (audited.length < 2) return '';
  const groups = new Map<
    string,
    { severity: string; module: string; example: string; pages: string[] }
  >();
  for (const p of audited) {
    for (const m of p.modules!) {
      for (const v of m.violations) {
        if (v.severity === 'pass') continue;
        const key = `${v.severity}|${m.name}|${v.message.replace(/#[0-9a-f]{3,8}|\d+(\.\d+)?/gi, 'N')}`;
        const g = groups.get(key) ?? {
          severity: v.severity,
          module: m.name,
          example: v.message,
          pages: [],
        };
        g.pages.push(pathOf(p.finalUrl));
        groups.set(key, g);
      }
    }
  }
  const rows = [...groups.values()]
    .sort(
      (a, b) =>
        b.pages.length - a.pages.length || a.severity.localeCompare(b.severity)
    )
    .map(
      (g) => `<tr>
        <td><span class="badge b-${g.severity === 'error' ? 'high' : 'medium'}">${esc(g.severity)}</span></td>
        <td>${esc(g.module)}</td>
        <td>${withSwatches(g.example)}</td>
        <td class="num" title="${esc(g.pages.join('\n'))}">${g.pages.length}/${audited.length}</td>
      </tr>`
    )
    .join('');
  return `<section id="recurring"><h2>Recurring page issues</h2>
    <p class="muted">Existing module findings grouped across pages. The example message comes from one page; hover the count to see which pages.</p>
    <div class="table-wrap"><table><thead><tr><th>Severity</th><th>Module</th><th>Example</th><th class="num">Pages</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function distribution(
  title: string,
  values: ValueCount[] | undefined,
  color = false
): string {
  if (!values || values.length === 0) return '';
  const max = Math.max(...values.map((v) => v.count));
  const items = values
    .slice(0, 14)
    .map(
      (v) => `<li>
        <span class="label">${color ? `<span class="sw" style="background:${IS_HEX.test(v.value) ? v.value : 'transparent'}"></span>` : ''}<code title="${esc(v.value)}">${esc(v.value)}</code></span>
        <span class="track"><span style="width:${Math.max(2, (v.count / max) * 100)}%"></span></span>
        <span class="num">${v.count}<span class="muted"> · ${v.pages}p</span></span>
      </li>`
    )
    .join('');
  return `<div class="dist"><h4>${esc(title)}</h4><ul>${items}</ul></div>`;
}

function tokensSection(g: AppJsonReport['globalAnalysis']): string {
  const t = g.typography ?? {};
  const s = g.spacing ?? {};
  const c = g.colors ?? {};
  const d = g.components?.distributions ?? {};
  const groups = Object.entries(g.components?.groups ?? {})
    .sort((a, b) => b[1].samples - a[1].samples)
    .map(
      ([name, v]) =>
        `<tr><td>${esc(name)}</td><td class="num">${v.samples}</td><td>${v.typography
          .slice(0, 4)
          .map(
            (x) =>
              `<code>${esc(x.value)}</code> <span class="muted">×${x.count}</span>`
          )
          .join(', ')}</td></tr>`
    )
    .join('');
  const html = [
    distribution('Font sizes', t.fontSizes),
    distribution('Font weights', t.fontWeights),
    distribution('Line heights', t.lineHeights),
    distribution('Font families', t.fontFamilies),
    distribution('Text colors', c.text, true),
    distribution('Background colors', c.background, true),
    distribution('Border colors', c.border, true),
    distribution('Paddings', s.paddings),
    distribution('Gaps', s.gaps),
    distribution('Margins', s.margins),
    distribution('Border radius', d.borderRadius),
    distribution('Border width', d.borderWidth),
  ].join('');
  if (!html && !groups) return '';
  return `<section id="tokens"><h2>Design values in use</h2>
    <p class="muted">Counts across all audited pages (· Np = number of pages using the value).</p>
    <div class="dists">${html}</div>
    ${groups ? `<h3>Component groups</h3><div class="table-wrap"><table><thead><tr><th>Group</th><th class="num">Samples</th><th>Most common size / weight</th></tr></thead><tbody>${groups}</tbody></table></div>` : ''}
  </section>`;
}

function crawlSection(r: AppJsonReport): string {
  if (!r.crawl.enabled) return '';
  const byReason = new Map<string, string[]>();
  for (const s of r.crawl.skipped) {
    byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.url]);
  }
  const skipped = [...byReason]
    .map(
      ([reason, urls]) =>
        `<details><summary><strong>${esc(reason)}</strong> <span class="muted">${urls.length}</span></summary><ul class="plain">${urls
          .map((u) => `<li><code>${esc(u)}</code></li>`)
          .join('')}</ul></details>`
    )
    .join('');
  return `<section id="crawl"><h2>Crawl</h2>
    <p>${r.crawl.visited} visited · ${r.crawl.audited} audited · max ${r.crawl.maxPages} pages / depth ${r.crawl.maxDepth}${r.crawl.unvisited ? ` · <strong>${r.crawl.unvisited} discovered pages not visited (page limit)</strong>` : ''}</p>
    ${r.crawl.aborted ? `<p class="c-err">${esc(r.crawl.aborted)}</p>` : ''}
    ${r.crawl.include.length ? `<p class="muted">include: ${r.crawl.include.map((p) => `<code>${esc(p)}</code>`).join(' ')}</p>` : ''}
    ${r.crawl.exclude.length ? `<p class="muted">exclude: ${r.crawl.exclude.map((p) => `<code>${esc(p)}</code>`).join(' ')}</p>` : ''}
    ${skipped ? `<h3>Links not followed</h3>${skipped}` : '<p class="muted">No links were skipped.</p>'}
  </section>`;
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function renderHtmlReport(
  input: JsonReport | AppJsonReport,
  links: Links = new Map()
): string {
  const r = normalize(input);
  const host = (() => {
    try {
      return new URL(r.url).host;
    } catch {
      return r.url;
    }
  })();
  const findings = r.globalAnalysis.outliers ?? [];
  const n = (c: string) => findings.filter((f) => f.confidence === c).length;
  const avg = r.crawl.averageScore ?? r.score.overall;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>Design audit · ${esc(host)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div>
    <h1>Design audit <span class="muted">· ${esc(host)}</span></h1>
    <p class="muted">${esc(new Date(r.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))} · <a href="${safeHref(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a></p>
  </div>
  <nav aria-label="Sections">
    <a href="#findings">Findings</a><a href="#recurring">Recurring</a><a href="#pages">Pages</a><a href="#tokens">Design values</a>${r.crawl.enabled ? '<a href="#crawl">Crawl</a>' : ''}
  </nav>
</header>
<main>
  <section class="stats">
    <div class="stat"><div class="k">Average score</div><div class="v ${scoreClass(avg)}-t">${avg}<span class="muted">/100</span></div></div>
    <div class="stat"><div class="k">Pages audited</div><div class="v">${r.crawl.audited}<span class="muted"> / ${r.crawl.visited}</span></div></div>
    <div class="stat"><div class="k">High-confidence findings</div><div class="v c-err">${n('high')}</div></div>
    <div class="stat"><div class="k">Medium-confidence findings</div><div class="v c-warn">${n('medium')}</div></div>
  </section>
  ${findingsSection(findings, links)}
  ${recurringSection(r.pages)}
  ${pagesSection(r.pages, links)}
  ${tokensSection(r.globalAnalysis)}
  ${crawlSection(r)}
</main>
<footer class="muted">Generated by design-auditor. This file may contain page text and structure from the audited application — share it accordingly.</footer>
<script>${JS}</script>
</body>
</html>
`;
}

const CSS = `
:root{--bg:#f7f7f8;--card:#fff;--text:#18181b;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--err:#dc2626;--warn:#b45309;--ok:#15803d;--chip:#f1f5f9;
--a:#16a34a;--b:#65a30d;--c:#d97706;--d:#ea580c;--f:#dc2626}
@media (prefers-color-scheme:dark){.badge{color:#111}:root{--bg:#0f1115;--card:#171a21;--text:#e5e7eb;--muted:#9ca3af;--line:#2a2f3a;--accent:#818cf8;--err:#f87171;--warn:#fbbf24;--ok:#4ade80;--chip:#222734}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.muted{color:var(--muted)}
.top{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;align-items:flex-end;padding:24px 16px 16px;max-width:1200px;margin:0 auto}
.top h1{margin:0;font-size:22px}
.top p{margin:4px 0 0}
.top nav{display:flex;gap:4px;flex-wrap:wrap}
.top nav a{padding:6px 10px;border-radius:6px;text-decoration:none;color:var(--text);background:var(--chip)}
main{max-width:1200px;margin:0 auto;padding:0 16px 48px}
section{margin-top:32px}
h2{font-size:18px;margin:0 0 12px}
h3{font-size:15px;margin:24px 0 8px}
h4{font-size:13px;margin:0 0 6px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:8px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.stat .k{color:var(--muted);font-size:12px}
.stat .v{font-size:28px;font-weight:650}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.filters label{background:var(--chip);padding:4px 10px;border-radius:999px;cursor:pointer;user-select:none;text-transform:capitalize}
.filters .sep{width:1px;height:20px;background:var(--line)}
.filters input[type=search]{flex:1 1 220px;min-width:0;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
@media (max-width:420px){.grid{grid-template-columns:1fr}}
.finding{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0}
.finding header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.finding .where{margin-left:auto;font-weight:600}
.badge{font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:999px;color:#fff}
.b-high{background:var(--err)}.b-medium{background:var(--warn)}.b-info{background:var(--muted)}
.cat{font-size:12px;color:var(--muted);text-transform:capitalize}
.value{margin:2px 0}
.examples{list-style:none;padding:0;margin:8px 0}
.examples li{padding:4px 0;border-top:1px dashed var(--line)}
.sel{cursor:copy;background:var(--chip);padding:1px 4px;border-radius:4px}
.sel.copied{outline:2px solid var(--ok)}
.reason{margin:6px 0 2px;font-size:13px}
.suggest{margin:0;font-size:13px;color:var(--muted)}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid rgba(127,127,127,.4);vertical-align:-1px;margin-right:4px}
.page{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:8px}
.page>summary{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 14px;cursor:pointer;list-style:none}
.page>summary::-webkit-details-marker{display:none}
.page>summary::before{content:"▸";color:var(--muted)}
.page[open]>summary::before{content:"▾"}
.path{flex:1 1 260px;min-width:0;display:flex;flex-direction:column}
.path a{font-weight:600;word-break:break-all}
.bar{flex:0 0 120px;height:8px;background:var(--chip);border-radius:999px;overflow:hidden}
.bar span{display:block;height:100%}
.score{font-weight:700;width:2.5em;text-align:right}
.counts{font-size:12px;min-width:12em;text-align:right}
.c-err{color:var(--err)}.c-warn{color:var(--warn)}
.s-a{background:var(--a)}.s-b{background:var(--b)}.s-c{background:var(--c)}.s-d{background:var(--d)}.s-f{background:var(--f)}
.s-a-t{color:var(--a)}.s-b-t{color:var(--b)}.s-c-t{color:var(--c)}.s-d-t{color:var(--d)}.s-f-t{color:var(--f)}
.modules{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px 24px;padding:4px 14px 8px}
.violations{list-style:none;padding:0;margin:0}
.violations li{display:flex;gap:8px;padding:3px 0}
.icon::before{display:inline-block;width:14px;text-align:center;font-weight:700}
.v-error .icon::before{content:"✖";color:var(--err)}
.v-warn .icon::before{content:"◆";color:var(--warn)}
.v-pass .icon::before{content:"✔";color:var(--ok)}
.passes summary{cursor:pointer;color:var(--muted);font-size:12px;margin-top:4px}
.meta{padding:0 14px 12px;font-size:12px}
.outcome{color:var(--muted)}
.table-wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap}
.dists{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.dist{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}
.dist ul{list-style:none;padding:0;margin:0}
.dist li{display:grid;grid-template-columns:minmax(0,9em) 1fr auto;gap:8px;align-items:center;padding:2px 0}
.dist .label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dist .label code{word-break:normal}
.track{height:6px;background:var(--chip);border-radius:999px;overflow:hidden}
.track span{display:block;height:100%;background:var(--accent)}
ul.plain{padding-left:18px}
footer{max-width:1200px;margin:0 auto;padding:16px;font-size:12px}
.hidden{display:none}
.btn{display:inline-block;margin-top:8px;padding:5px 10px;border-radius:6px;border:1px solid var(--line);background:var(--chip);color:var(--text);text-decoration:none;font-size:13px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.page-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:0 14px 8px}
.page-actions .btn{margin-top:0}
.page-actions .muted{font-size:12px}
`;

const JS = `
(function(){
  var cards=[].slice.call(document.querySelectorAll('.finding'));
  var boxes=[].slice.call(document.querySelectorAll('[data-filter]'));
  var q=document.getElementById('q');
  var shown=document.getElementById('shown');
  function apply(){
    var on={confidence:{},category:{}};
    boxes.forEach(function(b){if(b.checked)on[b.dataset.filter][b.value]=1;});
    var term=q?q.value.trim().toLowerCase():'';
    var n=0;
    cards.forEach(function(c){
      var ok=on.confidence[c.dataset.confidence]&&on.category[c.dataset.category]&&(!term||c.dataset.search.indexOf(term)>-1);
      c.classList.toggle('hidden',!ok); if(ok)n++;
    });
    if(shown)shown.textContent=n+' of '+cards.length+' findings shown';
  }
  boxes.forEach(function(b){b.addEventListener('change',apply);});
  if(q)q.addEventListener('input',apply);
  document.addEventListener('click',function(e){
    var el=e.target.closest&&e.target.closest('.sel'); if(!el||!navigator.clipboard)return;
    navigator.clipboard.writeText(el.textContent).then(function(){el.classList.add('copied');setTimeout(function(){el.classList.remove('copied');},800);});
  });
  apply();
})();
`;
