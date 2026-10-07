#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command, InvalidArgumentError } from 'commander';
import ora from 'ora';
import {
  printAppScore,
  printConsistency,
  printCrawlSummary,
  printHeader,
  printPageFindings,
  printReport,
  printScore,
} from '@reporters/terminal.js';
import {
  averageScore,
  buildAppReport,
  saveReport,
  writeReport,
} from '@reporters/json.js';
import { renderHtmlReport } from '@reporters/html.js';
import { MODULES, resolveModules } from '@/audit/modules.js';
import { isLocalUrl } from '@/browser/navigate.js';
import { AuditorConfig, isFormAuth, loadConfig } from '@/config.js';
import { AuditorError, ConfigError, EXIT_CODES } from '@/errors.js';
import { redactSecrets } from '@/auth/redact.js';
import { interactiveLogin } from '@/auth/interactive.js';
import { formLoginToStorageState } from '@/auth/form-login.js';
import { groupLabel } from '@/analysis/outliers.js';
import { pathOf, runAudit } from '@/run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_STATE_PATH = '.design-auditor/auth.json';

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError('Must be a non-negative integer.');
  }
  return n;
}

// repeatable and comma-separated: --exclude "/a/**" --exclude "/b/**,/c"
function collect(value: string, previous: string[]): string[] {
  return previous.concat(
    value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  );
}

function validUrl(value: string): string {
  try {
    new URL(value);
    return value;
  } catch {
    throw new InvalidArgumentError('Must be an absolute URL (https://…).');
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof AuditorError) return err.message;
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  return redactSecrets(msg);
}

function defaultHtmlPath(url: string): string {
  const host = new URL(url).hostname.replace(/\./g, '-');
  return `design-audit-${host}-${new Date().toISOString().slice(0, 10)}.html`;
}

const program = new Command();

program
  .name('design-auditor')
  .description('Audit design consistency of any website')
  .version(pkg.version)
  .enablePositionalOptions()
  .argument('<url>', 'URL to audit', validUrl)
  .option(
    '--only <modules>',
    `Run only specific modules: ${MODULES.map((m) => m.key).join(',')}`
  )
  .option('--save-report', 'Save report as JSON file')
  .option('--local', 'Optimize for local dev servers (localhost)')
  .option(
    '--storage-state <path>',
    'Playwright storage state (cookies + local storage) to audit as a signed-in user'
  )
  .option(
    '--config <path>',
    'JSON config file (form login via env vars, crawl settings)'
  )
  .option('--crawl', 'Follow same-origin links and audit every page found')
  .option(
    '--max-pages <n>',
    `Maximum pages to visit when crawling (default ${DEFAULT_MAX_PAGES})`,
    positiveInt
  )
  .option(
    '--max-depth <n>',
    `Maximum link depth when crawling (default ${DEFAULT_MAX_DEPTH})`,
    positiveInt
  )
  .option(
    '--include <glob>',
    'Only crawl paths matching this glob (repeatable, comma-separated)',
    collect,
    []
  )
  .option(
    '--exclude <glob>',
    'Never crawl paths matching this glob (repeatable, comma-separated)',
    collect,
    []
  )
  .option(
    '--seed <path>',
    'Extra page to start crawling from, for routes not linked with <a href> (repeatable, comma-separated)',
    collect,
    []
  )
  .option(
    '--format <format>',
    'Output format: terminal, json or html',
    'terminal'
  )
  .option(
    '--output <file>',
    'Write the JSON/HTML report to a file (with --format json|html)'
  )
  .option(
    '--fail-on <confidence>',
    'Exit with code 4 if consistency findings at this confidence exist: high or medium'
  )
  .option(
    '--max-findings <n>',
    'Consistency findings shown per category in the terminal',
    positiveInt,
    10
  )
  .option('--verbose', 'Print full per-page module reports when crawling')
  .action(async (url: string, options) => {
    const json = options.format === 'json';
    const html = options.format === 'html';
    if (!['terminal', 'json', 'html'].includes(options.format)) {
      program.error(`--format must be "terminal", "json" or "html"`);
    }
    if (options.failOn && !['high', 'medium'].includes(options.failOn)) {
      program.error(`--fail-on must be "high" or "medium"`);
    }

    const modules = resolveModules(options.only);
    const isLocal = options.local || isLocalUrl(url);
    const spinner = ora(`Analyzing ${url}`).start();
    const warn = (message: string) => {
      spinner.clear();
      console.error(`⚠ ${message}`);
      spinner.render();
    };

    try {
      const config: AuditorConfig = options.config
        ? loadConfig(options.config)
        : {};
      const crawlCfg = config.crawl ?? {};
      const crawl = {
        enabled: !!options.crawl,
        maxPages: options.maxPages ?? crawlCfg.maxPages ?? DEFAULT_MAX_PAGES,
        maxDepth: options.maxDepth ?? crawlCfg.maxDepth ?? DEFAULT_MAX_DEPTH,
        include: options.include.length
          ? options.include
          : (crawlCfg.include ?? []),
        exclude: [...(crawlCfg.exclude ?? []), ...options.exclude],
        seeds: [...(crawlCfg.seeds ?? []), ...options.seed],
      };
      if (options.storageState && isFormAuth(config.auth)) {
        throw new ConfigError(
          'Use either --storage-state or form login in --config, not both.'
        );
      }

      const run = await runAudit({
        url,
        modules,
        isLocal,
        storageStatePath: options.storageState,
        auth: config.auth,
        crawl,
        onProgress: (message) => {
          spinner.text = message;
        },
        onWarning: warn,
      });

      spinner.succeed('Done');

      const report = buildAppReport(run);
      const outliers = run.globalAnalysis.outliers;

      if (html) {
        const file = options.output ?? defaultHtmlPath(url);
        writeFileSync(file, renderHtmlReport(report), 'utf-8');
        console.error(`HTML report written → ${file}`);
      } else if (json) {
        if (options.output) {
          writeReport(report, options.output);
          console.error(`Report written → ${options.output}`);
        } else {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        }
      } else if (!crawl.enabled) {
        // single page: unchanged output
        const page = run.pages.find((p) => p.audit)!;
        printHeader(url);
        printReport(page.audit!.reports, page.audit!.score);
        printScore(page.audit!.score);
      } else {
        printHeader(url);
        printCrawlSummary({
          visited: run.pages.length,
          audited: run.pages.filter((p) => p.audit).length,
          failed: run.pages.filter((p) =>
            ['nav-failed', 'auth-failed'].includes(p.outcome)
          ).length,
          skippedLinks: run.skipped.length,
          unvisited: run.unvisited,
          aborted: run.aborted,
        });
        for (const page of run.pages) {
          if (page.outcome === 'duplicate' || page.outcome === 'off-origin')
            continue;
          printPageFindings(
            {
              path: pathOf(page.finalUrl),
              title: page.title,
              outcome: page.outcome,
              error: page.error,
              score: page.audit?.score,
              reports: page.audit?.reports,
            },
            options.verbose
          );
        }
        printConsistency(
          outliers.map((o) => ({
            ...o,
            groupLabel: o.group
              ? `${groupLabel(o.group)} (${o.groupSize} sampled)`
              : undefined,
          })),
          {
            maxPerCategory: options.maxFindings,
            includeInfo: false,
            toPath: pathOf,
          }
        );
        printAppScore(averageScore(run), report.crawl.audited);
      }

      if (options.saveReport) {
        const filename = saveReport(report);
        console.error(`\nReport saved → ${filename}`);
      }

      if (run.aborted) {
        console.error(run.aborted);
        process.exitCode = EXIT_CODES.auth;
      } else if (options.failOn) {
        const levels =
          options.failOn === 'high' ? ['high'] : ['high', 'medium'];
        const hits = outliers.filter((o) => levels.includes(o.confidence));
        if (hits.length > 0) {
          console.error(
            `${hits.length} consistency finding(s) at or above "${options.failOn}" confidence (--fail-on).`
          );
          process.exitCode = EXIT_CODES.threshold;
        }
      }
    } catch (err) {
      spinner.fail('Failed');
      console.error(errorMessage(err));
      process.exitCode =
        err instanceof AuditorError ? err.exitCode : EXIT_CODES.fatal;
    }
  });

program
  .command('report')
  .description('Render a saved JSON report as a self-contained HTML page')
  .argument('<json-file>', 'Report from --format json or --save-report')
  .option(
    '-o, --output <file>',
    'HTML file to write (default: same name, .html)'
  )
  .action((jsonFile: string, options) => {
    try {
      if (!existsSync(jsonFile)) {
        throw new ConfigError(`Report file not found: ${jsonFile}`);
      }
      let report;
      try {
        report = JSON.parse(readFileSync(jsonFile, 'utf-8'));
      } catch {
        throw new ConfigError(`Report file is not valid JSON: ${jsonFile}`);
      }
      if (!report?.url || !report?.score || !Array.isArray(report?.modules)) {
        throw new ConfigError(
          `${jsonFile} does not look like a design-auditor JSON report`
        );
      }
      const out = options.output ?? jsonFile.replace(/\.json$/i, '') + '.html';
      writeFileSync(out, renderHtmlReport(report), 'utf-8');
      console.error(`HTML report written → ${out}`);
    } catch (err) {
      console.error(errorMessage(err));
      process.exitCode =
        err instanceof AuditorError ? err.exitCode : EXIT_CODES.fatal;
    }
  });

program
  .command('auth')
  .description(
    'Log in once and save the session as a Playwright storage state file'
  )
  .argument('[login-url]', 'Login page to open', validUrl)
  .option(
    '--output-state <path>',
    'Where to save the storage state',
    DEFAULT_STATE_PATH
  )
  .option(
    '--wait-for-url <text>',
    'Finish automatically once the URL contains this text (instead of pressing Enter)'
  )
  .option(
    '--config <path>',
    'Use form login from this config (credentials from env vars) instead of a manual login'
  )
  .option('--headed', 'Show the browser during config-driven form login')
  .option(
    '--timeout <seconds>',
    'How long to wait for a manual login',
    positiveInt,
    600
  )
  .action(async (loginUrl: string | undefined, options) => {
    try {
      const config: AuditorConfig = options.config
        ? loadConfig(options.config)
        : {};
      let saved: string;

      if (isFormAuth(config.auth)) {
        const auth = loginUrl ? { ...config.auth, loginUrl } : config.auth;
        console.error(`Logging in at ${auth.loginUrl} using form login...`);
        saved = await formLoginToStorageState(auth, options.outputState, {
          headless: !options.headed,
          ignoreHTTPSErrors: isLocalUrl(auth.loginUrl),
        });
      } else {
        const url = loginUrl ?? config.auth?.loginUrl;
        if (!url) {
          throw new ConfigError(
            'Pass a login URL: design-auditor auth https://app.example.com/login'
          );
        }
        saved = await interactiveLogin({
          loginUrl: url,
          outputPath: options.outputState,
          waitForUrl: options.waitForUrl,
          timeoutMs: options.timeout * 1000,
          log: (m) => console.error(m),
        });
      }

      console.error(`\n✔ Authentication state saved → ${saved}`);
      console.error(
        '  This file contains session credentials (cookies/tokens). Keep it private and never commit it.'
      );
      console.error(
        `  Use it with: design-auditor <url> --storage-state ${options.outputState}`
      );
    } catch (err) {
      console.error(errorMessage(err));
      process.exitCode =
        err instanceof AuditorError ? err.exitCode : EXIT_CODES.fatal;
    }
  });

program.parse();
