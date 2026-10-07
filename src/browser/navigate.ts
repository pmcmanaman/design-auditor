import { Page, Response } from 'playwright';

export interface NavigateOptions {
  isLocal: boolean;
}

// Navigate and wait for the page to settle. networkidle times out on sites
// that keep connections open, so fall back to the load event.
export async function gotoSettled(
  page: Page,
  url: string,
  { isLocal }: NavigateOptions
): Promise<Response | null> {
  let response: Response | null;
  try {
    response = await page.goto(url, {
      waitUntil: isLocal ? 'load' : 'networkidle',
      timeout: isLocal ? 15000 : 30000,
    });
  } catch {
    response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  }

  if (isLocal) await page.waitForTimeout(1000);
  return response;
}

export function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1');
}
