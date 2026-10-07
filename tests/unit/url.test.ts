import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  isSameOrigin,
  looksDestructive,
  hasBlockedScheme,
  isNonHtmlResource,
  globToRegExp,
  isAllowedByPatterns,
} from '@/crawl/url.js';

describe('normalizeUrl', () => {
  it('removes fragments', () => {
    expect(normalizeUrl('https://app.test/a#section')).toBe(
      'https://app.test/a'
    );
  });

  it('strips trailing slashes except on the root', () => {
    expect(normalizeUrl('https://app.test/a/')).toBe('https://app.test/a');
    expect(normalizeUrl('https://app.test/')).toBe('https://app.test/');
  });

  it('lowercases the host and drops default ports', () => {
    expect(normalizeUrl('HTTPS://App.TEST:443/Path')).toBe(
      'https://app.test/Path'
    );
    expect(normalizeUrl('http://app.test:80/')).toBe('http://app.test/');
    expect(normalizeUrl('http://app.test:8080/')).toBe('http://app.test:8080/');
  });

  it('sorts query parameters so equivalent URLs dedupe', () => {
    expect(normalizeUrl('https://app.test/l?b=2&a=1')).toBe(
      normalizeUrl('https://app.test/l?a=1&b=2')
    );
  });

  it('resolves relative links against a base', () => {
    expect(normalizeUrl('../b', 'https://app.test/x/y')).toBe(
      'https://app.test/b'
    );
    expect(normalizeUrl('?page=2', 'https://app.test/list')).toBe(
      'https://app.test/list?page=2'
    );
  });

  it('drops embedded credentials', () => {
    expect(normalizeUrl('https://user:pw@app.test/a')).toBe(
      'https://app.test/a'
    );
  });

  it('rejects non-http(s) and invalid URLs', () => {
    expect(normalizeUrl('mailto:a@b.c')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('isSameOrigin', () => {
  it('compares scheme, host and port', () => {
    expect(isSameOrigin('https://app.test/a', 'https://app.test/b')).toBe(true);
    expect(isSameOrigin('https://app.test', 'http://app.test')).toBe(false);
    expect(isSameOrigin('https://app.test', 'https://api.app.test')).toBe(
      false
    );
    expect(isSameOrigin('https://app.test', 'https://app.test:8443')).toBe(
      false
    );
  });
});

describe('looksDestructive', () => {
  it.each([
    '/logout',
    '/log-out',
    '/auth/sign_out',
    'Sign out',
    'Log Off',
    '/orders/1/delete',
    '/items/remove?id=3',
    'Destroy workspace',
    '/email/unsubscribe',
    'Cancel account',
    '/account/cancel-subscription',
    'Terminate instance',
    '/tokens/revoke',
    'Deactivate',
    '/api/deleteItem',
    '/a%2Fdelete',
  ])('flags %s', (text) => {
    expect(looksDestructive(text)).toBe(true);
  });

  it.each([
    '/dashboard',
    '/settings/profile',
    'Orders',
    '/removed-items-archive', // "removed" is not "remove"
    '/deleted',
    '/logs/output',
    'Cancel',
    '',
  ])('allows %s', (text) => {
    expect(looksDestructive(text)).toBe(false);
  });
});

describe('hasBlockedScheme / isNonHtmlResource', () => {
  it('blocks non-navigation schemes', () => {
    for (const href of [
      'mailto:x@y.z',
      'tel:+1',
      'javascript:void(0)',
      'data:text/html,x',
      ' JavaScript:alert(1)',
    ]) {
      expect(hasBlockedScheme(href)).toBe(true);
    }
    expect(hasBlockedScheme('/relative')).toBe(false);
    expect(hasBlockedScheme('https://app.test')).toBe(false);
  });

  it('detects files by extension', () => {
    expect(isNonHtmlResource('https://app.test/export.pdf')).toBe(true);
    expect(isNonHtmlResource('https://app.test/data.CSV?x=1')).toBe(true);
    expect(isNonHtmlResource('https://app.test/reports')).toBe(false);
    expect(isNonHtmlResource('https://app.test/page.html')).toBe(false);
  });
});

describe('include / exclude globs', () => {
  it('* stays within a segment, ** crosses segments', () => {
    expect(globToRegExp('/users/*').test('/users/42')).toBe(true);
    expect(globToRegExp('/users/*').test('/users/42/edit')).toBe(false);
    expect(globToRegExp('/users/**').test('/users/42/edit')).toBe(true);
  });

  it('trailing /** also matches the bare prefix', () => {
    expect(globToRegExp('/admin/**').test('/admin')).toBe(true);
    expect(globToRegExp('/admin/**').test('/administrator')).toBe(false);
  });

  it('escapes regex characters', () => {
    expect(globToRegExp('/a.b').test('/aXb')).toBe(false);
  });

  it('exclude wins over include', () => {
    const url = 'https://app.test/dashboard/admin';
    expect(
      isAllowedByPatterns(url, ['/dashboard/**'], ['/dashboard/admin'])
    ).toBe(false);
    expect(isAllowedByPatterns(url, ['/dashboard/**'], [])).toBe(true);
  });

  it('non-empty include list requires a match', () => {
    expect(
      isAllowedByPatterns('https://app.test/settings', ['/dashboard/**'])
    ).toBe(false);
    expect(isAllowedByPatterns('https://app.test/settings')).toBe(true);
  });

  it('full-URL patterns match origin + path', () => {
    expect(
      isAllowedByPatterns('https://app.test/x/y', ['https://app.test/x/**'])
    ).toBe(true);
  });
});
