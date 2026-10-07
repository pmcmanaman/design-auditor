import { Page } from 'playwright';
import { FormAuthConfig } from '@/config.js';
import { AuthError } from '@/errors.js';
import { redactSecrets } from '@/auth/redact.js';
import { isLoginLikeUrl } from '@/auth/validate.js';

export interface Credentials {
  username: string;
  password: string;
}

// Credentials only ever come from the environment. Errors name the variable,
// never a value.
export function readCredentials(
  auth: FormAuthConfig,
  env: NodeJS.ProcessEnv = process.env
): Credentials {
  const missing = [auth.username.env, auth.password.env].filter(
    (name) => !env[name]
  );
  if (missing.length > 0) {
    throw new AuthError(
      `Form login needs environment variable(s) ${missing.join(', ')} to be set`
    );
  }
  return {
    username: env[auth.username.env]!,
    password: env[auth.password.env]!,
  };
}

export async function performFormLogin(
  page: Page,
  auth: FormAuthConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const creds = readCredentials(auth, env);
  const timeout = auth.timeoutMs ?? 30000;
  let step = 'opening the login page';

  try {
    await page.goto(auth.loginUrl, { waitUntil: 'load', timeout });

    step = `filling the username field (${auth.username.selector})`;
    await page.locator(auth.username.selector).first().fill(creds.username, {
      timeout,
    });

    if (auth.next?.selector) {
      step = `clicking the next button (${auth.next.selector})`;
      await page.locator(auth.next.selector).first().click({ timeout });
    }

    step = `filling the password field (${auth.password.selector})`;
    await page.locator(auth.password.selector).first().fill(creds.password, {
      timeout,
    });

    step = `clicking the submit button (${auth.submit.selector})`;
    await page.locator(auth.submit.selector).first().click({ timeout });

    step = 'waiting for login to complete';
    await waitForSuccess(page, auth, timeout);
    await page.waitForLoadState('load', { timeout }).catch(() => {});
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const detail = err instanceof Error ? err.message.split('\n')[0] : '';
    throw new AuthError(
      redactSecrets(`Form login failed while ${step}: ${detail}`, [
        creds.username,
        creds.password,
      ])
    );
  }
}

async function waitForSuccess(
  page: Page,
  auth: FormAuthConfig,
  timeout: number
): Promise<void> {
  const { success } = auth;
  if (success?.urlContains) {
    const needle = success.urlContains;
    await page.waitForURL((u) => u.href.includes(needle), { timeout });
  }
  if (success?.selector) {
    await page.locator(success.selector).first().waitFor({ timeout });
  }
  if (!success?.urlContains && !success?.selector) {
    // no explicit condition: wait until we leave the login page
    await page.waitForURL((u) => !isLoginLikeUrl(u.href, auth.loginUrl), {
      timeout,
    });
  }
}

// Headless form login that saves the resulting session (for CI bootstrapping)
export async function formLoginToStorageState(
  auth: FormAuthConfig,
  outputPath: string,
  opts: { headless: boolean; ignoreHTTPSErrors?: boolean }
): Promise<string> {
  const { chromium } = await import('playwright');
  const { saveStorageState } = await import('@/auth/storage-state.js');
  const browser = await chromium.launch({ headless: opts.headless });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: opts.ignoreHTTPSErrors,
    });
    const page = await context.newPage();
    await performFormLogin(page, auth);
    return await saveStorageState(context, outputPath, page);
  } finally {
    await browser.close();
  }
}
