import { Page } from 'playwright';

// Static, script-free copy of the rendered page. Stylesheets are inlined (with
// absolute url()s) so it renders on its own; images and fonts still load from
// the site when online. App scripts, frames, event handlers, CSRF tokens,
// password and hidden-input values are removed. The CSP blocks any network
// calls from scripts and form submissions, so opening it can't touch the app.
export const SNAPSHOT_CSP =
  "script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'";

export interface PageSnapshot {
  html: string;
  url: string;
  viewport: { width: number; height: number };
  capturedAt: string;
}

export async function captureSnapshot(page: Page): Promise<PageSnapshot> {
  const html = await page.evaluate((csp) => {
    const base = location.href;
    const isLocalRef = (u: string) => /^\s*(#|data:|blob:|about:)/i.test(u);
    const abs = (u: string, from = base) => {
      if (!u || isLocalRef(u)) return u;
      try {
        return new URL(u.trim(), from).href;
      } catch {
        return u;
      }
    };
    const absCss = (css: string, from: string) =>
      css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _q, u) =>
        isLocalRef(u) ? match : `url("${abs(u, from)}")`
      );

    // CSS text for every readable stylesheet, keyed by its <style>/<link>
    const cssByNode = new Map<Node, string | null>();
    for (const sheet of Array.from(document.styleSheets)) {
      if (!sheet.ownerNode) continue;
      try {
        const text = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('\n');
        cssByNode.set(sheet.ownerNode, absCss(text, sheet.href || base));
      } catch {
        cssByNode.set(sheet.ownerNode, null); // cross-origin: keep the <link>
      }
    }
    // constructable stylesheets (CSS-in-JS) have no DOM node
    const adopted = (document.adoptedStyleSheets || [])
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules)
            .map((r) => r.cssText)
            .join('\n');
        } catch {
          return '';
        }
      })
      .join('\n');

    const root = document.documentElement;
    const clone = root.cloneNode(true) as HTMLElement;
    // querySelectorAll order is identical in the original and the clone
    const originals = Array.from(root.querySelectorAll('*'));
    const copies = Array.from(clone.querySelectorAll('*'));

    for (let i = 0; i < originals.length; i++) {
      const o = originals[i];
      const c = copies[i];
      const tag = o.tagName.toLowerCase();

      if (tag === 'input') {
        const input = o as HTMLInputElement;
        if (input.type === 'password' || input.type === 'hidden') {
          c.removeAttribute('value');
        } else if (input.type === 'checkbox' || input.type === 'radio') {
          if (input.checked) c.setAttribute('checked', '');
          else c.removeAttribute('checked');
        } else if (input.type !== 'file') {
          c.setAttribute('value', input.value);
        }
      } else if (tag === 'textarea') {
        c.textContent = (o as HTMLTextAreaElement).value;
      } else if (tag === 'select') {
        const opts = Array.from((o as HTMLSelectElement).options);
        const copyOpts = Array.from(c.querySelectorAll('option'));
        opts.forEach((opt, j) => {
          if (!copyOpts[j]) return;
          if (opt.selected) copyOpts[j].setAttribute('selected', '');
          else copyOpts[j].removeAttribute('selected');
        });
      } else if (tag === 'canvas') {
        try {
          const img = document.createElement('img');
          img.src = (o as HTMLCanvasElement).toDataURL();
          img.setAttribute('style', o.getAttribute('style') || '');
          img.className = o.className;
          img.width = (o as HTMLCanvasElement).width;
          img.height = (o as HTMLCanvasElement).height;
          c.replaceWith(img);
        } catch {
          // tainted canvas — leave it blank
        }
      } else if (tag === 'iframe') {
        const r = o.getBoundingClientRect();
        const ph = document.createElement('div');
        ph.setAttribute(
          'style',
          `width:${r.width}px;height:${r.height}px;display:${getComputedStyle(o).display};` +
            'background:repeating-linear-gradient(45deg,#eee 0 8px,#f8f8f8 8px 16px);'
        );
        ph.setAttribute('data-da-removed', 'iframe');
        c.replaceWith(ph);
      } else if (cssByNode.has(o)) {
        const text = cssByNode.get(o);
        if (text !== null && text !== undefined) {
          const style = document.createElement('style');
          const href = o.getAttribute('href');
          if (href) style.setAttribute('data-da-from', abs(href));
          const media = o.getAttribute('media');
          if (media) style.setAttribute('media', media);
          style.textContent = text;
          c.replaceWith(style);
        }
      }
    }

    // remove anything that executes, fetches, or carries secrets
    clone
      .querySelectorAll(
        'script, noscript, object, embed, base, meta[http-equiv], ' +
          'link[rel~="preload"], link[rel~="modulepreload"], link[rel~="prefetch"], ' +
          'link[rel~="dns-prefetch"], link[rel~="preconnect"], link[rel~="manifest"], ' +
          'meta[name*="csrf" i], meta[name*="xsrf" i], meta[name*="token" i]'
      )
      .forEach((el) => el.remove());

    for (const el of Array.from(clone.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value;
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if (
          (name === 'href' || name === 'src' || name === 'xlink:href') &&
          /^\s*javascript:/i.test(value)
        ) {
          el.removeAttribute(attr.name);
        } else if (
          ['src', 'href', 'poster', 'xlink:href', 'data-src'].includes(name)
        ) {
          el.setAttribute(attr.name, abs(value));
        } else if (name === 'srcset' || name === 'data-srcset') {
          el.setAttribute(
            attr.name,
            value
              .split(',')
              .map((part) => {
                const [u, ...rest] = part.trim().split(/\s+/);
                return [abs(u), ...rest].join(' ');
              })
              .join(', ')
          );
        } else if (name === 'style' && value.includes('url(')) {
          el.setAttribute('style', absCss(value, base));
        } else if (name === 'action' || name === 'formaction') {
          el.setAttribute(attr.name, '#');
        }
      }
    }

    let head = clone.querySelector('head');
    if (!head) {
      head = document.createElement('head');
      clone.insertBefore(head, clone.firstChild);
    }
    const cspMeta = document.createElement('meta');
    cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
    cspMeta.setAttribute('content', csp);
    const charset = document.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    const referrer = document.createElement('meta');
    referrer.setAttribute('name', 'referrer');
    referrer.setAttribute('content', 'no-referrer');
    head.querySelectorAll('meta[charset]').forEach((m) => m.remove());
    head.prepend(charset, cspMeta, referrer);
    if (adopted.trim()) {
      const style = document.createElement('style');
      style.setAttribute('data-da-from', 'adoptedStyleSheets');
      style.textContent = absCss(adopted, base);
      head.appendChild(style);
    }

    return clone.outerHTML;
  }, SNAPSHOT_CSP);

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const url = page.url();
  const capturedAt = new Date().toISOString();
  // "--" can't appear inside an HTML comment
  const comment = `<!-- design-auditor snapshot of ${url.replace(/--/g, '-\\-')} · ${capturedAt} · viewport ${viewport.width}x${viewport.height}. Static copy: app scripts removed. -->`;

  return {
    html: `<!doctype html>\n${comment}\n${html}`,
    url,
    viewport,
    capturedAt,
  };
}
