import { describe, it, expect } from 'vitest';
import { aggregate } from '@/analysis/aggregate.js';
import { detectOutliers } from '@/analysis/outliers.js';
import type {
  ComponentGroup,
  ComponentSample,
  Distributions,
  PageDesignSnapshot,
} from '@extractors/design-samples.js';

// distribution helper: { '16px': 100 } → ValueStat map with synthetic selectors
function dist(
  values: Record<string, number>,
  page = 'p'
): Distributions[string] {
  return Object.fromEntries(
    Object.entries(values).map(([v, count]) => [
      v,
      { count, examples: [`.${page}-${v.replace(/[^\w]/g, '')}`] },
    ])
  );
}

function snapshot(
  url: string,
  distributions: Distributions,
  groups: PageDesignSnapshot['groups'] = {}
): PageDesignSnapshot {
  return { url, elementCount: 0, truncated: false, distributions, groups };
}

function sample(
  group: ComponentGroup,
  overrides: Partial<ComponentSample> = {}
): ComponentSample {
  return {
    group,
    selector: `.${group}`,
    text: 'Save',
    tag: 'button',
    fontFamily: 'Inter',
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '20px',
    letterSpacing: 'normal',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    borderRadius: '8px',
    borderWidth: '0px',
    boxShadow: 'none',
    padding: '8px 16px 8px 16px',
    height: 40,
    ...overrides,
  };
}

const find = (outliers: ReturnType<typeof detectOutliers>, id: string) =>
  outliers.find((o) => o.id === id);

describe('aggregate', () => {
  it('sums counts and tracks pages across snapshots', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-size': dist({ '16px': 10, '14px': 2 }),
      }),
      snapshot('https://a.test/2', { 'font-size': dist({ '16px': 5 }) }),
    ]);
    expect(agg.pageCount).toBe(2);
    expect(agg.distributions['font-size']).toEqual([
      expect.objectContaining({
        value: '16px',
        count: 15,
        pages: ['https://a.test/1', 'https://a.test/2'],
      }),
      expect.objectContaining({
        value: '14px',
        count: 2,
        pages: ['https://a.test/1'],
      }),
    ]);
    expect(agg.distributions['font-size'][0].examples[0]).toEqual({
      url: 'https://a.test/1',
      selector: '.p-16px',
    });
  });

  it('tags component samples with their page', () => {
    const agg = aggregate([
      snapshot(
        'https://a.test/1',
        {},
        { 'button-primary': [sample('button-primary')] }
      ),
    ]);
    expect(agg.groups['button-primary']?.[0].url).toBe('https://a.test/1');
  });
});

describe('detectOutliers — scales', () => {
  it('flags a 1px font-size near-miss as high confidence', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-size': dist({ '16px': 1826, '14px': 411 }),
      }),
      snapshot('https://a.test/billing', {
        'font-size': dist({ '15px': 2 }, 'b'),
      }),
    ]);
    const o = find(detectOutliers(agg), 'font-size:15px');
    expect(o).toMatchObject({
      confidence: 'high',
      category: 'typography',
      pages: ['https://a.test/billing'],
    });
    expect(o!.examples[0].selector).toBe('.b-15px');
  });

  it('flags off-grid spacing as medium with the detected scale', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        padding: dist({ '8px': 300, '16px': 500, '24px': 200, '32px': 100 }),
      }),
      snapshot('https://a.test/dash', { padding: dist({ '18px': 1 }) }),
    ]);
    const o = find(detectOutliers(agg), 'padding:18px');
    expect(o?.confidence).toBe('medium');
    expect(o?.reason).toMatch(/8 \/ 16 \/ 24 \/ 32px/);
  });

  it('reports nothing for a uniform scale', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-size': dist({ '16px': 500, '14px': 200, '24px': 50 }),
        padding: dist({ '8px': 300, '16px': 300 }),
      }),
    ]);
    expect(detectOutliers(agg).filter((o) => o.confidence !== 'info')).toEqual(
      []
    );
  });

  it('does not treat common-but-unequal values as outliers', () => {
    // a real type scale: every value is used a lot
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-size': dist({
          '12px': 100,
          '13px': 100,
          '14px': 100,
          '15px': 100,
          '16px': 100,
        }),
      }),
    ]);
    expect(detectOutliers(agg)).toEqual([]);
  });

  it('ignores small samples', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-size': dist({ '16px': 30, '15px': 1 }),
      }),
    ]);
    expect(detectOutliers(agg)).toEqual([]);
  });

  it('a rare value spread across many pages is at most medium', () => {
    const snaps = Array.from({ length: 5 }, (_, i) =>
      snapshot(`https://a.test/${i}`, {
        'font-size': dist({ '16px': 500, '15px': 1 }),
      })
    );
    const o = find(detectOutliers(aggregate(snaps)), 'font-size:15px');
    expect(o?.confidence).not.toBe('high');
  });

  it('flags a browser-default serif among sans-serif text', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-family': dist({ Inter: 900, 'Times New Roman': 3 }),
      }),
    ]);
    expect(
      find(detectOutliers(agg), 'font-family:Times New Roman')?.confidence
    ).toBe('high');
  });
});

describe('detectOutliers — colors', () => {
  it('flags an accidental near-duplicate color as high', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'background-color': dist({ '#3b82f6': 118, '#ffffff': 400 }),
        color: dist({ '#111827': 600, '#3a82f6': 1 }),
      }),
    ]);
    const o = find(detectOutliers(agg), 'color:#3a82f6');
    expect(o).toMatchObject({
      confidence: 'high',
      dominant: { value: '#3b82f6', count: 118 },
    });
  });

  it('ignores clearly different colors and comparably common ones', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        color: dist({
          '#111827': 600,
          '#ef4444': 2,
          '#3b82f6': 100,
          '#3a82f6': 60,
        }),
      }),
    ]);
    expect(detectOutliers(agg).filter((o) => o.category === 'colors')).toEqual(
      []
    );
  });
});

describe('detectOutliers — component groups', () => {
  const buttons = (n: number, overrides: Partial<ComponentSample> = {}) =>
    Array.from({ length: n }, (_, i) =>
      sample('button-primary', { selector: `.btn-${i}`, ...overrides })
    );

  it('flags the one primary button with a different radius', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {}, { 'button-primary': buttons(94) }),
      snapshot(
        'https://a.test/orders',
        {},
        {
          'button-primary': [
            sample('button-primary', {
              selector: '#export',
              borderRadius: '6px',
            }),
          ],
        }
      ),
    ]);
    const o = detectOutliers(agg).find(
      (x) => x.group === 'button-primary' && x.property === 'border-radius'
    );
    expect(o).toMatchObject({
      confidence: 'high',
      value: '6px',
      dominant: { value: '8px', count: 94 },
      pages: ['https://a.test/orders'],
    });
    expect(o!.examples[0].selector).toBe('#export');
  });

  it('compares typography as size / weight within the group', () => {
    const agg = aggregate([
      snapshot(
        'https://a.test/1',
        {},
        {
          'button-primary': [
            ...buttons(43),
            sample('button-primary', { fontSize: '13px', fontWeight: '500' }),
          ],
        }
      ),
    ]);
    const o = detectOutliers(agg).find(
      (x) => x.group === 'button-primary' && x.value === '13px / 500'
    );
    expect(o?.reason).toBe(
      'Primary buttons: 43 use 14px / 600, 1 uses 13px / 500'
    );
  });

  it('treats a frequently used variant as intentional', () => {
    // 30 md + 10 sm buttons: sm is a size variant, not a mistake
    const agg = aggregate([
      snapshot(
        'https://a.test/1',
        {},
        { 'button-primary': [...buttons(30), ...buttons(10, { height: 32 })] }
      ),
    ]);
    expect(
      detectOutliers(agg).filter((o) => o.group === 'button-primary')
    ).toEqual([]);
  });

  it('needs a clear majority before reporting anything', () => {
    const agg = aggregate([
      snapshot(
        'https://a.test/1',
        {},
        {
          'button-primary': [
            ...buttons(6),
            ...buttons(4, { borderRadius: '4px' }),
          ],
        }
      ),
    ]);
    expect(detectOutliers(agg)).toEqual([]);
  });

  it('ignores sub-pixel height differences', () => {
    const agg = aggregate([
      snapshot(
        'https://a.test/1',
        {},
        { 'button-primary': [...buttons(20), ...buttons(1, { height: 41 })] }
      ),
    ]);
    expect(detectOutliers(agg).filter((o) => o.property === 'height')).toEqual(
      []
    );
  });

  it('reports an element once when a group finding explains a global one', () => {
    const agg = aggregate([
      snapshot(
        'https://a.test/1',
        { 'border-radius': dist({ '8px': 200 }) },
        { 'button-primary': buttons(50) }
      ),
      snapshot(
        'https://a.test/2',
        { 'border-radius': { '6px': { count: 1, examples: ['#export'] } } },
        {
          'button-primary': [
            sample('button-primary', {
              selector: '#export',
              borderRadius: '6px',
            }),
          ],
        }
      ),
    ]);
    const hits = detectOutliers(agg).filter((o) =>
      o.examples.some((e) => e.selector === '#export')
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].group).toBe('button-primary');
  });
});

describe('detectOutliers — ordering', () => {
  it('lists high before medium before info', () => {
    const agg = aggregate([
      snapshot('https://a.test/1', {
        'font-size': dist({ '16px': 1000, '15px': 1, '40px': 1 }),
        padding: dist({ '8px': 500, '16px': 500, '18px': 2 }),
      }),
    ]);
    const levels = detectOutliers(agg).map((o) => o.confidence);
    expect(levels).toEqual(
      [...levels].sort(
        (a, b) =>
          ['high', 'medium', 'info'].indexOf(a) -
          ['high', 'medium', 'info'].indexOf(b)
      )
    );
    expect(levels).toContain('info');
  });
});
