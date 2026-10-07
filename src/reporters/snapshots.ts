import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { AppJsonReport } from '@reporters/json.js';
import { applyFixes, fixesForPage } from '@reporters/fixes.js';

export interface PageLinks {
  snapshot: string; // relative to the report
  fixed: string;
  fixCount: number;
  anchors: Set<string>;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

// For every page with a snapshot, write "<snapshot>.fixed.html" with the
// page's findings applied. Snapshot paths in the report are relative to the
// report file and must stay inside its directory.
// Returned links are relative to `linkBase` (the HTML file's directory).
export function writeFixedPages(
  report: AppJsonReport,
  reportDir: string,
  linkBase: string = reportDir
): Map<string, PageLinks> {
  const links = new Map<string, PageLinks>();
  const root = path.resolve(reportDir);
  const base = path.resolve(linkBase);
  const outliers = report.globalAnalysis?.outliers ?? [];

  for (const page of report.pages ?? []) {
    if (!page.snapshot) continue;
    const abs = path.resolve(root, page.snapshot);
    const inside = abs.startsWith(root + path.sep);
    if (!inside || !abs.endsWith('.html') || abs.endsWith('.fixed.html'))
      continue;
    if (!existsSync(abs)) continue;

    const fixes = fixesForPage(page.finalUrl, outliers);
    const fixedAbs = abs.replace(/\.html$/, '.fixed.html');
    writeFileSync(fixedAbs, applyFixes(readFileSync(abs, 'utf-8'), fixes), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    links.set(page.finalUrl, {
      snapshot: toPosix(path.relative(base, abs)),
      fixed: toPosix(path.relative(base, fixedAbs)),
      fixCount: fixes.length,
      anchors: new Set(fixes.map((f) => f.anchor)),
    });
  }
  return links;
}
