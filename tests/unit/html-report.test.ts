import { describe, it, expect } from 'vitest';
import { renderHtmlReport } from '@reporters/html.js';
import { buildJsonReport } from '@reporters/json.js';
import type { AppJsonReport } from '@reporters/json.js';
import type { ModuleReport } from '@/types.js';

const modules: ModuleReport[] = [
  {
    name: 'Colors',
    violations: [
      {
        id: 'a',
        severity: 'error',
        message: '3 pairs fail WCAG AA',
        hint: '#ffffff on #3b82f6',
      },
      { id: 'b', severity: 'pass', message: 'ok' },
    ],
  },
];

const XSS = '<img src=x onerror=alert(1)>';

function appReport(): AppJsonReport {
  const base = buildJsonReport('https://app.test/', modules);
  return {
    ...base,
    pages: [
      {
        url: 'https://app.test/',
        finalUrl: 'https://app.test/dash',
        title: `Dash ${XSS}`,
        depth: 0,
        referrer: null,
        status: 200,
        outcome: 'audited',
        score: base.score,
        summary: base.summary,
        modules,
      },
      {
        url: 'https://app.test/old',
        finalUrl: 'https://app.test/dash',
        title: '',
        depth: 1,
        referrer: 'https://app.test/',
        status: 200,
        outcome: 'duplicate',
      },
      {
        url: 'javascript:alert(1)',
        finalUrl: 'javascript:alert(1)',
        title: '',
        depth: 1,
        referrer: null,
        status: null,
        outcome: 'nav-failed',
        error: XSS,
      },
    ],
    crawl: {
      enabled: true,
      maxPages: 10,
      maxDepth: 2,
      include: [],
      exclude: [],
      visited: 3,
      audited: 1,
      averageScore: base.score.overall,
      unvisited: 0,
      skipped: [{ url: 'https://app.test/logout', reason: 'unsafe' }],
    },
    globalAnalysis: {
      pageCount: 1,
      typography: { fontSizes: [{ value: '14px', count: 10, pages: 1 }] },
      spacing: {},
      colors: {
        text: [
          { value: '#3b82f6', count: 5, pages: 1 },
          { value: `red;}${XSS}`, count: 1, pages: 1 },
        ],
      },
      components: { distributions: {}, groups: {} },
      outliers: [
        {
          id: 'x',
          category: 'colors',
          confidence: 'high',
          property: 'color',
          value: '#3a82f6',
          count: 1,
          pages: ['https://app.test/dash'],
          examples: [
            {
              url: 'https://app.test/dash',
              selector: `div > ${XSS}`,
              text: XSS,
            },
          ],
          dominant: { value: '#3b82f6', count: 80 },
          reason: 'near duplicate',
          suggestion: 'use the token',
        },
      ],
    },
  };
}

describe('renderHtmlReport', () => {
  it('escapes everything that comes from the audited site', () => {
    const html = renderHtmlReport(appReport());
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('background:red;}');
  });

  it('is self-contained: no external scripts, styles or images', () => {
    const html = renderHtmlReport(appReport());
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']?https?:/i);
    expect(html).toContain("default-src 'none'");
  });

  it('renders findings, recurring issues, pages, design values and crawl', () => {
    const html = renderHtmlReport(appReport());
    for (const id of ['findings', 'pages', 'tokens', 'crawl'])
      expect(html).toContain(`id="${id}"`);
    expect(html).toContain('data-confidence="high"');
    expect(html).toContain('background:#3a82f6');
    expect(html).toContain('duplicate of /dash');
  });

  it('lists audited pages before duplicates and failures', () => {
    const html = renderHtmlReport(appReport());
    expect(html.indexOf('>/dash<')).toBeLessThan(html.indexOf('>/old<'));
  });

  it('renders legacy single-page reports', () => {
    const html = renderHtmlReport(
      buildJsonReport('https://site.test/', modules)
    );
    expect(html).toContain('3 pairs fail WCAG AA');
    expect(html).toContain('No application-wide outliers');
    expect(html).not.toContain('id="crawl"');
  });
});
