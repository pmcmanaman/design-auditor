import { describe, it, expect } from 'vitest';
import { buildAppReport, buildJsonReport } from '@reporters/json.js';
import { buildGlobalAnalysis } from '@/analysis/global-analysis.js';
import { aggregate } from '@/analysis/aggregate.js';
import { calculateScore } from '@utils/score.js';
import type { RunResult } from '@/run.js';
import type { ModuleReport } from '@/types.js';

const reports: ModuleReport[] = [
  {
    name: 'Typography',
    violations: [{ id: 'a', severity: 'pass', message: 'ok' }],
  },
  {
    name: 'Colors',
    violations: [{ id: 'b', severity: 'warn', message: 'meh' }],
  },
];

function makeRun(): RunResult {
  const audit = {
    reports,
    score: calculateScore(reports),
    elementCount: 10,
    truncated: false,
  };
  return {
    startUrl: 'https://app.test/',
    pages: [
      {
        url: 'https://app.test/',
        finalUrl: 'https://app.test/dashboard',
        title: 'Dash',
        depth: 0,
        referrer: null,
        status: 200,
        outcome: 'audited',
        audit,
      },
      {
        url: 'https://app.test/x',
        finalUrl: 'https://app.test/login',
        title: 'Login',
        depth: 1,
        referrer: 'https://app.test/',
        status: 200,
        outcome: 'auth-failed',
        error: 'redirected to login page /login',
      },
    ],
    skipped: [
      {
        url: 'https://app.test/logout',
        reason: 'unsafe',
        referrer: 'https://app.test/',
      },
    ],
    unvisited: 0,
    crawl: {
      enabled: true,
      maxPages: 100,
      maxDepth: 10,
      include: [],
      exclude: [],
      seeds: [],
    },
    globalAnalysis: buildGlobalAnalysis(
      aggregate([
        {
          url: 'https://app.test/dashboard',
          elementCount: 1,
          truncated: false,
          distributions: {
            'font-size': { '16px': { count: 3, examples: ['p'] } },
          },
          groups: {},
        },
      ])
    ),
  };
}

describe('JSON report', () => {
  it('keeps the legacy single-page fields unchanged', () => {
    const legacy = buildJsonReport('https://app.test/', reports);
    const app = buildAppReport(makeRun());
    for (const key of ['url', 'score', 'summary', 'modules'] as const) {
      expect(app[key]).toEqual(legacy[key]);
    }
    expect(app.summary).toEqual({ pass: 1, warn: 1, error: 0 });
  });

  it('adds pages, crawl and globalAnalysis', () => {
    const app = buildAppReport(makeRun());
    expect(app.pages).toHaveLength(2);
    expect(app.pages[0]).toMatchObject({
      finalUrl: 'https://app.test/dashboard',
      outcome: 'audited',
      title: 'Dash',
    });
    expect(app.pages[0].modules).toEqual(reports);
    expect(app.pages[1]).toMatchObject({
      outcome: 'auth-failed',
      referrer: 'https://app.test/',
    });
    expect(app.pages[1]).not.toHaveProperty('modules');
    expect(app.crawl).toMatchObject({
      visited: 2,
      audited: 1,
      skipped: [{ url: 'https://app.test/logout', reason: 'unsafe' }],
    });
    expect(Object.keys(app.globalAnalysis)).toEqual(
      expect.arrayContaining([
        'typography',
        'spacing',
        'colors',
        'components',
        'outliers',
      ])
    );
    expect(app.globalAnalysis.typography.fontSizes).toEqual([
      { value: '16px', count: 3, pages: 1 },
    ]);
  });

  it('round-trips through JSON', () => {
    const app = buildAppReport(makeRun());
    expect(JSON.parse(JSON.stringify(app))).toEqual(app);
  });
});
