import { existsSync, readFileSync } from 'fs';
import { ConfigError } from '@/errors.js';

export interface SelectorStep {
  selector: string;
}

export interface CredentialField extends SelectorStep {
  // name of the environment variable holding the value — never the value itself
  env: string;
}

export interface AuthConfig {
  type?: 'form' | 'storage-state';
  loginUrl?: string;
  // storage state file, equivalent to --storage-state
  storageState?: string;
  // element that only exists for signed-in users, checked on every page
  verify?: { selector?: string };

  // form login (type: 'form')
  username?: CredentialField;
  next?: SelectorStep; // two-step logins: click after entering the username
  password?: CredentialField;
  submit?: SelectorStep;
  success?: { urlContains?: string; selector?: string };
  timeoutMs?: number;
}

export interface FormAuthConfig extends AuthConfig {
  type: 'form';
  loginUrl: string;
  username: CredentialField;
  password: CredentialField;
  submit: SelectorStep;
}

export interface CrawlConfig {
  maxPages?: number;
  maxDepth?: number;
  include?: string[];
  exclude?: string[];
  // extra entry points (paths or same-origin URLs) for routes not linked via <a href>
  seeds?: string[];
}

export interface AuditorConfig {
  auth?: AuthConfig;
  crawl?: CrawlConfig;
}

export function loadConfig(filePath: string): AuditorConfig {
  if (!existsSync(filePath)) {
    throw new ConfigError(`Config file not found: ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    throw new ConfigError(`Config file is not valid JSON: ${filePath}`);
  }
  return validateConfig(raw, filePath);
}

export function validateConfig(raw: unknown, source = 'config'): AuditorConfig {
  if (!isObject(raw)) throw new ConfigError(`${source}: expected an object`);
  const config = raw as AuditorConfig;

  if (config.auth !== undefined) validateAuth(config.auth, source);

  if (config.crawl !== undefined) {
    const c = config.crawl;
    if (!isObject(c))
      throw new ConfigError(`${source}: "crawl" must be an object`);
    for (const key of ['maxPages', 'maxDepth'] as const) {
      if (c[key] !== undefined && !(Number.isInteger(c[key]) && c[key]! >= 0)) {
        throw new ConfigError(
          `${source}: crawl.${key} must be a non-negative integer`
        );
      }
    }
    for (const key of ['include', 'exclude', 'seeds'] as const) {
      if (
        c[key] !== undefined &&
        !(Array.isArray(c[key]) && c[key]!.every((p) => typeof p === 'string'))
      ) {
        throw new ConfigError(
          `${source}: crawl.${key} must be an array of strings`
        );
      }
    }
  }

  return config;
}

function validateAuth(auth: AuthConfig, source: string) {
  if (!isObject(auth))
    throw new ConfigError(`${source}: "auth" must be an object`);

  // Refuse literal credentials outright so they never end up in a repo
  for (const field of ['username', 'password'] as const) {
    const f = auth[field] as unknown as Record<string, unknown> | undefined;
    if (f && ('value' in f || 'text' in f)) {
      throw new ConfigError(
        `${source}: auth.${field} must reference an environment variable via "env"; literal credentials are not supported`
      );
    }
  }
  if ('token' in auth || 'cookie' in auth || 'cookies' in auth) {
    throw new ConfigError(
      `${source}: put session tokens or cookies in a storage state file (design-auditor auth), not in the config`
    );
  }

  if (auth.loginUrl !== undefined)
    assertUrl(auth.loginUrl, `${source}: auth.loginUrl`);

  if (auth.type === 'form') {
    if (!auth.loginUrl)
      throw new ConfigError(
        `${source}: auth.loginUrl is required for form login`
      );
    for (const field of ['username', 'password'] as const) {
      const f = auth[field];
      if (!f?.selector || !f?.env) {
        throw new ConfigError(
          `${source}: auth.${field} needs "selector" and "env" (the environment variable name)`
        );
      }
    }
    if (!auth.submit?.selector) {
      throw new ConfigError(
        `${source}: auth.submit.selector is required for form login`
      );
    }
  } else if (auth.type !== undefined && auth.type !== 'storage-state') {
    throw new ConfigError(
      `${source}: auth.type must be "form" or "storage-state"`
    );
  }
}

export function isFormAuth(auth?: AuthConfig): auth is FormAuthConfig {
  return auth?.type === 'form';
}

function assertUrl(value: string, label: string) {
  try {
    new URL(value);
  } catch {
    throw new ConfigError(`${label} is not a valid URL`);
  }
}

function isObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
