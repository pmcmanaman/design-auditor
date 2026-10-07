import { describe, it, expect } from 'vitest';
import { crawl, LinkInfo, VisitContext, VisitResult } from '@/crawl/crawler.js';

type Site = Record<
  string,
  {
    links?: (string | LinkInfo)[];
    redirect?: string;
    status?: number;
    outcome?: 'auth-failed' | 'nav-failed';
  }
>;

const ORIGIN = 'https://app.test';

// Fake visit(): looks pages up in a map, follows redirects, honors shouldAudit
function fakeVisit(site: Site, visited: string[]) {
  return async (url: string, ctx: VisitContext): Promise<VisitResult<null>> => {
    visited.push(url.replace(ORIGIN, ''));
    const path = url.replace(ORIGIN, '');
    let entry = site[path];
    let finalUrl = url;
    if (entry?.redirect) {
      finalUrl = entry.redirect.startsWith('http')
        ? entry.redirect
        : ORIGIN + entry.redirect;
      entry = site[entry.redirect];
    }
    if (!entry)
      return {
        finalUrl,
        status: 404,
        title: '',
        outcome: 'nav-failed',
        links: [],
      };
    if (entry.outcome)
      return {
        finalUrl,
        status: 200,
        title: '',
        outcome: entry.outcome,
        links: [],
      };
    const links = (entry.links ?? []).map((l) =>
      typeof l === 'string' ? { href: l } : l
    );
    const skip = ctx.shouldAudit(finalUrl);
    return {
      finalUrl,
      status: 200,
      title: path,
      outcome: skip ?? 'audited',
      links:
        !skip || skip === 'discovery-only'
          ? ctx.collectLinks
            ? links
            : []
          : [],
    };
  };
}

async function run(
  site: Site,
  opts: Partial<Parameters<typeof crawl>[0]> = {}
) {
  const visited: string[] = [];
  const result = await crawl<null>({
    startUrl: `${ORIGIN}/`,
    maxPages: 100,
    maxDepth: 10,
    visit: fakeVisit(site, visited),
    ...opts,
  } as Parameters<typeof crawl<null>>[0]);
  return { result, visited };
}

describe('crawl', () => {
  it('visits each page once despite fragments, trailing slashes and query order', async () => {
    const { visited } = await run({
      '/': { links: ['/a', '/a/', '/a#top', '/b?y=2&x=1', '/b?x=1&y=2'] },
      '/a': { links: ['/'] },
      '/b?x=1&y=2': {},
    });
    expect(visited).toEqual(['/', '/a', '/b?x=1&y=2']);
  });

  it('stays on the start origin', async () => {
    const { visited, result } = await run({
      '/': {
        links: ['https://other.test/x', 'http://app.test/insecure', '/ok'],
      },
      '/ok': {},
    });
    expect(visited).toEqual(['/', '/ok']);
    expect(
      result.skipped.filter((s) => s.reason === 'off-origin')
    ).toHaveLength(2);
  });

  it('never follows logout or destructive links, by URL, text or aria-label', async () => {
    const { visited, result } = await run({
      '/': {
        links: [
          '/logout',
          '/items/1/delete',
          { href: '/x', text: 'Sign out' },
          { href: '/y', ariaLabel: 'Revoke access' },
          { href: '/z', title: 'Unsubscribe' },
          '/safe',
        ],
      },
      '/safe': {},
    });
    expect(visited).toEqual(['/', '/safe']);
    expect(result.skipped.filter((s) => s.reason === 'unsafe')).toHaveLength(5);
  });

  it('skips blocked schemes, downloads and files', async () => {
    const { visited, result } = await run({
      '/': {
        links: [
          'mailto:a@b.c',
          'tel:1',
          'javascript:void(0)',
          { href: '/r', download: true },
          '/f.pdf',
        ],
      },
    });
    expect(visited).toEqual(['/']);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      'blocked-scheme',
      'blocked-scheme',
      'blocked-scheme',
      'download',
      'non-html',
    ]);
  });

  it('enforces maxPages and reports unvisited pages', async () => {
    const links = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    const site: Site = { '/': { links } };
    links.forEach((l) => (site[l] = {}));
    const { result } = await run(site, { maxPages: 5 });
    expect(result.pages).toHaveLength(5);
    expect(result.unvisited).toBe(16);
  });

  it('enforces maxDepth on an endless chain', async () => {
    const site: Site = {};
    for (let i = 0; i < 50; i++)
      site[i === 0 ? '/' : `/n${i}`] = { links: [`/n${i + 1}`] };
    const { result } = await run(site, { maxDepth: 3 });
    expect(result.pages.map((p) => p.depth)).toEqual([0, 1, 2, 3]);
  });

  it('enforces maxDepth even if visit returns links at the depth limit', async () => {
    const visited: string[] = [];
    const result = await crawl<null>({
      startUrl: `${ORIGIN}/`,
      maxPages: 100,
      maxDepth: 1,
      // ignores ctx.collectLinks on purpose
      visit: async (url) => {
        visited.push(url.replace(ORIGIN, ''));
        const n = Number(url.split('/n')[1] ?? 0);
        return {
          finalUrl: url,
          status: 200,
          title: '',
          outcome: 'audited',
          links: [{ href: `/n${n + 1}` }],
        };
      },
    });
    expect(visited).toEqual(['/', '/n1']);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({ reason: 'max-depth' })
    );
  });

  it('terminates on link cycles', async () => {
    const { visited } = await run({
      '/': { links: ['/a'] },
      '/a': { links: ['/b'] },
      '/b': { links: ['/', '/a'] },
    });
    expect(visited).toEqual(['/', '/a', '/b']);
  });

  it('does not re-audit a page reached through a redirect', async () => {
    const { result } = await run({
      '/': { links: ['/settings', '/old-settings'] },
      '/settings': {},
      '/old-settings': { redirect: '/settings' },
    });
    const outcomes = Object.fromEntries(
      result.pages.map((p) => [p.url.replace(ORIGIN, ''), p.outcome])
    );
    expect(outcomes).toEqual({
      '/': 'audited',
      '/settings': 'audited',
      '/old-settings': 'duplicate',
    });
  });

  it('does not audit redirects that leave the origin', async () => {
    const { result } = await run({
      '/': { links: ['/docs'] },
      '/docs': { redirect: 'https://docs.other.test/' },
      'https://docs.other.test/': {},
    });
    expect(result.pages[1].outcome).toBe('off-origin');
  });

  it('does not expand auth-failed pages', async () => {
    const { visited } = await run({
      '/': { links: ['/private'] },
      '/private': { outcome: 'auth-failed', links: ['/secret'] },
    });
    expect(visited).toEqual(['/', '/private']);
  });

  it('applies include/exclude to discovered links; start page is discovery-only if excluded', async () => {
    const { result } = await run(
      {
        '/': { links: ['/dashboard/a', '/admin/users', '/other'] },
        '/dashboard/a': { links: ['/dashboard/b'] },
        '/dashboard/b': {},
      },
      { include: ['/dashboard/**'], exclude: ['/admin/**'] }
    );
    expect(
      result.pages.map((p) => [p.url.replace(ORIGIN, ''), p.outcome])
    ).toEqual([
      ['/', 'discovery-only'],
      ['/dashboard/a', 'audited'],
      ['/dashboard/b', 'audited'],
    ]);
  });

  it('crawls seeds as extra entry points', async () => {
    const { visited } = await run(
      { '/': {}, '/hidden': { links: ['/hidden/child'] }, '/hidden/child': {} },
      { seeds: ['/hidden', 'https://other.test/nope'] }
    );
    expect(visited).toEqual(['/', '/hidden', '/hidden/child']);
  });

  it('stops when shouldAbort returns a reason', async () => {
    const { result } = await run(
      { '/': { links: ['/a', '/b'] }, '/a': {}, '/b': {} },
      { shouldAbort: (pages) => (pages.length === 2 ? 'stop' : null) }
    );
    expect(result.pages).toHaveLength(2);
    expect(result.aborted).toBe('stop');
  });
});
