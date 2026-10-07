import { Browser, Page, chromium } from 'playwright';
import { ModuleReport } from '@/types.js';
import { AuditModule } from '@/audit/modules.js';
import { auditPage } from '@/audit/audit-page.js';
import { gotoSettled } from '@/browser/navigate.js';
import { AuthConfig, isFormAuth } from '@/config.js';
import { AuthError, NavigationError } from '@/errors.js';
import {
  loadStorageState,
  restoreSessionStorage,
} from '@/auth/storage-state.js';
import { performFormLogin } from '@/auth/form-login.js';
import {
  INVALID_AUTH_MESSAGE,
  checkPageAuth,
  isLoginLikeUrl,
} from '@/auth/validate.js';
import { redactSecrets } from '@/auth/redact.js';
import {
  CrawledPage,
  PageOutcome,
  SkippedLink,
  VisitContext,
  VisitResult,
  crawl,
} from '@/crawl/crawler.js';
import { isSameOrigin } from '@/crawl/url.js';
import { extractLinks } from '@/crawl/links.js';
import { extractDesignSamples } from '@extractors/design-samples.js';
import { DesignAggregator } from '@/analysis/aggregate.js';
import {
  GlobalAnalysis,
  buildGlobalAnalysis,
} from '@/analysis/global-analysis.js';
import { Thresholds } from '@/analysis/outliers.js';
import { AuditScore, calculateScore } from '@utils/score.js';

export interface CrawlSettings {
  enabled: boolean;
  // extra entry points for routes not reachable through <a href> links
  seeds: string[];
  maxPages: number;
  maxDepth: number;
  include: string[];
  exclude: string[];
}

export interface RunOptions {
  url: string;
  modules: AuditModule[];
  isLocal: boolean;
  storageStatePath?: string;
  auth?: AuthConfig;
  crawl: CrawlSettings;
  thresholds?: Partial<Thresholds>;
  onProgress?: (message: string) => void;
  onWarning?: (message: string) => void;
}

export interface PageAudit {
  reports: ModuleReport[];
  score: AuditScore;
  elementCount: number;
  truncated: boolean;
}

export interface PageResult {
  url: string;
  finalUrl: string;
  title: string;
  depth: number;
  referrer: string | null;
  status: number | null;
  outcome: PageOutcome;
  error?: string;
  audit?: PageAudit;
}

export interface RunResult {
  startUrl: string;
  pages: PageResult[];
  skipped: SkippedLink[];
  unvisited: number;
  aborted?: string;
  crawl: CrawlSettings;
  globalAnalysis: GlobalAnalysis;
}

// Consecutive login redirects mid-crawl mean the session died: stop rather
// than "audit" a hundred copies of the login page
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

export async function runAudit(opts: RunOptions): Promise<RunResult> {
  const progress = opts.onProgress ?? (() => {});
  const warn = opts.onWarning ?? (() => {});
  const auth = opts.auth;
  const storageStatePath = opts.storageStatePath ?? auth?.storageState;
  const authConfigured = !!storageStatePath || isFormAuth(auth);

  const state = storageStatePath ? loadStorageState(storageStatePath) : null;
  if (state) {
    const { cookies, expiredCookies } = state.summary;
    if (cookies > 0 && expiredCookies === cookies) {
      warn(
        `All ${cookies} cookies in the storage state have expired; the session is probably no longer valid.`
      );
    }
  }

  const crawlSettings = opts.crawl;
  const maxPages = crawlSettings.enabled ? crawlSettings.maxPages : 1;
  const maxDepth = crawlSettings.enabled ? crawlSettings.maxDepth : 0;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      ignoreHTTPSErrors: opts.isLocal,
      storageState: state?.playwright,
    });
    if (state) await restoreSessionStorage(context, state.sessionStorage);

    // One tab for the whole run: sessionStorage is per tab, and SPAs often
    // keep their session there, so a fresh tab per page would log us out
    const page = await context.newPage();
    if (isFormAuth(auth)) {
      progress('Logging in...');
      await performFormLogin(page, auth);
    }

    const aggregator = new DesignAggregator();
    const visit = (url: string, ctx: VisitContext) =>
      visitPage(page, url, ctx, {
        ...opts,
        authConfigured,
        aggregator,
        progress,
        warn,
      });

    const result = await crawl<PageAudit>({
      startUrl: opts.url,
      seeds: crawlSettings.enabled ? crawlSettings.seeds : [],
      maxPages,
      maxDepth,
      include: crawlSettings.include,
      exclude: crawlSettings.exclude,
      visit,
      onPage: (page, index) => {
        if (crawlSettings.enabled) {
          progress(
            `[${index + 1}/${maxPages}] ${page.outcome} ${pathOf(page.url)}`
          );
        }
      },
      shouldAbort: (pages) => {
        const recent = pages.slice(-MAX_CONSECUTIVE_AUTH_FAILURES);
        return pages.length > 1 &&
          recent.length === MAX_CONSECUTIVE_AUTH_FAILURES &&
          recent.every((p) => p.outcome === 'auth-failed')
          ? `Session appears to have expired during the crawl (${MAX_CONSECUTIVE_AUTH_FAILURES} consecutive pages failed authentication).`
          : null;
      },
    });

    const start = result.pages[0];
    if (start?.outcome === 'auth-failed') {
      throw new AuthError(`${INVALID_AUTH_MESSAGE}\nReason: ${start.error}`);
    }
    if (start?.outcome === 'nav-failed') {
      throw new NavigationError(
        `Could not load ${opts.url}: ${start.error ?? 'navigation failed'}`
      );
    }

    const pages = result.pages.map(toPageResult);
    if (!pages.some((p) => p.outcome === 'audited')) {
      throw new NavigationError(
        'No pages were audited. Check the URL and --include/--exclude patterns.'
      );
    }

    return {
      startUrl: opts.url,
      pages,
      skipped: result.skipped,
      unvisited: result.unvisited,
      aborted: result.aborted,
      crawl: crawlSettings,
      globalAnalysis: buildGlobalAnalysis(aggregator.result(), opts.thresholds),
    };
  } finally {
    await browser?.close();
  }
}

interface VisitDeps extends RunOptions {
  authConfigured: boolean;
  aggregator: DesignAggregator;
  progress: (message: string) => void;
  warn: (message: string) => void;
}

async function visitPage(
  page: Page,
  url: string,
  ctx: VisitContext,
  deps: VisitDeps
): Promise<VisitResult<PageAudit>> {
  const base = { links: [], title: '' };
  let response;
  try {
    response = await gotoSettled(page, url, { isLocal: deps.isLocal });
  } catch (err) {
    const message =
      err instanceof Error ? err.message.split('\n')[0] : String(err);
    return {
      ...base,
      finalUrl: url,
      status: null,
      outcome: 'nav-failed',
      error: redactSecrets(message),
    };
  }

  const finalUrl = page.url();
  const status = response?.status() ?? null;
  const title = await page.title().catch(() => '');
  const result = { ...base, finalUrl, status, title };

  // Same-origin links that redirect elsewhere (docs, status page) are not
  // auth failures — unless they land on a login page
  if (
    ctx.depth > 0 &&
    !isSameOrigin(finalUrl, url) &&
    !isLoginLikeUrl(finalUrl)
  ) {
    return { ...result, outcome: 'off-origin' };
  }

  const authProblem = await checkPageAuth(page, url, response, {
    loginUrl: deps.auth?.loginUrl,
    verifySelector: deps.auth?.verify?.selector,
  });
  if (authProblem) {
    if (deps.authConfigured) {
      return { ...result, outcome: 'auth-failed', error: authProblem };
    }
    if (ctx.depth === 0) {
      deps.warn(
        `${pathOf(url)}: ${authProblem}. If this page requires login, pass --storage-state or --config.`
      );
    }
  }

  if (status !== null && status >= 400) {
    return { ...result, outcome: 'nav-failed', error: `HTTP ${status}` };
  }

  const links = ctx.collectLinks ? await extractLinks(page) : [];
  const skipOutcome = ctx.shouldAudit(finalUrl);
  if (skipOutcome) {
    return {
      ...result,
      outcome: skipOutcome,
      links: skipOutcome === 'discovery-only' ? links : [],
    };
  }

  const reports = await auditPage(page, deps.modules, (module) =>
    deps.progress(`${pathOf(finalUrl)} — ${module.name.toLowerCase()}`)
  );
  deps.progress(`${pathOf(finalUrl)} — collecting design values`);
  const snapshot = await extractDesignSamples(page);
  deps.aggregator.add(snapshot);

  return {
    ...result,
    outcome: 'audited',
    links,
    data: {
      reports,
      score: calculateScore(reports),
      elementCount: snapshot.elementCount,
      truncated: snapshot.truncated,
    },
  };
}

function toPageResult(p: CrawledPage<PageAudit>): PageResult {
  return {
    url: p.url,
    finalUrl: p.finalUrl,
    title: p.title,
    depth: p.depth,
    referrer: p.referrer,
    status: p.status,
    outcome: p.outcome,
    error: p.error,
    audit: p.data,
  };
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
