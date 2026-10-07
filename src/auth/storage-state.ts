import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { BrowserContext, Page } from 'playwright';
import { AuthError } from '@/errors.js';

export interface StorageStateSummary {
  cookies: number;
  expiredCookies: number;
  origins: number;
  sessionStorageOrigins: number;
}

type NameValue = { name: string; value: string };

// Playwright's storageState covers cookies + localStorage but not
// sessionStorage, which many SPAs use for auth. We store it alongside under
// a separate key, in the same shape as Playwright's `origins`.
export interface SessionStorageOrigin {
  origin: string;
  sessionStorage: NameValue[];
}

export interface LoadedStorageState {
  summary: StorageStateSummary;
  // what Playwright's newContext({ storageState }) accepts
  playwright: { cookies: any[]; origins: any[] };
  sessionStorage: SessionStorageOrigin[];
}

const REAUTH_HINT =
  'Run `design-auditor auth <login-url>` to create a new one, or pass a valid --storage-state.';

// Validates a Playwright storage state file and returns counts only.
// Errors never include file contents: the file holds session credentials.
export function loadStorageState(
  filePath: string,
  now: number = Date.now()
): LoadedStorageState {
  if (!existsSync(filePath)) {
    throw new AuthError(
      `Storage state file not found: ${filePath}\n${REAUTH_HINT}`
    );
  }

  let state: unknown;
  try {
    state = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    // JSON.parse messages quote the offending input — do not propagate them
    throw new AuthError(
      `Storage state file is not valid JSON: ${filePath}\n${REAUTH_HINT}`
    );
  }

  const summary = summarizeStorageState(state, filePath, now);
  const s = state as {
    cookies: any[];
    origins: any[];
    sessionStorage?: unknown;
  };
  const sessionStorage = Array.isArray(s.sessionStorage)
    ? (s.sessionStorage as SessionStorageOrigin[]).filter(
        (o) => typeof o?.origin === 'string' && Array.isArray(o.sessionStorage)
      )
    : [];
  return {
    summary: { ...summary, sessionStorageOrigins: sessionStorage.length },
    playwright: { cookies: s.cookies, origins: s.origins },
    sessionStorage,
  };
}

// Re-seed sessionStorage before any page script runs. Only fills missing keys
// so values the app updates during the crawl are not clobbered on navigation.
export async function restoreSessionStorage(
  context: BrowserContext,
  entries: SessionStorageOrigin[]
): Promise<void> {
  if (entries.length === 0) return;
  await context.addInitScript((data: SessionStorageOrigin[]) => {
    const match = data.find((o) => o.origin === window.location.origin);
    if (!match) return;
    for (const { name, value } of match.sessionStorage) {
      if (window.sessionStorage.getItem(name) === null) {
        window.sessionStorage.setItem(name, value);
      }
    }
  }, entries);
}

export function summarizeStorageState(
  state: unknown,
  filePath: string,
  now: number = Date.now()
): StorageStateSummary {
  const s = state as { cookies?: unknown; origins?: unknown } | null;
  if (
    !s ||
    typeof s !== 'object' ||
    !Array.isArray(s.cookies) ||
    !Array.isArray(s.origins)
  ) {
    throw new AuthError(
      `Storage state file is not a Playwright storage state (expected "cookies" and "origins" arrays): ${filePath}\n${REAUTH_HINT}`
    );
  }

  const nowSeconds = now / 1000;
  const expiredCookies = s.cookies.filter((c) => {
    const expires = (c as { expires?: number })?.expires;
    return typeof expires === 'number' && expires > 0 && expires < nowSeconds;
  }).length;

  return {
    cookies: s.cookies.length,
    expiredCookies,
    origins: s.origins.length,
    sessionStorageOrigins: Array.isArray(
      (s as { sessionStorage?: unknown }).sessionStorage
    )
      ? ((s as { sessionStorage: unknown[] }).sessionStorage.length ?? 0)
      : 0,
  };
}

// Writes the context's storage state with owner-only permissions. Inside a
// `.design-auditor/` folder a `*` .gitignore is added so it can't be committed.
export async function saveStorageState(
  context: BrowserContext,
  filePath: string,
  page?: Page
): Promise<string> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  mkdirSync(dir, { recursive: true });

  if (path.basename(dir) === '.design-auditor') {
    const gitignore = path.join(dir, '.gitignore');
    if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n', 'utf-8');
  }

  const state: Record<string, unknown> = { ...(await context.storageState()) };
  if (page && !page.isClosed()) {
    const session = await page
      .evaluate(() => ({
        origin: window.location.origin,
        sessionStorage: Object.keys(window.sessionStorage).map((name) => ({
          name,
          value: window.sessionStorage.getItem(name) ?? '',
        })),
      }))
      .catch(() => null);
    if (session && session.sessionStorage.length > 0) {
      state.sessionStorage = [session];
    }
  }
  writeFileSync(resolved, JSON.stringify(state, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  // mode only applies on create — tighten an existing file too
  chmodSync(resolved, 0o600);
  return resolved;
}
