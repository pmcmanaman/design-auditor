// Tiny authenticated web app for integration tests. Cookie sessions, a login
// form, consistently styled pages with a few planted design outliers, and
// destructive links that must never be visited by the crawler.
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { AddressInfo } from 'net';

export const FIXTURE_USER = 'qa@example.com';
export const FIXTURE_PASSWORD = 'fixture-pw-7f3k9q';

export interface FixtureServer {
  url: string;
  hits: string[];
  sessions: Set<string>;
  close: () => Promise<void>;
}

const CSS = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 24px; margin: 0; color: #1f2937; background: #ffffff; }
  nav { display: flex; gap: 16px; padding: 16px 24px; background: #f3f4f6; }
  nav a { font-size: 14px; font-weight: 500; color: #374151; text-decoration: none; padding: 8px 16px; }
  main { padding: 24px 32px; }
  h1 { font-size: 32px; font-weight: 700; margin: 0 0 24px; }
  h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0 0 16px; }
  .card { padding: 16px; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff; }
  .btn { font-size: 14px; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 0; background: #3b82f6; color: #ffffff; height: 40px; }
  .btn-secondary { background: #ffffff; color: #374151; border: 1px solid #d1d5db; }
  label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 8px; }
  input { font-size: 16px; padding: 8px 16px; border: 1px solid #d1d5db; border-radius: 8px; height: 40px; margin-bottom: 16px; }
  .links a { color: #3b82f6; margin-right: 16px; }
`;

function layout(title: string, body: string, opts: { nav?: boolean } = {}) {
  const nav =
    opts.nav === false
      ? ''
      : `<nav>
        <a href="/dashboard">Dashboard</a>
        <a href="/orders">Orders</a>
        <a href="/settings">Settings</a>
        <a href="/settings/profile">Profile</a>
        <a href="/settings/billing#plan">Billing</a>
        <a href="/logout">Log out</a>
      </nav>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>
  <body>${nav}<main>${body}</main></body></html>`;
}

function card(title: string, text: string, extra = '') {
  return `<div class="card"><h2>${title}</h2><p>${text}</p>${extra}
    <button class="btn">Open</button> <button class="btn btn-secondary">Details</button></div>`;
}

function cards(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) =>
    card(
      `${prefix} ${i + 1}`,
      `Summary text for ${prefix.toLowerCase()} item number ${i + 1} in the fixture app.`
    )
  ).join('\n');
}

const PAGES: Record<string, () => string> = {
  '/dashboard': () =>
    layout(
      'Dashboard',
      `<h1>Dashboard</h1>
      <div class="card" data-testid="recent-orders" style="padding-top: 18px">
        <h2>Recent orders</h2><p>Orders placed in the last week.</p>
        <button class="btn">View all</button></div>
      ${cards('Metric', 6)}
      <div class="links">
        <a href="/orders/1">Order 1</a>
        <a href="/orders/1/delete">Delete order 1</a>
        <a href="/old-settings">Old settings</a>
        <a href="mailto:support@example.com">Email support</a>
        <a href="tel:+15550100">Call</a>
        <a href="javascript:void(0)">Noop</a>
        <a href="https://example.org/external">External</a>
        <a href="/export.pdf">Export PDF</a>
        <a href="/report" download>Download report</a>
        <a href="/list?page=1">Paged list</a>
      </div>`
    ),
  '/orders': () =>
    layout(
      'Orders',
      `<h1>Orders</h1>${cards('Order', 6)}
      <div class="card"><h2>Bulk actions</h2><p>Act on many orders at once.</p>
        <button class="btn" style="border-radius: 6px" data-testid="bulk-export">Export</button></div>
      <div class="links"><a href="/orders/1">Order 1</a><a href="/orders/2">Order 2</a>
      <a href="/account/close" aria-label="Cancel account">Leave</a></div>`
    ),
  '/orders/1': () => layout('Order 1', `<h1>Order 1</h1>${cards('Line', 4)}`),
  '/orders/2': () => layout('Order 2', `<h1>Order 2</h1>${cards('Line', 4)}`),
  '/settings': () =>
    layout(
      'Settings',
      `<h1>Settings</h1>${cards('Preference', 5)}
      <a href="/settings/danger/revoke-tokens">Revoke all tokens</a>`
    ),
  '/settings/profile': () =>
    layout(
      'Profile',
      `<h1>Profile</h1>
      <label for="name">Name</label><input id="name" value="QA">
      <label for="email">Email</label><input id="email" value="qa@example.com">
      <p style="color: #3a82f6" data-testid="profile-hint">Your profile is visible to teammates.</p>
      ${cards('Section', 4)}`
    ),
  '/settings/billing': () =>
    layout(
      'Billing',
      `<h1>Billing</h1>
      <div class="card"><h2 style="font-size: 15px; font-weight: 500" data-testid="billing-heading">Billing section</h2>
        <p>Your current plan and invoices.</p><button class="btn">Upgrade</button></div>
      ${cards('Invoice', 5)}`
    ),
};

export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  const hits: string[] = [];
  const sessions = new Set<string>();
  const sessionTokens = new Set<string>();

  const isAuthed = (req: IncomingMessage) => {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/);
    return !!m && sessions.has(m[1]);
  };

  const send = (
    res: ServerResponse,
    status: number,
    html: string,
    headers = {}
  ) => {
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      ...headers,
    });
    res.end(html);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    hits.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        if (
          form.get('email') === FIXTURE_USER &&
          form.get('password') === FIXTURE_PASSWORD
        ) {
          const sid = randomBytes(16).toString('hex');
          sessions.add(sid);
          res.writeHead(302, {
            location: '/dashboard',
            'set-cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
          });
          res.end();
        } else {
          send(res, 401, loginPage('Invalid email or password'));
        }
      });
      return;
    }
    // ── SPA area: session lives in sessionStorage, redirects happen client-side ──
    if (url.pathname === '/spa/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { email, password } = JSON.parse(body || '{}');
        if (email === FIXTURE_USER && password === FIXTURE_PASSWORD) {
          const token = randomBytes(16).toString('hex');
          sessionTokens.add(token);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ token }));
        } else {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end('{}');
        }
      });
      return;
    }
    if (url.pathname === '/spa/login') return send(res, 200, spaLoginPage());
    if (url.pathname.startsWith('/spa/')) {
      const page = SPA_PAGES[url.pathname];
      if (page) return send(res, 200, page());
    }
    if (url.pathname === '/login') return send(res, 200, loginPage());
    if (url.pathname === '/') {
      res.writeHead(302, { location: isAuthed(req) ? '/dashboard' : '/login' });
      return res.end();
    }

    if (!isAuthed(req)) {
      res.writeHead(302, {
        location: `/login?next=${encodeURIComponent(url.pathname)}`,
      });
      return res.end();
    }

    if (url.pathname === '/logout') {
      sessions.clear();
      res.writeHead(302, { location: '/login' });
      return res.end();
    }
    if (url.pathname === '/old-settings') {
      res.writeHead(301, { location: '/settings' });
      return res.end();
    }
    if (url.pathname === '/list') {
      // endless pagination: only max-pages / max-depth stop this
      const n = Number(url.searchParams.get('page') || '1');
      return send(
        res,
        200,
        layout(
          `List ${n}`,
          `<h1>List page ${n}</h1>${cards('Row', 3)}
        <a href="/list?page=${n + 1}">Next</a>`
        )
      );
    }

    const page = PAGES[url.pathname];
    if (page) return send(res, 200, page());
    send(res, 404, layout('Not found', '<h1>Not found</h1>'));
  });

  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve)
  );
  const { port: actual } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${actual}`,
    hits,
    sessions,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Client-side guard like a typical SPA: no token in sessionStorage → login
const SPA_GUARD = `<script>
  if (!sessionStorage.getItem('_app_token')) {
    location.replace('/spa/login?returnUrl=' + encodeURIComponent(location.pathname));
  }
</script>`;

const SPA_PAGES: Record<string, () => string> = {
  '/spa/home': () =>
    layout(
      'SPA Home',
      `${SPA_GUARD}<h1>SPA home</h1>${cards('Widget', 3)}
      <a href="/spa/reports">Reports</a>`,
      { nav: false }
    ),
  '/spa/reports': () =>
    layout(
      'SPA Reports',
      `${SPA_GUARD}<h1>SPA reports</h1>${cards('Report', 3)}`,
      { nav: false }
    ),
};

function spaLoginPage() {
  // unnamed inputs and a type=button submit, as many component libraries render
  return layout(
    'Login',
    `<h1>Login</h1>
    <input type="text" placeholder="Email"><input type="password" placeholder="Password">
    <button class="btn" type="button" id="go">Sign In</button>
    <script>
      document.getElementById('go').addEventListener('click', async () => {
        const [email, password] = [...document.querySelectorAll('input')].map((i) => i.value);
        const r = await fetch('/spa/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (!r.ok) return;
        sessionStorage.setItem('_app_token', (await r.json()).token);
        const next = new URLSearchParams(location.search).get('returnUrl') || '/spa/home';
        location.assign(next);
      });
    </script>`,
    { nav: false }
  );
}

function loginPage(error = '') {
  return layout(
    'Sign in',
    `<h1>Sign in</h1>
    ${error ? `<p role="alert">${error}</p>` : ''}
    <form method="post" action="/login">
      <label for="email">Email</label><input id="email" name="email" type="email">
      <label for="password">Password</label><input id="password" name="password" type="password">
      <button class="btn" type="submit">Sign in</button>
    </form>`,
    { nav: false }
  );
}

// `npx tsx tests/fixtures/app/server.ts [port]` for manual runs
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  startFixtureServer(Number(process.argv[2] || 4321)).then((s) =>
    console.log(`fixture app on ${s.url}`)
  );
}
