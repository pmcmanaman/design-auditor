// End-to-end tests against the local fixture app (tests/fixtures/app).
// Skipped when Playwright's Chromium is not installed:
//   npx playwright install chromium
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { execFileSync, spawn } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { chromium } from 'playwright';
import {
  startFixtureServer,
  FixtureServer,
  FIXTURE_USER,
  FIXTURE_PASSWORD,
} from '../fixtures/app/server.js';
import { runAudit, RunOptions } from '@/run.js';
import { MODULES } from '@/audit/modules.js';
import { formLoginToStorageState } from '@/auth/form-login.js';
import { FormAuthConfig } from '@/config.js';
import { AuthError } from '@/errors.js';
import { extractDesignSamples } from '@extractors/design-samples.js';
import { extractBreakpoints } from '@extractors/breakpoints.js';

const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'dist/index.js');

describe.skipIf(!hasChromium)('authenticated crawl against fixture app', () => {
  let server: FixtureServer;
  let dir: string;
  let statePath: string;
  const env = { FIXTURE_USER, FIXTURE_PASSWORD };

  const formAuth = (
    overrides: Partial<FormAuthConfig> = {}
  ): FormAuthConfig => ({
    type: 'form',
    loginUrl: `${server.url}/login`,
    username: { selector: '#email', env: 'FIXTURE_USER' },
    password: { selector: '#password', env: 'FIXTURE_PASSWORD' },
    submit: { selector: 'button[type=submit]' },
    success: { urlContains: '/dashboard' },
    ...overrides,
  });

  const options = (overrides: Partial<RunOptions> = {}): RunOptions => ({
    url: `${server.url}/dashboard`,
    modules: MODULES.filter((m) => m.key === 'typography'),
    isLocal: false,
    crawl: {
      enabled: true,
      maxPages: 20,
      maxDepth: 3,
      include: [],
      exclude: [],
      seeds: [],
    },
    ...overrides,
  });

  // Async on purpose: the fixture server runs in this process, so a
  // synchronous spawn would block it from answering the CLI's requests
  const cli = (args: string[], extraEnv: Record<string, string> = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(process.execPath, [CLI, ...args], {
          cwd: dir,
          env: { ...process.env, ...extraEnv, FORCE_COLOR: '0' },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      }
    );

  beforeAll(async () => {
    Object.assign(process.env, env);
    server = await startFixtureServer();
    dir = mkdtempSync(path.join(tmpdir(), 'design-auditor-it-'));
    statePath = path.join(dir, '.design-auditor', 'auth.json');
    // CLI tests run the compiled output, like users and CI do
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('form login saves a private storage state without the password', async () => {
    await formLoginToStorageState(formAuth(), statePath, { headless: true });

    const raw = readFileSync(statePath, 'utf-8');
    expect(raw).not.toContain(FIXTURE_PASSWORD);
    expect(
      JSON.parse(raw).cookies.map((c: { name: string }) => c.name)
    ).toContain('sid');
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
    expect(
      readFileSync(path.join(dir, '.design-auditor', '.gitignore'), 'utf-8')
    ).toBe('*\n');
  }, 60_000);

  it('crawls with the storage state, never touching destructive routes', async () => {
    server.hits.length = 0;
    const run = await runAudit(options({ storageStatePath: statePath }));

    const audited = run.pages
      .filter((p) => p.outcome === 'audited')
      .map((p) => new URL(p.finalUrl).pathname);
    expect(audited).toEqual(
      expect.arrayContaining([
        '/dashboard',
        '/orders',
        '/settings',
        '/settings/profile',
        '/settings/billing',
      ])
    );
    // the session must have survived the whole crawl
    expect(run.pages.some((p) => p.outcome === 'auth-failed')).toBe(false);

    const forbidden =
      /\/logout|\/delete|\/account\/close|\/revoke|\/export\.pdf|^GET \/report/;
    expect(server.hits.filter((h) => forbidden.test(h))).toEqual([]);
    expect(run.skipped.map((s) => s.reason)).toEqual(
      expect.arrayContaining([
        'unsafe',
        'blocked-scheme',
        'off-origin',
        'non-html',
        'download',
      ])
    );
    // the redirect is recorded but not audited twice
    expect(
      run.pages.find((p) => p.url.endsWith('/old-settings'))?.outcome
    ).toBe('duplicate');
  }, 120_000);

  it('finds the planted design outliers with selectors', async () => {
    const run = await runAudit(
      options({
        storageStatePath: statePath,
        crawl: { ...options().crawl, maxDepth: 1 },
      })
    );
    const outliers = run.globalAnalysis.outliers.filter(
      (o) => o.confidence !== 'info'
    );
    const bySelector = (sel: string) =>
      outliers.filter((o) => o.examples.some((e) => e.selector === sel));

    expect(bySelector('[data-testid="billing-heading"]')).toContainEqual(
      expect.objectContaining({
        group: 'h2',
        value: '15px / 500',
        confidence: 'high',
      })
    );
    expect(bySelector('[data-testid="bulk-export"]')).toContainEqual(
      expect.objectContaining({
        group: 'button-primary',
        property: 'border-radius',
        value: '6px',
      })
    );
    expect(bySelector('[data-testid="profile-hint"]')).toContainEqual(
      expect.objectContaining({
        category: 'colors',
        value: '#3a82f6',
        confidence: 'high',
      })
    );
    expect(bySelector('[data-testid="recent-orders"]').length).toBeGreaterThan(
      0
    );
  }, 120_000);

  it('rejects an expired session instead of auditing the login page', async () => {
    const expired = path.join(dir, 'expired.json');
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    state.cookies = state.cookies.map((c: object) => ({
      ...c,
      value: 'stale-session',
    }));
    writeFileSync(expired, JSON.stringify(state));

    await expect(
      runAudit(options({ storageStatePath: expired }))
    ).rejects.toThrowError(AuthError);
    await expect(
      runAudit(options({ storageStatePath: expired }))
    ).rejects.toThrowError(/invalid or expired/);
  }, 120_000);

  it('logs in with form auth inside the run', async () => {
    const run = await runAudit(
      options({ auth: formAuth(), crawl: { ...options().crawl, maxPages: 3 } })
    );
    expect(run.pages[0].outcome).toBe('audited');
  }, 120_000);

  it('keeps sessionStorage-based SPA sessions alive (save, restore, crawl)', async () => {
    const spaState = path.join(dir, 'spa.json');
    await formLoginToStorageState(
      formAuth({
        loginUrl: `${server.url}/spa/login`,
        username: { selector: 'input[type=text]', env: 'FIXTURE_USER' },
        password: { selector: 'input[type=password]', env: 'FIXTURE_PASSWORD' },
        submit: { selector: 'button:has-text("Sign In")' },
        success: { urlContains: '/spa/home' },
      }),
      spaState,
      { headless: true }
    );
    expect(
      JSON.parse(readFileSync(spaState, 'utf-8')).sessionStorage[0]
        .sessionStorage[0].name
    ).toBe('_app_token');

    const run = await runAudit(
      options({ url: `${server.url}/spa/home`, storageStatePath: spaState })
    );
    expect(
      run.pages
        .filter((p) => p.outcome === 'audited')
        .map((p) => new URL(p.finalUrl).pathname)
    ).toEqual(['/spa/home', '/spa/reports']);
  }, 120_000);

  it('normalizes Tailwind v4 patterns (radius, shadows, auto margins, variants, media)', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${server.url}/public/tailwind`);
      const snap = await extractDesignSamples(page);
      const radii = Object.keys(snap.distributions['border-radius'] ?? {});
      expect(radii).toContain('full');
      expect(radii.some((r) => /e\+/.test(r))).toBe(false);

      const shadows = Object.keys(snap.distributions['box-shadow'] ?? {});
      expect(shadows).toEqual(['rgba(16, 24, 40, 0.1) 0px 1px 2px 0px']);

      const margins = Object.keys(snap.distributions['margin'] ?? {});
      expect(margins.filter((m) => parseFloat(m) > 32)).toEqual([]);

      const groupOf = (testid: string) =>
        Object.entries(snap.groups).find(([, samples]) =>
          samples?.some((x) => x.selector === `[data-testid="${testid}"]`)
        )?.[0];
      expect(groupOf('pale-button')).toBe('button-secondary');
      expect(groupOf('combo')).toBe('select');
      expect(groupOf('check-label')).toBeUndefined();
      expect(groupOf('field-label')).toBe('label');
      // transparent ring placeholders alone do not make a card
      expect(groupOf('ring-only')).toBe('card'); // has a real border
      expect(groupOf('ringed')).toBeUndefined(); // no radius/background/size

      const bp = await extractBreakpoints(page);
      expect(bp.breakpoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 768, type: 'min-width' }),
          expect.objectContaining({ value: 640, type: 'max-width' }),
        ])
      );
    } finally {
      await browser.close();
    }
  }, 60_000);

  describe('CLI', () => {
    it('exits 2 with guidance when the storage state is invalid', async () => {
      writeFileSync(path.join(dir, 'garbage.json'), 'sk_live_not_json');
      const r = await cli([
        `${server.url}/dashboard`,
        '--storage-state',
        'garbage.json',
      ]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/not valid JSON/);
      expect(r.stderr).not.toContain('sk_live');
    }, 120_000);

    it('exits 2 when the session is rejected', async () => {
      const r = await cli([
        `${server.url}/dashboard`,
        '--storage-state',
        'expired.json',
      ]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(
        /Authentication state appears invalid or expired/
      );
    }, 120_000);

    it('exits 3 when the start page cannot be loaded', async () => {
      const r = await cli(['http://127.0.0.1:9/', '--local']);
      expect(r.status).toBe(3);
    }, 120_000);

    it('writes a JSON report with pages and global analysis', async () => {
      const r = await cli([
        `${server.url}/dashboard`,
        '--crawl',
        '--max-pages',
        '6',
        '--storage-state',
        statePath,
        '--only',
        'typography',
        '--format',
        'json',
        '--output',
        'audit.json',
      ]);
      expect(r.status).toBe(0);
      const report = JSON.parse(
        readFileSync(path.join(dir, 'audit.json'), 'utf-8')
      );
      expect(report).toHaveProperty('modules');
      expect(report).toHaveProperty('score.overall');
      expect(report.pages.length).toBe(6);
      expect(report.crawl).toMatchObject({ enabled: true, maxPages: 6 });
      expect(report.globalAnalysis.outliers.length).toBeGreaterThan(0);
    }, 120_000);

    it('renders a saved JSON report as HTML with the report command', async () => {
      // audit.json comes from the previous test
      const r = await cli(['report', 'audit.json']);
      expect(r.status).toBe(0);
      const html = readFileSync(path.join(dir, 'audit.html'), 'utf-8');
      expect(html).toContain('Consistency findings');
      expect(html).toContain('/settings/billing');

      writeFileSync(path.join(dir, 'not-a-report.json'), '{"hello":1}');
      const bad = await cli(['report', 'not-a-report.json']);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(
        /does not look like a design-auditor JSON report/
      );
    }, 120_000);

    it('writes an HTML report directly with --format html', async () => {
      const r = await cli([
        `${server.url}/dashboard`,
        '--storage-state',
        statePath,
        '--only',
        'typography',
        '--format',
        'html',
        '--output',
        'direct.html',
      ]);
      expect(r.status).toBe(0);
      expect(readFileSync(path.join(dir, 'direct.html'), 'utf-8')).toMatch(
        /^<!doctype html>/
      );
    }, 120_000);

    it('prints JSON to stdout and nothing else there', async () => {
      const r = await cli([
        `${server.url}/dashboard`,
        '--storage-state',
        statePath,
        '--only',
        'typography',
        '--format',
        'json',
      ]);
      expect(r.status).toBe(0);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    }, 120_000);

    it('exits 4 with --fail-on high when high-confidence findings exist', async () => {
      const r = await cli([
        `${server.url}/dashboard`,
        '--crawl',
        '--max-depth',
        '1',
        '--storage-state',
        statePath,
        '--only',
        'typography',
        '--fail-on',
        'high',
      ]);
      expect(r.status).toBe(4);
      expect(r.stdout).toMatch(/APPLICATION-WIDE DESIGN CONSISTENCY/);
    }, 120_000);

    it('auth --config never prints the credentials', async () => {
      const config = path.join(dir, 'auth.config.json');
      writeFileSync(config, JSON.stringify({ auth: formAuth() }));
      const r = await cli(
        ['auth', '--config', config, '--output-state', 'cli-state.json'],
        env
      );
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(FIXTURE_PASSWORD);
      expect(r.stderr).toMatch(/never commit/);
    }, 120_000);

    it('auth --config fails with exit 2 and no secrets on bad credentials', async () => {
      const config = path.join(dir, 'auth.config.json');
      const r = await cli(
        ['auth', '--config', config, '--output-state', 'bad-state.json'],
        {
          FIXTURE_USER,
          FIXTURE_PASSWORD: 'wrong-password-123',
        }
      );
      expect(r.status).toBe(2);
      expect(r.stdout + r.stderr).not.toContain('wrong-password-123');
      expect(existsSync(path.join(dir, 'bad-state.json'))).toBe(false);
    }, 120_000);
  });
});
