import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { detectAuthFailure, isLoginLikeUrl } from '@/auth/validate.js';
import { loadStorageState } from '@/auth/storage-state.js';
import { redactSecrets } from '@/auth/redact.js';
import { readCredentials } from '@/auth/form-login.js';
import { validateConfig, FormAuthConfig } from '@/config.js';
import { AuthError, ConfigError } from '@/errors.js';

const base = {
  requestedUrl: 'https://app.test/dashboard',
  finalUrl: 'https://app.test/dashboard',
  status: 200,
  hasPasswordField: false,
};

describe('detectAuthFailure', () => {
  it('passes an authenticated page', () => {
    expect(detectAuthFailure(base)).toBeNull();
  });

  it('fails on 401 and 403', () => {
    expect(detectAuthFailure({ ...base, status: 401 })).toMatch(/401/);
    expect(detectAuthFailure({ ...base, status: 403 })).toMatch(/403/);
  });

  it('fails on redirect to a login-like path (server or client side)', () => {
    for (const p of [
      '/login?returnUrl=%2Fdashboard',
      '/signin',
      '/auth/sso',
      '/users/sign_in',
    ]) {
      expect(
        detectAuthFailure({ ...base, finalUrl: `https://app.test${p}` })
      ).toMatch(/login/);
    }
  });

  it('fails on redirect to the configured login URL even with an unusual path', () => {
    expect(
      detectAuthFailure({
        ...base,
        finalUrl: 'https://app.test/welcome',
        loginUrl: 'https://app.test/welcome',
      })
    ).toMatch(/login/);
  });

  it('fails on redirect to another origin (identity provider)', () => {
    expect(
      detectAuthFailure({
        ...base,
        finalUrl: 'https://id.provider.test/realms/x/auth',
      })
    ).toMatch(/another origin/);
  });

  it('fails when redirected to a page with a password field', () => {
    expect(
      detectAuthFailure({
        ...base,
        finalUrl: 'https://app.test/',
        hasPasswordField: true,
      })
    ).toMatch(/password/);
  });

  it('does not fail a settings page that legitimately has a password field', () => {
    expect(
      detectAuthFailure({
        ...base,
        requestedUrl: 'https://app.test/settings/security',
        finalUrl: 'https://app.test/settings/security',
        hasPasswordField: true,
      })
    ).toBeNull();
  });

  it('fails when the configured verify selector is missing', () => {
    expect(
      detectAuthFailure({
        ...base,
        verifySelector: '#user-menu',
        verifySelectorFound: false,
      })
    ).toMatch(/#user-menu/);
  });

  it('does not flag the login page itself when it was requested', () => {
    expect(
      detectAuthFailure({
        ...base,
        requestedUrl: 'https://app.test/login',
        finalUrl: 'https://app.test/login',
        hasPasswordField: true,
      })
    ).toBeNull();
  });

  it('isLoginLikeUrl does not match look-alike words', () => {
    expect(isLoginLikeUrl('https://app.test/authors')).toBe(false);
    expect(isLoginLikeUrl('https://app.test/blog/login-tips/x')).toBe(false);
  });
});

describe('loadStorageState', () => {
  let dir: string;
  const SECRET = 'sk_live_super_secret_cookie_value';
  const write = (name: string, content: string) => {
    dir ??= mkdtempSync(path.join(tmpdir(), 'da-state-'));
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  };
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined as unknown as string;
  });

  it('loads a valid state and summarizes without exposing values', () => {
    const file = write(
      'ok.json',
      JSON.stringify({
        cookies: [
          { name: 'sid', value: SECRET, expires: -1 },
          { name: 'old', value: 'x', expires: 1 },
        ],
        origins: [],
        sessionStorage: [
          {
            origin: 'https://app.test',
            sessionStorage: [{ name: 't', value: 'v' }],
          },
        ],
      })
    );
    const state = loadStorageState(file);
    expect(state.summary).toEqual({
      cookies: 2,
      expiredCookies: 1,
      origins: 0,
      sessionStorageOrigins: 1,
    });
    expect(state.playwright).not.toHaveProperty('sessionStorage');
    expect(state.sessionStorage[0].origin).toBe('https://app.test');
  });

  it('reports a missing file with re-auth guidance', () => {
    expect(() => loadStorageState('/nope/auth.json')).toThrowError(AuthError);
    expect(() => loadStorageState('/nope/auth.json')).toThrowError(
      /design-auditor auth/
    );
  });

  it('never echoes file contents for invalid JSON', () => {
    const file = write('bad.json', SECRET);
    try {
      loadStorageState(file);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      // V8's JSON.parse message quotes ~10 chars of input — none may leak
      expect((err as Error).message).not.toContain(SECRET.slice(0, 6));
      expect((err as Error).message).toMatch(/not valid JSON/);
    }
  });

  it('rejects JSON that is not a storage state, without echoing it', () => {
    const file = write('wrong.json', JSON.stringify({ token: SECRET }));
    try {
      loadStorageState(file);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(SECRET);
      expect((err as Error).message).toMatch(/cookies/);
    }
  });
});

describe('redactSecrets', () => {
  it('removes secret values and their URL-encoded form', () => {
    const out = redactSecrets('pw=p@ss w0rd! and p%40ss%20w0rd!', [
      'p@ss w0rd!',
    ]);
    expect(out).not.toContain('p@ss');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts token-like query parameters', () => {
    expect(
      redactSecrets('https://a.test/cb?code=abc123&state=ok&access_token=zzz')
    ).toBe(
      'https://a.test/cb?code=[REDACTED]&state=ok&access_token=[REDACTED]'
    );
  });
});

describe('form login credentials', () => {
  const auth = validateConfig({
    auth: {
      type: 'form',
      loginUrl: 'https://app.test/login',
      username: { selector: '#u', env: 'DA_USER' },
      password: { selector: '#p', env: 'DA_PASS' },
      submit: { selector: 'button' },
    },
  }).auth as FormAuthConfig;

  it('reads credentials from the environment', () => {
    expect(readCredentials(auth, { DA_USER: 'u', DA_PASS: 'p' })).toEqual({
      username: 'u',
      password: 'p',
    });
  });

  it('names missing variables without values', () => {
    expect(() => readCredentials(auth, { DA_USER: 'someone' })).toThrowError(
      /DA_PASS/
    );
    try {
      readCredentials(auth, { DA_USER: 'someone' });
    } catch (err) {
      expect((err as Error).message).not.toContain('someone');
    }
  });
});

describe('validateConfig', () => {
  it('rejects literal credentials', () => {
    expect(() =>
      validateConfig({
        auth: { type: 'form', password: { selector: '#p', value: 'hunter2' } },
      })
    ).toThrowError(ConfigError);
  });

  it('rejects tokens/cookies in config', () => {
    expect(() => validateConfig({ auth: { token: 'abc' } })).toThrowError(
      /storage state/
    );
  });

  it('requires the form login fields', () => {
    expect(() =>
      validateConfig({
        auth: { type: 'form', loginUrl: 'https://a.test/login' },
      })
    ).toThrowError(/username/);
  });

  it('validates crawl settings', () => {
    expect(() => validateConfig({ crawl: { maxPages: -1 } })).toThrowError(
      /maxPages/
    );
    expect(() => validateConfig({ crawl: { include: '/a' } })).toThrowError(
      /include/
    );
    expect(
      validateConfig({ crawl: { maxPages: 5, seeds: ['/x'] } }).crawl?.maxPages
    ).toBe(5);
  });
});
