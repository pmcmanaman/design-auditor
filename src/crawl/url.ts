// Pure URL helpers for the crawler. Kept free of Playwright so they are
// cheap to unit test.

const MAX_URL_LENGTH = 2048;

// Resolve, then canonicalize so trivially different spellings dedupe:
// no fragment, lowercase host, no default port, no trailing slash, sorted query.
export function normalizeUrl(href: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(href, base) : new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  url.searchParams.sort();

  const out = url.toString();
  return out.length > MAX_URL_LENGTH ? null : out;
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// Words that mark a link as state-changing. Matched against the URL and the
// link's visible text / aria-label. Conservative on purpose.
const UNSAFE_WORDS = [
  'log[\\s_-]?out',
  'log[\\s_-]?off',
  'sign[\\s_-]?out',
  'sign[\\s_-]?off',
  'delete',
  'remove',
  'destroy',
  'unsubscribe',
  'cancel[\\s_-]?(?:my[\\s_-]?)?(?:account|subscription|plan|membership)',
  'close[\\s_-]?account',
  'terminate',
  'revoke',
  'deactivate',
  'disable[\\s_-]?account',
  'purge',
  'wipe',
  'reset[\\s_-]?(?:all|account|data)',
];
const UNSAFE = new RegExp(
  `(?:^|[^a-z])(?:${UNSAFE_WORDS.join('|')})(?:[^a-z]|$)`,
  'i'
);

export function looksDestructive(text: string | undefined | null): boolean {
  if (!text) return false;
  // split camelCase so "deleteItem" reads as "delete-item"
  const spaced = text.replace(/([a-z])([A-Z])/g, '$1-$2');
  let decoded = spaced;
  try {
    decoded = decodeURIComponent(spaced);
  } catch {
    // keep the raw text
  }
  return UNSAFE.test(decoded);
}

// Routes that may act just by loading: create a draft record on mount, start
// an AI generation job, or begin an OAuth/connect flow. Matched against whole
// path segments only, so "/drafts" or a link labeled "Add" are unaffected.
const ACTION_SEGMENT =
  /^(?:new|add|create|draft|wizard|authorize|oauth2?|generate(?:-[a-z0-9-]+)?)$/i;

export function isActionRoute(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep the raw segment
      }
      return ACTION_SEGMENT.test(decoded);
    });
}

const BLOCKED_SCHEMES = /^\s*(mailto|tel|sms|javascript|data|blob|file|ftp):/i;

export function hasBlockedScheme(href: string): boolean {
  return BLOCKED_SCHEMES.test(href);
}

const NON_HTML_EXT =
  /\.(pdf|zip|gz|tgz|tar|rar|7z|png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp3|mp4|m4a|mov|avi|webm|wav|ogg|csv|tsv|xlsx?|docx?|pptx?|odt|ods|txt|xml|json|rss|atom|dmg|exe|msi|pkg|apk|ics|vcf|woff2?|ttf|otf|eot|css|js|mjs|map|wasm)$/i;

export function isNonHtmlResource(url: string): boolean {
  try {
    return NON_HTML_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// Glob → RegExp. `*` matches within one path segment, `**` across segments,
// and a trailing `/**` also matches the bare prefix (`/admin/**` ⊇ `/admin`).
export function globToRegExp(glob: string): RegExp {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const trailing = i + 2 === glob.length && src.endsWith('/');
        if (trailing) {
          src = src.slice(0, -1) + '(?:/.*)?';
        } else {
          src += '.*';
        }
        i++;
      } else {
        src += '[^/]*';
      }
    } else if (ch === '?') {
      src += '[^/]';
    } else {
      src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${src}$`);
}

// Patterns match the pathname; patterns starting with http(s) match the full URL.
export function matchesPattern(url: string, pattern: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const target = /^https?:\/\//i.test(pattern)
    ? `${parsed.origin}${parsed.pathname}`
    : parsed.pathname;
  return globToRegExp(pattern).test(target);
}

export function isAllowedByPatterns(
  url: string,
  include: string[] = [],
  exclude: string[] = []
): boolean {
  if (exclude.some((p) => matchesPattern(url, p))) return false;
  if (include.length > 0 && !include.some((p) => matchesPattern(url, p)))
    return false;
  return true;
}
