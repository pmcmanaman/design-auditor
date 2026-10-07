import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  applyFixes,
  fixAnchor,
  fixesCss,
  fixesForPage,
} from '@reporters/fixes.js';
import { writeFixedPages } from '@reporters/snapshots.js';
import type { Outlier } from '@/analysis/outliers.js';
import type { AppJsonReport } from '@reporters/json.js';

const PAGE = 'https://app.test/billing';

function outlier(o: Partial<Outlier>): Outlier {
  return {
    id: 'x',
    category: 'typography',
    confidence: 'high',
    property: 'font-size',
    value: '15px',
    count: 1,
    pages: [PAGE],
    examples: [{ url: PAGE, selector: 'h2.title', ref: '42' }],
    dominant: { value: '16px', count: 100 },
    reason: '',
    suggestion: '',
    ...o,
  };
}

describe('fixesForPage', () => {
  it('maps group typography to font-size and font-weight on the referenced element', () => {
    const [fix] = fixesForPage(PAGE, [
      outlier({
        group: 'h2',
        property: 'font-size / font-weight',
        value: '15px / 500',
        dominant: { value: '18px / 600', count: 37 },
      }),
    ]);
    expect(fix.target).toBe('[data-da-i="42"]');
    expect(fix.declarations).toEqual([
      ['font-size', '18px'],
      ['font-weight', '600'],
    ]);
    expect(fix.label).toBe(
      'H2 headings — font-size / font-weight: 15px / 500 → 18px / 600'
    );
  });

  it('applies group radius, padding and shadow; rounded-full becomes 9999px', () => {
    const fixes = fixesForPage(PAGE, [
      outlier({
        id: 'a',
        group: 'button-primary',
        category: 'components',
        property: 'border-radius',
        value: '6px',
        dominant: { value: 'full', count: 20 },
      }),
      outlier({
        id: 'b',
        group: 'card',
        category: 'components',
        property: 'padding',
        value: '18px 16px 16px 16px',
        dominant: { value: '16px 16px 16px 16px', count: 20 },
      }),
      outlier({
        id: 'c',
        group: 'card',
        category: 'components',
        property: 'box-shadow',
        value: 'none',
        dominant: { value: 'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px', count: 20 },
      }),
    ]);
    expect(fixes.map((f) => f.declarations[0])).toEqual([
      ['border-radius', '9999px'],
      ['padding', '16px 16px 16px 16px'],
      ['box-shadow', 'rgba(0, 0, 0, 0.1) 0px 1px 2px 0px'],
    ]);
  });

  it('fixes only the side that carries a spacing outlier', () => {
    const [fix] = fixesForPage(PAGE, [
      outlier({
        category: 'spacing',
        property: 'padding',
        value: '18px',
        examples: [
          { url: PAGE, selector: '.card', ref: '7', property: 'padding-top' },
        ],
      }),
    ]);
    expect(fix.declarations).toEqual([['padding-top', '16px']]);
  });

  it('skips spacing outliers without a known side', () => {
    expect(
      fixesForPage(PAGE, [
        outlier({ category: 'spacing', property: 'padding', value: '18px' }),
      ])
    ).toEqual([]);
  });

  it('fixes colors on the property that used them', () => {
    const [fix] = fixesForPage(PAGE, [
      outlier({
        category: 'colors',
        property: 'color, background-color',
        value: '#3a82f6',
        dominant: { value: '#3b82f6', count: 118 },
        examples: [{ url: PAGE, selector: 'p', ref: '3', property: 'color' }],
      }),
    ]);
    expect(fix.declarations).toEqual([['color', '#3b82f6']]);
  });

  it('quotes font families', () => {
    const [fix] = fixesForPage(PAGE, [
      outlier({
        property: 'font-family',
        value: 'Times New Roman',
        dominant: { value: 'Inter', count: 900 },
      }),
    ]);
    expect(fix.declarations).toEqual([['font-family', '"Inter"']]);
  });

  it('ignores info findings, other pages and findings without a target value', () => {
    expect(
      fixesForPage(PAGE, [
        outlier({ confidence: 'info' }),
        outlier({
          examples: [
            { url: 'https://app.test/other', selector: 'h2', ref: '1' },
          ],
        }),
        outlier({ dominant: undefined }),
      ])
    ).toEqual([]);
  });

  it('falls back to the readable selector when there is no ref', () => {
    const [fix] = fixesForPage(PAGE, [
      outlier({ examples: [{ url: PAGE, selector: 'main > h2.title' }] }),
    ]);
    expect(fix.target).toBe('main > h2.title');
  });

  it('rejects values and selectors that could inject CSS or markup', () => {
    const bad = [
      outlier({ dominant: { value: '16px;} body{display:none', count: 9 } }),
      outlier({
        category: 'colors',
        property: 'color',
        dominant: { value: 'red;}*{color:red', count: 9 },
        examples: [{ url: PAGE, selector: 'p', ref: '1', property: 'color' }],
      }),
      outlier({ examples: [{ url: PAGE, selector: 'h2{} body' }] }),
      outlier({
        examples: [
          { url: PAGE, selector: 'h2</style><script>alert(1)</script>' },
        ],
      }),
      outlier({
        examples: [{ url: PAGE, selector: 'h2', ref: '1"] , body[x="' }],
      }),
      outlier({
        group: 'card',
        category: 'components',
        property: 'box-shadow',
        dominant: { value: '0 0 red;} html{display:none', count: 9 },
      }),
    ];
    const fixes = fixesForPage(PAGE, bad);
    // the bad ref falls back to the (safe) selector "h2"; everything else is dropped
    expect(fixes.map((f) => f.target)).toEqual(['h2']);
    expect(fixesCss(fixes)).not.toMatch(/display:none|<\/style|alert/);
  });

  it('builds stable anchors shared with audit.html', () => {
    expect(fixAnchor('group:button-primary:border-radius:6px')).toBe(
      'da-group-button-primary-border-radius-6px'
    );
    expect(
      fixesForPage(PAGE, [outlier({ id: 'color:#3a82f6' })])[0].anchor
    ).toBe('da-color-3a82f6');
  });
});

describe('applyFixes', () => {
  const snap =
    '<!doctype html><html><head><title>t</title></head><body><h2 data-da-i="42">Hi</h2></body></html>';
  const fixes = fixesForPage(PAGE, [outlier({})]);

  it('injects the overrides in head and the toolbar before </body>', () => {
    const html = applyFixes(snap, fixes);
    expect(html.indexOf('<style id="da-fixes">')).toBeLessThan(
      html.indexOf('</head>')
    );
    expect(html).toContain('[data-da-i="42"]{font-size:16px !important}');
    expect(html.indexOf('id="da-fix-data"')).toBeLessThan(
      html.lastIndexOf('</body>')
    );
  });

  it('escapes "<" in the embedded fix data', () => {
    const html = applyFixes(
      snap,
      fixesForPage(PAGE, [
        outlier({
          examples: [{ url: PAGE, selector: 'h2', ref: '1' }],
          value: '</script><b>',
        }),
      ])
    );
    const data = html.slice(
      html.indexOf('id="da-fix-data">'),
      html.indexOf('</script>', html.indexOf('id="da-fix-data">'))
    );
    expect(data).not.toContain('</script><b>');
    expect(data).toContain('\\u003c/script>');
  });
});

describe('writeFixedPages', () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  const report = (snapshot: string): AppJsonReport =>
    ({
      pages: [
        {
          url: PAGE,
          finalUrl: PAGE,
          title: '',
          depth: 0,
          referrer: null,
          status: 200,
          outcome: 'audited',
          modules: [],
          snapshot,
        },
      ],
      globalAnalysis: { outliers: [outlier({})] },
    }) as unknown as AppJsonReport;

  it('writes <snapshot>.fixed.html next to the snapshot and returns links', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'da-fix-'));
    mkdirSync(path.join(dir, 'r-pages'));
    writeFileSync(
      path.join(dir, 'r-pages', '01-billing.html'),
      '<html><head></head><body><h2 data-da-i="42">x</h2></body></html>'
    );
    const links = writeFixedPages(report('r-pages/01-billing.html'), dir);
    expect(links.get(PAGE)).toMatchObject({
      snapshot: 'r-pages/01-billing.html',
      fixed: 'r-pages/01-billing.fixed.html',
      fixCount: 1,
    });
    expect(
      readFileSync(path.join(dir, 'r-pages', '01-billing.fixed.html'), 'utf-8')
    ).toContain('da-fixes');
  });

  it('refuses snapshot paths outside the report directory', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'da-fix-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'da-out-'));
    writeFileSync(path.join(outside, 'x.html'), '<html></html>');
    const links = writeFixedPages(
      report(path.relative(dir, path.join(outside, 'x.html'))),
      dir
    );
    expect(links.size).toBe(0);
    expect(existsSync(path.join(outside, 'x.fixed.html'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });
});
