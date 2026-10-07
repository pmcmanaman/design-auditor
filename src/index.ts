#!/usr/bin/env node
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { chromium } from 'playwright';
import ora from 'ora';
import { printHeader, printReport, printScore } from '@reporters/terminal.js';
import { buildJsonReport, saveReport } from '@reporters/json.js';
import { calculateScore } from '@utils/score.js';
import { MODULES, resolveModules } from '@/audit/modules.js';
import { auditPage } from '@/audit/audit-page.js';
import { gotoSettled, isLocalUrl } from '@/browser/navigate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

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
    const isLocal = options.local || isLocalUrl(url);
    const spinner = ora(`Analyzing ${url}`).start();

    let browser;
    try {
      browser = await chromium.launch();
      const context = await browser.newContext({
        ignoreHTTPSErrors: isLocal,
      });
      const page = await context.newPage();

      await gotoSettled(page, url, { isLocal });

      const reports = await auditPage(page, modules, (module) => {
        spinner.text = `Extracting ${module.name.toLowerCase()}...`;
      });

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
