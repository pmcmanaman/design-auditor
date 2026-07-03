#!/usr/bin/env node
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { chromium, Page } from 'playwright';
import ora from 'ora';
import { extractTypography } from '@extractors/typography.js';
import { extractRhythm } from '@extractors/rhythm.js';
import { extractColors } from '@extractors/colors.js';
import { extractComponents } from '@extractors/components.js';
import { extractReadingWidth } from '@extractors/reading-width.js';
import { extractImages } from '@extractors/images.js';
import { extractLinks } from '@extractors/links.js';
import { extractBreakpoints } from '@extractors/breakpoints.js';
import { extractHeadings } from '@extractors/headings.js';
import { checkTypography } from '@rules/typography.rules.js';
import { checkRhythm } from '@rules/rhythm.rules.js';
import { checkColors } from '@rules/colors.rules.js';
import { checkComponents } from '@rules/components.rules.js';
import { checkReadingWidth } from '@rules/reading-width.rules.js';
import { checkImages } from '@rules/images.rules.js';
import { checkLinks } from '@rules/links.rules.js';
import { checkBreakpoints } from '@rules/breakpoints.rules.js';
import { checkHeadings } from '@rules/headings.rules.js';
import { printHeader, printReport, printScore } from '@reporters/terminal.js';
import { buildJsonReport, saveReport } from '@reporters/json.js';
import { calculateScore } from '@utils/score.js';
import { ModuleReport, Violation } from '@/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

interface AuditModule {
  key: string;
  name: string;
  run: (page: Page) => Promise<Violation[]>;
}

const MODULES: AuditModule[] = [
  {
    key: 'typography',
    name: 'Typography',
    run: async (p) => checkTypography(await extractTypography(p)),
  },
  {
    key: 'spacing',
    name: 'Vertical Rhythm & Spacing',
    run: async (p) => checkRhythm(await extractRhythm(p)),
  },
  {
    key: 'colors',
    name: 'Colors',
    run: async (p) => checkColors(await extractColors(p)),
  },
  {
    key: 'components',
    name: 'Components',
    run: async (p) => checkComponents(await extractComponents(p)),
  },
  {
    key: 'reading-width',
    name: 'Reading Width',
    run: async (p) => checkReadingWidth(await extractReadingWidth(p)),
  },
  {
    key: 'images',
    name: 'Images',
    run: async (p) => checkImages(await extractImages(p)),
  },
  {
    key: 'links',
    name: 'Links',
    run: async (p) => checkLinks(await extractLinks(p)),
  },
  {
    key: 'breakpoints',
    name: 'Breakpoints',
    run: async (p) => checkBreakpoints(await extractBreakpoints(p)),
  },
  {
    key: 'headings',
    name: 'Headings',
    run: async (p) => checkHeadings(await extractHeadings(p)),
  },
];

function resolveModules(only?: string): AuditModule[] {
  if (!only) return MODULES;

  const keys = only.split(',').map((k) => k.trim().toLowerCase());
  const unknown = keys.filter((k) => !MODULES.some((m) => m.key === k));
  if (unknown.length > 0) {
    console.error(
      `Unknown module(s): ${unknown.join(', ')}\n` +
        `Valid modules: ${MODULES.map((m) => m.key).join(', ')}`
    );
    process.exit(1);
  }

  return MODULES.filter((m) => keys.includes(m.key));
}

const program = new Command();

program
  .name('design-auditor')
  .description('Audit design consistency of any website')
  .version(pkg.version)
  .argument('<url>', 'URL to audit')
  .option(
    '--only <modules>',
    `Run only specific modules: ${MODULES.map((m) => m.key).join(',')}`
  )
  .option('--save-report', 'Save report as JSON file')
  .option('--local', 'Optimize for local dev servers (localhost)')
  .action(async (url: string, options) => {
    const modules = resolveModules(options.only);
    const isLocal =
      options.local || url.includes('localhost') || url.includes('127.0.0.1');
    const spinner = ora(`Analyzing ${url}`).start();

    let browser;
    try {
      browser = await chromium.launch();
      const context = await browser.newContext({
        ignoreHTTPSErrors: isLocal,
      });
      const page = await context.newPage();

      try {
        await page.goto(url, {
          waitUntil: isLocal ? 'load' : 'networkidle',
          timeout: isLocal ? 15000 : 30000,
        });
      } catch {
        // networkidle timeout (site keeps open connections) — fallback to load
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      }

      if (isLocal) await page.waitForTimeout(1000);

      const reports: ModuleReport[] = [];
      for (const module of modules) {
        spinner.text = `Extracting ${module.name.toLowerCase()}...`;
        reports.push({ name: module.name, violations: await module.run(page) });
      }

      spinner.succeed('Done');

      const score = calculateScore(reports);
      printHeader(url);
      printReport(reports, score);
      printScore(score);

      if (options.saveReport) {
        const report = buildJsonReport(url, reports);
        const filename = saveReport(report);
        console.log(`\nReport saved → ${filename}`);
      }
    } catch (err) {
      spinner.fail('Failed');
      console.error(err);
      process.exitCode = 1;
    } finally {
      await browser?.close();
    }
  });

program.parse();
