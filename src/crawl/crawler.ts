import {
  hasBlockedScheme,
  isAllowedByPatterns,
  isNonHtmlResource,
  isSameOrigin,
  looksDestructive,
  normalizeUrl,
} from '@/crawl/url.js';

export interface LinkInfo {
  href: string;
  text?: string;
  ariaLabel?: string;
  title?: string;
  download?: boolean;
}

export type PageOutcome =
  | 'audited' // loaded and audited
  | 'discovery-only' // start page outside include/exclude: links followed, not audited
  | 'duplicate' // redirected to a page that was already visited
  | 'off-origin' // redirected off the configured origin
  | 'auth-failed'
  | 'nav-failed';

export interface VisitContext {
  depth: number;
  referrer: string | null;
  // false for a start page excluded by include/exclude patterns
  auditable: boolean;
  // whether links will be followed from this page
  collectLinks: boolean;
  // call with the post-redirect URL: false means skip auditing it
  shouldAudit: (finalUrl: string) => PageOutcome | null;
}

export interface VisitResult<T> {
  finalUrl: string;
  status: number | null;
  title: string;
  outcome: PageOutcome;
  links: LinkInfo[];
  error?: string;
  data?: T;
}

export interface CrawledPage<T> extends VisitResult<T> {
  url: string;
  depth: number;
  referrer: string | null;
}

export type SkipReason =
  | 'unsafe'
  | 'off-origin'
  | 'blocked-scheme'
  | 'download'
  | 'non-html'
  | 'excluded'
  | 'invalid'
  | 'max-depth'
  | 'max-pages';

export interface SkippedLink {
  url: string;
  reason: SkipReason;
  referrer: string;
}

export interface CrawlOptions<T> {
  startUrl: string;
  // additional same-origin entry points (paths or URLs), crawled at depth 0
  seeds?: string[];
  maxPages: number;
  maxDepth: number;
  include?: string[];
  exclude?: string[];
  visit: (url: string, ctx: VisitContext) => Promise<VisitResult<T>>;
  onPage?: (page: CrawledPage<T>, index: number) => void;
  // stop early (e.g. the session expired mid-crawl); return a reason to abort
  shouldAbort?: (pages: CrawledPage<T>[]) => string | null;
}

export interface CrawlResult<T> {
  pages: CrawledPage<T>[];
  skipped: SkippedLink[];
  // links that were never visited because maxPages was reached
  unvisited: number;
  aborted?: string;
}

const MAX_SKIPPED_RECORDED = 500;

// Breadth-first crawl over GET navigations only. Never clicks, never submits
// forms: discovery is limited to links a user could follow. `visit` does the
// browser work, which keeps this queue logic testable without a browser.
export async function crawl<T>(opts: CrawlOptions<T>): Promise<CrawlResult<T>> {
  const include = opts.include ?? [];
  const exclude = opts.exclude ?? [];
  const start = normalizeUrl(opts.startUrl);
  if (!start) throw new Error(`Invalid start URL: ${opts.startUrl}`);

  const queue: Array<{ url: string; depth: number; referrer: string | null }> =
    [{ url: start, depth: 0, referrer: null }];
  const seen = new Set<string>([start]); // queued or visited request URLs
  for (const seed of opts.seeds ?? []) {
    const url = normalizeUrl(seed, start);
    if (!url || seen.has(url) || !isSameOrigin(url, start)) continue;
    seen.add(url);
    queue.push({ url, depth: 0, referrer: null });
  }
  const loaded = new Set<string>(); // final (post-redirect) URLs already loaded
  const skippedSeen = new Set<string>();
  const pages: CrawledPage<T>[] = [];
  const skipped: SkippedLink[] = [];
  let aborted: string | undefined;

  const skip = (url: string, reason: SkipReason, referrer: string) => {
    const key = `${reason}|${url}`;
    if (skippedSeen.has(key) || skipped.length >= MAX_SKIPPED_RECORDED) return;
    skippedSeen.add(key);
    skipped.push({ url, reason, referrer });
  };

  while (queue.length > 0 && pages.length < opts.maxPages) {
    const item = queue.shift()!;
    const auditable =
      item.depth > 0 || isAllowedByPatterns(item.url, include, exclude);
    const collectLinks = item.depth < opts.maxDepth;

    const result = await opts.visit(item.url, {
      depth: item.depth,
      referrer: item.referrer,
      auditable,
      collectLinks,
      shouldAudit: (finalUrl) => {
        const final = normalizeUrl(finalUrl);
        if (!final || !isSameOrigin(final, start)) return 'off-origin';
        if (final !== item.url && (loaded.has(final) || seen.has(final))) {
          // the redirect target is (or will be) audited under its own URL
          return 'duplicate';
        }
        if (!auditable) return 'discovery-only';
        return null;
      },
    });

    const final = normalizeUrl(result.finalUrl);
    if (final) {
      loaded.add(final);
      seen.add(final);
    }
    loaded.add(item.url);

    const page: CrawledPage<T> = { ...result, ...item };
    pages.push(page);
    opts.onPage?.(page, pages.length - 1);

    aborted = opts.shouldAbort?.(pages) ?? undefined;
    if (aborted) break;

    const expand =
      result.outcome === 'audited' || result.outcome === 'discovery-only';
    if (!expand) continue;

    for (const link of result.links) {
      if (hasBlockedScheme(link.href)) {
        skip(link.href, 'blocked-scheme', item.url);
        continue;
      }
      const url = normalizeUrl(link.href, result.finalUrl);
      if (!url) {
        skip(link.href, 'invalid', item.url);
        continue;
      }
      if (seen.has(url)) continue;
      if (!isSameOrigin(url, start)) {
        skip(url, 'off-origin', item.url);
        continue;
      }
      if (link.download) {
        skip(url, 'download', item.url);
        continue;
      }
      if (isNonHtmlResource(url)) {
        skip(url, 'non-html', item.url);
        continue;
      }
      if (
        looksDestructive(new URL(url).pathname + new URL(url).search) ||
        looksDestructive(link.text) ||
        looksDestructive(link.ariaLabel) ||
        looksDestructive(link.title)
      ) {
        skip(url, 'unsafe', item.url);
        continue;
      }
      if (!isAllowedByPatterns(url, include, exclude)) {
        skip(url, 'excluded', item.url);
        continue;
      }
      if (item.depth + 1 > opts.maxDepth) {
        skip(url, 'max-depth', item.url);
        continue;
      }
      seen.add(url);
      queue.push({ url, depth: item.depth + 1, referrer: item.url });
    }
  }

  for (const rest of queue) skip(rest.url, 'max-pages', rest.referrer ?? '');

  return { pages, skipped, unvisited: queue.length, aborted };
}
