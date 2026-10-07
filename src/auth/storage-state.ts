import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { BrowserContext } from 'playwright';
import { AuthError } from '@/errors.js';

export interface StorageStateSummary {
  cookies: number;
  expiredCookies: number;
  origins: number;
}

const REAUTH_HINT =
  'Run `design-auditor auth <login-url>` to create a new one, or pass a valid --storage-state.';

// Validates a Playwright storage state file and returns counts only.
// Errors never include file contents: the file holds session credentials.
export function loadStorageState(
  filePath: string,
  now: number = Date.now()
): StorageStateSummary {
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

  return summarizeStorageState(state, filePath, now);
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
  };
}

// Writes the context's storage state with owner-only permissions. Inside a
// `.design-auditor/` folder a `*` .gitignore is added so it can't be committed.
export async function saveStorageState(
  context: BrowserContext,
  filePath: string
): Promise<string> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  mkdirSync(dir, { recursive: true });

  if (path.basename(dir) === '.design-auditor') {
    const gitignore = path.join(dir, '.gitignore');
    if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n', 'utf-8');
  }

  const state = await context.storageState();
  writeFileSync(resolved, JSON.stringify(state, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  // mode only applies on create — tighten an existing file too
  chmodSync(resolved, 0o600);
  return resolved;
}
