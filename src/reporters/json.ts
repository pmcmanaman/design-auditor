import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { ModuleReport } from '@/types.js';
import { calculateScore, AuditScore } from '@utils/score.js';
import type { RunResult } from '@/run.js';
import type { SkippedLink } from '@/crawl/crawler.js';
import type { GlobalAnalysis } from '@/analysis/global-analysis.js';

type Summary = { pass: number; warn: number; error: number };

export interface JsonReport {
  url: string;
  date: string;
  score: AuditScore;
  summary: Summary;
  modules: ModuleReport[];
}

export interface PageJson {
  url: string;
  finalUrl: string;
  title: string;
  depth: number;
  referrer: string | null;
  status: number | null;
  outcome: string;
  error?: string;
  score?: AuditScore;
  summary?: Summary;
  modules?: ModuleReport[];
  snapshot?: string; // static snapshot, relative to the report file
}

export interface AppJsonReport extends JsonReport {
  pages: PageJson[];
  crawl: {
    enabled: boolean;
    maxPages: number;
    maxDepth: number;
    include: string[];
    exclude: string[];
    visited: number;
    audited: number;
    averageScore: number;
    unvisited: number;
    aborted?: string;
    skipped: Pick<SkippedLink, 'url' | 'reason'>[];
  };
  globalAnalysis: GlobalAnalysis;
}

function summarize(reports: ModuleReport[]): Summary {
  const summary = { pass: 0, warn: 0, error: 0 };
  for (const module of reports) {
    for (const v of module.violations) {
      summary[v.severity]++;
    }
  }
  return summary;
}

export function buildJsonReport(
  url: string,
  reports: ModuleReport[]
): JsonReport {
  return {
    url,
    date: new Date().toISOString(),
    score: calculateScore(reports),
    summary: summarize(reports),
    modules: reports,
  };
}

// Superset of JsonReport: the top-level fields keep their single-page meaning
// (first audited page, normally the start URL) so existing consumers keep working
export function buildAppReport(
  run: RunResult,
  opts: { reportDir?: string } = {}
): AppJsonReport {
  const rel = (p: string) =>
    path
      .relative(path.resolve(opts.reportDir ?? '.'), p)
      .split(path.sep)
      .join('/');
  const audited = run.pages.filter((p) => p.audit);
  const first = audited[0];
  const legacy = buildJsonReport(run.startUrl, first?.audit?.reports ?? []);

  return {
    ...legacy,
    pages: run.pages.map((p) => ({
      url: p.url,
      finalUrl: p.finalUrl,
      title: p.title,
      depth: p.depth,
      referrer: p.referrer,
      status: p.status,
      outcome: p.outcome,
      ...(p.error ? { error: p.error } : {}),
      ...(p.snapshot ? { snapshot: rel(p.snapshot) } : {}),
      ...(p.audit
        ? {
            score: p.audit.score,
            summary: summarize(p.audit.reports),
            modules: p.audit.reports,
          }
        : {}),
    })),
    crawl: {
      enabled: run.crawl.enabled,
      maxPages: run.crawl.maxPages,
      maxDepth: run.crawl.maxDepth,
      include: run.crawl.include,
      exclude: run.crawl.exclude,
      visited: run.pages.length,
      audited: audited.length,
      averageScore: averageScore(run),
      unvisited: run.unvisited,
      ...(run.aborted ? { aborted: run.aborted } : {}),
      skipped: run.skipped.map(({ url, reason }) => ({ url, reason })),
    },
    globalAnalysis: run.globalAnalysis,
  };
}

export function averageScore(run: RunResult): number {
  const scores = run.pages
    .map((p) => p.audit?.score.overall)
    .filter((s): s is number => s !== undefined);
  return scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
}

export function saveReport(report: JsonReport): string {
  const host = new URL(report.url).hostname.replace(/\./g, '-');
  const date = new Date().toISOString().slice(0, 10);
  const filename = `design-audit-${host}-${date}.json`;

  writeFileSync(filename, JSON.stringify(report, null, 2), 'utf-8');
  return filename;
}

export function writeReport(report: JsonReport, filePath: string): string {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}
