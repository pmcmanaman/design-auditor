import { createInterface } from 'readline';
import { Browser, chromium } from 'playwright';
import { AuthError } from '@/errors.js';
import { saveStorageState } from '@/auth/storage-state.js';

export interface InteractiveLoginOptions {
  loginUrl: string;
  outputPath: string;
  // finish automatically once the URL contains this text
  waitForUrl?: string;
  timeoutMs: number;
  log: (message: string) => void;
}

// Opens a visible browser, lets the user sign in by hand, then saves the
// Playwright storage state. Credentials are typed into the browser only.
export async function interactiveLogin(
  opts: InteractiveLoginOptions
): Promise<string> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(opts.loginUrl, { waitUntil: 'load' });

    const closed = new Promise<never>((_, reject) => {
      page.once('close', () =>
        reject(
          new AuthError('Browser closed before login completed; nothing saved.')
        )
      );
    });

    let done: Promise<unknown>;
    let cleanup = () => {};
    if (opts.waitForUrl) {
      const needle = opts.waitForUrl;
      opts.log(
        `Log in using the browser window. Waiting for a URL containing "${needle}"...`
      );
      done = page.waitForURL((u) => u.href.includes(needle), {
        timeout: opts.timeoutMs,
      });
    } else {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      cleanup = () => rl.close();
      done = new Promise<void>((resolve) =>
        rl.question(
          'Log in using the browser window, then press Enter here to save the session... ',
          () => resolve()
        )
      );
    }

    try {
      await Promise.race([done, closed]);
    } finally {
      cleanup();
    }

    return await saveStorageState(context, opts.outputPath);
  } finally {
    await browser?.close().catch(() => {});
  }
}
