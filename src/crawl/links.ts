import { Page } from 'playwright';
import { LinkInfo } from '@/crawl/crawler.js';

// Rendered anchors only — this covers nav menus, sidebars and client-side
// router links, which render as <a href>. Nothing is clicked.
export async function extractLinks(page: Page): Promise<LinkInfo[]> {
  return page.$$eval('a[href], area[href]', (els) =>
    els.map((el) => {
      const a = el as HTMLAnchorElement;
      return {
        href: a.getAttribute('href') || '',
        text: (a.textContent || '').trim().slice(0, 80),
        ariaLabel: a.getAttribute('aria-label') || undefined,
        title: a.getAttribute('title') || undefined,
        download: a.hasAttribute('download'),
      };
    })
  );
}
