import { Page, Response } from 'playwright';

export interface AuthCheckInput {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  // a visible password input on the loaded page
  hasPasswordField: boolean;
  // configured login page; redirects to it mean the session is invalid
  loginUrl?: string;
  // configured selector that must exist on authenticated pages
  verifySelector?: string;
  verifySelectorFound?: boolean;
}

const LOGIN_PATH =
  /(^|\/)(login|log-in|log_in|signin|sign-in|sign_in|auth|authenticate|sso|oauth2?|session\/new|sessions\/new)(\/|$)/i;

export function isLoginLikeUrl(url: string, loginUrl?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (loginUrl) {
    try {
      const login = new URL(loginUrl);
      if (
        parsed.origin === login.origin &&
        stripSlash(parsed.pathname) === stripSlash(login.pathname)
      ) {
        return true;
      }
    } catch {
      // invalid loginUrl is reported by config validation
    }
  }
  return LOGIN_PATH.test(parsed.pathname);
}

function stripSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

// Returns a human-readable reason when the page looks unauthenticated, else null
export function detectAuthFailure(input: AuthCheckInput): string | null {
  const { requestedUrl, finalUrl, status, loginUrl } = input;

  if (status === 401 || status === 403) {
    return `server responded ${status}`;
  }

  // the user asked for the login page itself — nothing to validate
  if (isLoginLikeUrl(requestedUrl, loginUrl)) return null;

  let requested: URL;
  let final: URL;
  try {
    requested = new URL(requestedUrl);
    final = new URL(finalUrl);
  } catch {
    return null;
  }

  if (final.origin !== requested.origin) {
    return `redirected to another origin (${final.origin}), likely an identity provider`;
  }

  if (isLoginLikeUrl(finalUrl, loginUrl)) {
    return `redirected to login page ${final.pathname}`;
  }

  const redirected =
    stripSlash(final.pathname) !== stripSlash(requested.pathname);
  if (redirected && input.hasPasswordField) {
    return `redirected to ${final.pathname}, which shows a password field`;
  }

  if (input.verifySelector && input.verifySelectorFound === false) {
    return `expected authenticated element "${input.verifySelector}" was not found`;
  }

  return null;
}

export async function checkPageAuth(
  page: Page,
  requestedUrl: string,
  response: Response | null,
  opts: { loginUrl?: string; verifySelector?: string }
): Promise<string | null> {
  const hasPasswordField = await page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);

  const verifySelectorFound = opts.verifySelector
    ? (await page
        .locator(opts.verifySelector)
        .count()
        .catch(() => 0)) > 0
    : undefined;

  return detectAuthFailure({
    requestedUrl,
    finalUrl: page.url(),
    status: response?.status() ?? null,
    hasPasswordField,
    loginUrl: opts.loginUrl,
    verifySelector: opts.verifySelector,
    verifySelectorFound,
  });
}

export const INVALID_AUTH_MESSAGE =
  'Authentication state appears invalid or expired.\n' +
  'Run `design-auditor auth <login-url>` again or provide a valid --storage-state.';
