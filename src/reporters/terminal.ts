import chalk, { ChalkInstance } from 'chalk';
import { ModuleReport, Violation, Severity } from '@/types.js';
import { AuditScore, ModuleScore } from '@utils/score.js';

const W = 64; // total visual width

// ─── Color utils ──────────────────────────────────────────────────────────────

function scoreColor(score: number): ChalkInstance {
  if (score >= 90) return chalk.green;
  if (score >= 75) return chalk.greenBright;
  if (score >= 60) return chalk.yellow;
  if (score >= 40) return chalk.hex('#f97316');
  return chalk.red;
}

function progressBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return scoreColor(score)('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}

// ─── Hex color swatches ───────────────────────────────────────────────────────

const HEX_REGEX = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;

function colorizeHexes(text: string): string {
  return text.replace(HEX_REGEX, (hex) => {
    try {
      return `${chalk.bgHex(hex)('  ')} ${chalk.hex(hex)(hex)}`;
    } catch {
      return hex;
    }
  });
}

// ─── Violation item ───────────────────────────────────────────────────────────

const ICON: Record<Severity, string> = {
  error: chalk.bold.red('✖'),
  warn: chalk.yellow('◆'),
  pass: chalk.green('✔'),
};

function printViolation(v: Violation) {
  if (v.severity === 'pass') {
    console.log(`    ${ICON.pass}  ${chalk.dim(colorizeHexes(v.message))}`);
    if (v.hint) console.log(`       ${chalk.dim(colorizeHexes(v.hint))}`);
    return;
  }

  const color = v.severity === 'error' ? chalk.red : chalk.yellow;
  console.log(`    ${ICON[v.severity]}  ${color(colorizeHexes(v.message))}`);
  if (v.hint) console.log(`       ${chalk.dim(colorizeHexes(v.hint))}`);
}

// ─── Module header ────────────────────────────────────────────────────────────
// Layout: ── NAME ──────────────────────── ████████░░░░  38 ──

const BAR_W = 12; // visual width of inline bar
const RIGHT_W = 1 + BAR_W + 2 + 3 + 3; // " bar  score ──" = 21

function moduleHeader(name: string, ms?: ModuleScore) {
  const leftStr = `── ${name.toUpperCase()} `;
  const dashCount = Math.max(2, W - leftStr.length - (ms ? RIGHT_W : 3));

  const right = ms
    ? ` ${progressBar(ms.score, BAR_W)}  ${scoreColor(ms.score)(String(ms.score).padStart(3))} ──`
    : ' ──';

  console.log(
    chalk.dim('── ') +
      chalk.bold.white(name.toUpperCase() + ' ') +
      chalk.dim('─'.repeat(dashCount)) +
      right
  );
}

// ─── Dividers ─────────────────────────────────────────────────────────────────

function line() {
  console.log(chalk.dim('─'.repeat(W)));
}
function thick() {
  console.log(chalk.dim('━'.repeat(W)));
}

// ─── Header (URL banner) ──────────────────────────────────────────────────────

export function printHeader(url: string) {
  const host = url.replace(/https?:\/\//, '').replace(/\/$/, '');
  const left = '  DESIGN AUDITOR';
  const right = chalk.dim(host);
  const gap = Math.max(2, W - left.length - host.length - 2);

  console.log();
  thick();
  console.log(chalk.bold.white(left) + ' '.repeat(gap) + right);
  thick();
  console.log();
}

// ─── Module report ────────────────────────────────────────────────────────────

export function printReport(reports: ModuleReport[], auditScore?: AuditScore) {
  const scoreMap = new Map(auditScore?.modules.map((m) => [m.name, m]));

  let totalError = 0;
  let totalWarn = 0;
  let totalPass = 0;

  for (const report of reports) {
    const ms = scoreMap.get(report.name);

    // sort: errors → warnings → passes
    const sorted = [
      ...report.violations.filter((v) => v.severity === 'error'),
      ...report.violations.filter((v) => v.severity === 'warn'),
      ...report.violations.filter((v) => v.severity === 'pass'),
    ];

    for (const v of sorted) {
      if (v.severity === 'error') totalError++;
      if (v.severity === 'warn') totalWarn++;
      if (v.severity === 'pass') totalPass++;
    }

    moduleHeader(report.name, ms);
    console.log();
    sorted.forEach(printViolation);
    console.log();
  }

  // Summary bar
  thick();
  const errStr =
    totalError > 0
      ? chalk.bold.red(`  ${totalError} errors`)
      : chalk.dim(`  ${totalError} errors`);
  const warnStr =
    totalWarn > 0
      ? chalk.yellow(`  ${totalWarn} warnings`)
      : chalk.dim(`  ${totalWarn} warnings`);
  const passStr = chalk.green(`  ${totalPass} passed`);
  console.log(errStr + warnStr + passStr);
  thick();
}

// ─── Score panel ──────────────────────────────────────────────────────────────

export function printScore(auditScore: AuditScore) {
  const { overall, grade, label, modules } = auditScore;

  console.log();
  console.log(chalk.bold.white('  SCORE BREAKDOWN'));
  console.log();

  const nameW = Math.max(...modules.map((m) => m.name.length));

  for (const m of modules) {
    const name = chalk.dim(m.name.padEnd(nameW + 1));
    const bar = progressBar(m.score, 18);
    const score = scoreColor(m.score)(String(m.score).padStart(3));
    const errors =
      m.error > 0 ? chalk.red(`${m.error}✖`) : chalk.dim(`${m.error}✖`);
    const warns =
      m.warn > 0 ? chalk.yellow(`${m.warn}◆`) : chalk.dim(`${m.warn}◆`);
    const passes = chalk.dim(`${m.pass}✔`);
    console.log(`  ${name}  ${bar}  ${score}   ${errors}  ${warns}  ${passes}`);
  }

  console.log();
  line();
  console.log();

  // Overall score block
  const overallBar = progressBar(overall, 38);
  const overallScore = scoreColor(overall).bold(String(overall));
  const gradeStr = scoreColor(overall).bold(grade);
  const labelStr = scoreColor(overall)(label);

  console.log(`  ${overallBar}`);
  console.log();
  console.log(
    `  ${chalk.bold('Overall')}  ` +
      overallScore +
      chalk.dim('/100') +
      `    ${chalk.bold('Grade')}  ` +
      gradeStr +
      `  ${chalk.dim('·')}  ` +
      labelStr
  );
  console.log();
  thick();
  console.log();
}

// ─── Multi-page (crawl) output ────────────────────────────────────────────────

export interface PageSummaryInput {
  path: string;
  title: string;
  outcome: string;
  error?: string;
  score?: AuditScore;
  reports?: ModuleReport[];
}

export function printCrawlSummary(stats: {
  visited: number;
  audited: number;
  skippedLinks: number;
  failed: number;
  unvisited: number;
  aborted?: string;
}) {
  console.log(chalk.bold.white('  CRAWL'));
  console.log();
  console.log(
    `  ${chalk.bold(String(stats.audited))} pages audited  ${chalk.dim('·')}  ` +
      `${stats.visited} visited  ${chalk.dim('·')}  ` +
      `${stats.failed > 0 ? chalk.red(`${stats.failed} failed`) : chalk.dim('0 failed')}  ${chalk.dim('·')}  ` +
      chalk.dim(`${stats.skippedLinks} links skipped`)
  );
  if (stats.unvisited > 0) {
    console.log(
      chalk.yellow(
        `  Page limit reached: ${stats.unvisited} discovered pages were not visited (raise --max-pages)`
      )
    );
  }
  if (stats.aborted) console.log(chalk.red(`  ${stats.aborted}`));
  console.log();
}

export function printPageFindings(page: PageSummaryInput, verbose = false) {
  const right = page.score
    ? scoreColor(page.score.overall)(String(page.score.overall).padStart(3))
    : chalk.dim(page.outcome);
  const title = page.title ? chalk.dim(`  ${page.title.slice(0, 40)}`) : '';
  console.log(`${chalk.bold.white(page.path)}${title}  ${right}`);

  if (page.error) console.log(`    ${chalk.red(page.error)}`);

  if (page.reports && page.score) {
    if (verbose) {
      console.log();
      printReport(page.reports, page.score);
    } else {
      for (const report of page.reports) {
        const issues = report.violations.filter((v) => v.severity !== 'pass');
        if (issues.length === 0) continue;
        console.log(chalk.dim(`  ${report.name}`));
        [
          ...issues.filter((v) => v.severity === 'error'),
          ...issues.filter((v) => v.severity === 'warn'),
        ].forEach(printViolation);
      }
    }
  }
  console.log();
}

export interface ConsistencyFinding {
  category: string;
  confidence: 'high' | 'medium' | 'info';
  property: string;
  value: string;
  count: number;
  pages: string[];
  examples: { url: string; selector: string; text?: string }[];
  dominant?: { value: string; count: number };
  groupLabel?: string;
  reason: string;
  suggestion: string;
}

const CATEGORY_ORDER = ['typography', 'spacing', 'colors', 'components'];
const CONFIDENCE_STYLE = {
  high: chalk.bold.red('HIGH  '),
  medium: chalk.yellow('MEDIUM'),
  info: chalk.dim('INFO  '),
};

export function printConsistency(
  findings: ConsistencyFinding[],
  opts: {
    maxPerCategory: number;
    includeInfo: boolean;
    toPath: (url: string) => string;
  }
) {
  thick();
  console.log(chalk.bold.white('  APPLICATION-WIDE DESIGN CONSISTENCY'));
  thick();
  console.log();

  const shown = findings.filter(
    (f) => opts.includeInfo || f.confidence !== 'info'
  );
  if (shown.length === 0) {
    console.log(
      `  ${ICON.pass}  ${chalk.dim('No probable inconsistencies found across audited pages')}`
    );
    console.log();
    return;
  }

  for (const category of CATEGORY_ORDER) {
    const list = shown.filter((f) => f.category === category);
    if (list.length === 0) continue;

    moduleHeader(category[0].toUpperCase() + category.slice(1));
    console.log();
    for (const f of list.slice(0, opts.maxPerCategory)) {
      const where =
        f.pages.length === 1
          ? opts.toPath(f.pages[0])
          : `${f.pages.length} pages`;
      console.log(`  ${CONFIDENCE_STYLE[f.confidence]}  ${chalk.white(where)}`);
      if (f.groupLabel) console.log(`    ${chalk.dim(f.groupLabel)}`);
      console.log(
        `    ${colorizeHexes(`${f.property}: ${f.value}`)}  ${chalk.dim(`(${f.count}×)`)}`
      );
      if (f.dominant) {
        console.log(
          `    ${chalk.dim('Comparable:')} ${colorizeHexes(f.dominant.value)}  ${chalk.dim(`(${f.dominant.count}×)`)}`
        );
      }
      for (const ex of f.examples.slice(0, 3)) {
        const text = ex.text ? chalk.dim(` "${ex.text}"`) : '';
        const page =
          f.pages.length > 1 ? chalk.dim(`${opts.toPath(ex.url)}  `) : '';
        console.log(
          `    ${chalk.dim('→')} ${page}${chalk.cyan(ex.selector)}${text}`
        );
      }
      console.log(`    ${chalk.dim(colorizeHexes(f.reason))}`);
      console.log(`    ${chalk.dim(f.suggestion)}`);
      console.log();
    }
    if (list.length > opts.maxPerCategory) {
      console.log(
        chalk.dim(
          `  … ${list.length - opts.maxPerCategory} more ${category} findings (raise --max-findings or use --format json)`
        )
      );
      console.log();
    }
  }

  const high = shown.filter((f) => f.confidence === 'high').length;
  const medium = shown.filter((f) => f.confidence === 'medium').length;
  thick();
  console.log(
    `  ${high > 0 ? chalk.bold.red(`${high} high`) : chalk.dim('0 high')}` +
      `  ${medium > 0 ? chalk.yellow(`${medium} medium`) : chalk.dim('0 medium')}` +
      chalk.dim(`  confidence findings`)
  );
  thick();
}

export function printAppScore(average: number, pages: number) {
  console.log();
  console.log(
    `  ${chalk.bold('Average page score')}  ${scoreColor(average).bold(String(average))}${chalk.dim('/100')}` +
      chalk.dim(`  across ${pages} pages`)
  );
  console.log();
}
