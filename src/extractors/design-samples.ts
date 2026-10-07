import { Page } from 'playwright';

// ─── Types ────────────────────────────────────────────────────────────────────

// Points at one element: a readable selector, plus `ref`, the element's
// data-da-i stamp (exact even when the selector matches several elements),
// and the precise CSS property that carries the value (e.g. padding-top)
export interface ElementRef {
  selector: string;
  ref?: string;
  property?: string;
}

export interface ValueStat {
  count: number;
  examples: ElementRef[]; // a few elements using the value
}

// attribute stamped on every measured element; snapshots keep it
export const REF_ATTR = 'data-da-i';

// property → value → stat
export type Distributions = Record<string, Record<string, ValueStat>>;

export type ComponentGroup =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body-text'
  | 'label'
  | 'link'
  | 'button-primary'
  | 'button-secondary'
  | 'button-danger'
  | 'button-icon'
  | 'input'
  | 'textarea'
  | 'select'
  | 'card'
  | 'nav-item';

export interface ComponentSample {
  group: ComponentGroup;
  selector: string;
  ref?: string;
  text: string;
  tag: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  backgroundColor: string;
  borderRadius: string;
  borderWidth: string;
  boxShadow: string;
  padding: string;
  height?: number; // controls only — text blocks grow with content
}

export interface PageDesignSnapshot {
  url: string;
  elementCount: number;
  truncated: boolean;
  distributions: Distributions;
  groups: Partial<Record<ComponentGroup, ComponentSample[]>>;
}

export interface DesignSampleOptions {
  maxElements: number;
  maxPerGroup: number;
  maxExamples: number;
}

export const DEFAULT_SAMPLE_OPTIONS: DesignSampleOptions = {
  maxElements: 8000,
  maxPerGroup: 200,
  maxExamples: 3,
};

// ─── Extractor ────────────────────────────────────────────────────────────────
// Unlike the module extractors (which summarize one page for its own rules),
// this keeps element identity (selectors) and semantic roles so findings can
// be compared across pages. Everything is aggregated in the browser to keep
// the payload bounded on large pages.

export async function extractDesignSamples(
  page: Page,
  options: Partial<DesignSampleOptions> = {}
): Promise<PageDesignSnapshot> {
  const opts = { ...DEFAULT_SAMPLE_OPTIONS, ...options };
  const evalOpts = { ...opts, refAttr: REF_ATTR };

  const raw = await page.evaluate((o) => {
    const SKIP = new Set([
      'script',
      'style',
      'meta',
      'head',
      'link',
      'br',
      'hr',
      'noscript',
      'template',
      'svg',
      'path',
      'iframe',
    ]);

    const distributions: Record<
      string,
      Record<
        string,
        {
          count: number;
          examples: { selector: string; ref: string; property: string }[];
        }
      >
    > = {};
    const groups: Record<string, unknown[]> = {};

    // ── Color normalization: any CSS color syntax → #rrggbb / #rrggbbaa ──
    const colorCache = new Map<string, string | null>();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const hex2 = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, '0');

    const normColor = (css: string): string | null => {
      if (!css || css === 'transparent') return null;
      const cached = colorCache.get(css);
      if (cached !== undefined) return cached;

      let out: string | null = null;
      const m = css.match(
        /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/
      );
      if (m) {
        let a = m[4] === undefined ? 1 : parseFloat(m[4]);
        if (m[4] && m[4].endsWith('%')) a = a / 100;
        out =
          a <= 0.02
            ? null
            : '#' +
              hex2(+m[1]) +
              hex2(+m[2]) +
              hex2(+m[3]) +
              (a < 1 ? hex2(a * 255) : '');
      } else if (ctx) {
        // oklch(), lab(), color(srgb …) etc. — let the canvas convert to sRGB
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        out =
          d[3] <= 5
            ? null
            : '#' +
              hex2(d[0]) +
              hex2(d[1]) +
              hex2(d[2]) +
              (d[3] < 255 ? hex2(d[3]) : '');
      }
      colorCache.set(css, out);
      return out;
    };

    // ── Selectors ──
    const esc = (s: string) =>
      window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&');
    const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
    const testAttr = (el: Element) => {
      for (const attr of TEST_ATTRS) {
        const v = el.getAttribute(attr);
        if (v) return `[${attr}="${v.replace(/"/g, '\\"')}"]`;
      }
      return null;
    };
    // ids/classes that look generated (CSS-in-JS hashes, React useId) aren't stable
    const unstable =
      /\d{3,}|[0-9a-f]{6,}|^(css|sc|jsx|emotion|svelte)-|^[:_]|:/i;

    const selectorFor = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      for (let depth = 0; cur && depth < 4; depth++) {
        const t = testAttr(cur);
        if (t) {
          parts.unshift(t);
          break;
        }
        if (cur.id && !unstable.test(cur.id)) {
          parts.unshift('#' + esc(cur.id));
          break;
        }
        const tag = cur.tagName.toLowerCase();
        let part = tag;
        const classes = Array.from(cur.classList)
          .filter((c) => c.length < 40 && !unstable.test(c))
          .slice(0, 2);
        if (classes.length) part += '.' + classes.map(esc).join('.');
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter(
            (c) => c.tagName === cur!.tagName
          );
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        if (tag === 'body') break;
        cur = parent;
      }
      return parts.join(' > ');
    };

    // ── Recording ──
    const record = (
      prop: string,
      value: string,
      el: Element,
      property: string = prop
    ) => {
      const byValue = (distributions[prop] ||= {});
      const stat = (byValue[value] ||= { count: 0, examples: [] });
      stat.count++;
      if (stat.examples.length < o.maxExamples)
        stat.examples.push({
          selector: selectorFor(el),
          ref: el.getAttribute(o.refAttr) || '',
          property,
        });
    };

    const px = (v: string) => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : Math.round(n * 100) / 100;
    };

    // `rounded-full` computes to absurd lengths (e.g. 3.35544e+07px)
    const normRadius = (r: string) => {
      const parts = r
        .split(/\s+/)
        .map((t) => (parseFloat(t) >= 1000 ? 'full' : t));
      return parts.every((t) => t === 'full') ? 'full' : parts.join(' ');
    };

    // Drop invisible layers (Tailwind emits transparent ring/shadow
    // placeholders) so equal-looking shadows compare equal
    const cleanShadow = (shadow: string): string | null => {
      if (!shadow || shadow === 'none') return null;
      const layers = shadow
        .split(/,(?![^(]*\))/)
        .map((l) => l.trim())
        .filter((l) => {
          const alpha = l.match(/rgba?\([^)]*?[,/]\s*([\d.]+)\s*\)/);
          if (alpha && parseFloat(alpha[1]) === 0) return false;
          if (/transparent/.test(l)) return false;
          const nums = (l.match(/-?[\d.]+px/g) || []).map(parseFloat);
          return nums.some((n) => n !== 0);
        });
      return layers.length ? layers.join(', ') : null;
    };

    // auto and percentage margins compute to large fractional values that
    // reflect free space, not a spacing decision
    const isLayoutMargin = (v: number) =>
      v > 32 && Math.abs(v - Math.round(v)) > 0.01;

    const hasOwnText = (el: Element) => {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3 && (node.textContent || '').trim()) return true;
      }
      // form controls render their own text
      return ['input', 'textarea', 'select', 'button'].includes(
        el.tagName.toLowerCase()
      );
    };

    // ── Semantic grouping ──
    const isButtonLike = (el: Element, tag: string) => {
      if (tag === 'button') return true;
      const role = el.getAttribute('role');
      if (role === 'button') return true;
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        return type === 'submit' || type === 'button' || type === 'reset';
      }
      if (tag === 'a') {
        const cls = (el.getAttribute('class') || '').toLowerCase();
        return /(^|[\s_-])(btn|button)([\s_-]|$)/.test(cls);
      }
      return false;
    };

    const buttonKind = (el: Element, style: CSSStyleDeclaration): string => {
      const text = (el.textContent || '').trim();
      if (!text && !(el as HTMLInputElement).value) return 'button-icon';

      // Whole class tokens only: utilities like `ring-primary`,
      // `text-primary` or `hover:bg-primary` say nothing about the variant
      const tokens = (el.getAttribute('class') || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t && !t.includes(':'));
      const variant = (el.getAttribute('data-variant') || '').toLowerCase();
      const VARIANT = '^(?:(?:btn|button|is|variant)[-_])?';
      const matches = (words: string, extra?: RegExp) => {
        const re = new RegExp(`${VARIANT}(?:${words})$`);
        return (
          re.test(variant) ||
          tokens.some((t) => re.test(t) || (extra ? extra.test(t) : false))
        );
      };
      if (
        matches(
          'danger|destructive|critical',
          /^bg-(?:red|danger|destructive)(?:-\d+)?$/
        )
      )
        return 'button-danger';
      if (
        matches(
          'primary|cta',
          /^(?:bg-(?:primary|brand)(?:-\d+)?|muibutton-contained.*)$/
        )
      )
        return 'button-primary';
      if (
        matches(
          'secondary|outline|outlined|ghost|tertiary|subtle|plain|link',
          /^muibutton-(?:outlined|text).*$/
        )
      )
        return 'button-secondary';

      const m = style.backgroundColor.match(/[\d.]+/g);
      if (m && m.length >= 3) {
        const [r, g, b] = m.slice(0, 3).map(Number);
        const a = m[3] === undefined ? 1 : Number(m[3]);
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        if (a >= 0.9 && sat >= 40) {
          if (r > 170 && g < 110 && b < 110) return 'button-danger';
          return 'button-primary';
        }
      }
      return 'button-secondary';
    };

    const inNav = (el: Element) =>
      !!el.closest(
        'nav, [role="navigation"], [role="menubar"], [role="tablist"]'
      );

    const isCard = (
      el: Element,
      tag: string,
      style: CSSStyleDeclaration,
      rect: DOMRect
    ) => {
      if (!['div', 'section', 'article', 'aside', 'li'].includes(tag))
        return false;
      if (rect.width < 120 || rect.height < 60) return false;
      const bordered =
        px(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
      const shadowed = !!cleanShadow(style.boxShadow);
      if (!bordered && !shadowed) return false;
      if (px(style.paddingTop) < 8 && px(style.paddingLeft) < 8) return false;
      return (
        px(style.borderTopLeftRadius) > 0 || !!normColor(style.backgroundColor)
      );
    };

    const groupOf = (
      el: Element,
      tag: string,
      style: CSSStyleDeclaration,
      rect: DOMRect
    ): string | null => {
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') return tag;
      const role = el.getAttribute('role');
      if (role === 'heading') {
        const lvl = el.getAttribute('aria-level');
        if (lvl === '1' || lvl === '2' || lvl === '3') return 'h' + lvl;
      }
      // custom dropdowns are selects, whatever element they are built from
      if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox')
        return 'select';
      const buttonLike = isButtonLike(el, tag);
      if (
        (tag === 'a' || buttonLike || role === 'menuitem' || role === 'tab') &&
        inNav(el)
      )
        return 'nav-item';
      if (buttonLike) return buttonKind(el, style);
      if (tag === 'a') return 'link';
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        return [
          'text',
          'email',
          'password',
          'search',
          'tel',
          'url',
          'number',
          'date',
          'datetime-local',
          'month',
          'time',
          'week',
        ].includes(type)
          ? 'input'
          : null;
      }
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select') return 'select';
      if (tag === 'label') {
        // checkbox/radio labels are a different component from field labels
        const control = (el as HTMLLabelElement)
          .control as HTMLInputElement | null;
        return control &&
          (control.type === 'checkbox' || control.type === 'radio')
          ? null
          : 'label';
      }
      if (tag === 'p') return 'body-text';
      if (isCard(el, tag, style, rect)) return 'card';
      return null;
    };

    const CONTROL_GROUPS = new Set([
      'button-primary',
      'button-secondary',
      'button-danger',
      'button-icon',
      'input',
      'select',
    ]);

    // ── Walk ──
    const all = Array.from(
      document.body ? document.body.querySelectorAll('*') : []
    );
    const elements = all.slice(0, o.maxElements);
    let counted = 0;

    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag) || el.closest('svg')) continue;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      counted++;
      el.setAttribute(o.refAttr, String(counted));

      // Typography — only where the element renders its own text, otherwise
      // every wrapper div would count the inherited body size
      if (hasOwnText(el)) {
        const family = style.fontFamily
          .split(',')[0]
          .replace(/['"]/g, '')
          .trim();
        if (family) record('font-family', family, el);
        record('font-size', px(style.fontSize) + 'px', el);
        record('font-weight', style.fontWeight, el);
        record(
          'line-height',
          style.lineHeight === 'normal'
            ? 'normal'
            : px(style.lineHeight) + 'px',
          el
        );
        record(
          'letter-spacing',
          style.letterSpacing === 'normal'
            ? 'normal'
            : px(style.letterSpacing) + 'px',
          el
        );
        const color = normColor(style.color);
        if (color) record('color', color, el);
      }

      const bg = normColor(style.backgroundColor);
      if (bg) record('background-color', bg, el);

      // Borders — only sides that actually render
      const borderColors = new Set<string>();
      const borderWidths = new Set<string>();
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const w = px(
          style.getPropertyValue(`border-${side.toLowerCase()}-width`)
        );
        const s = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
        if (w <= 0 || s === 'none' || s === 'hidden') continue;
        borderWidths.add(w + 'px');
        const c = normColor(
          style.getPropertyValue(`border-${side.toLowerCase()}-color`)
        );
        if (c) borderColors.add(c);
      }
      borderColors.forEach((c) => record('border-color', c, el));
      borderWidths.forEach((w) => record('border-width', w, el));

      const radius = normRadius(style.borderRadius || '0px');
      if (radius === 'full' || px(radius) > 0)
        record('border-radius', radius, el);
      const shadow = cleanShadow(style.boxShadow);
      if (shadow) record('box-shadow', shadow, el);

      // Spacing
      const mt = px(style.marginTop);
      const mb = px(style.marginBottom);
      const ml = px(style.marginLeft);
      const mr = px(style.marginRight);
      const vertical: number[] = [];
      const horizontal: number[] = [];
      for (const [side, v] of [
        ['margin-top', mt],
        ['margin-bottom', mb],
      ] as const) {
        if (v > 0 && !isLayoutMargin(v)) {
          record('margin', v + 'px', el, side);
          vertical.push(v);
        }
      }
      // symmetric large side margins are almost always `margin: 0 auto`
      if (!(ml === mr && ml > 32)) {
        for (const [side, v] of [
          ['margin-left', ml],
          ['margin-right', mr],
        ] as const) {
          if (v > 0 && !isLayoutMargin(v)) {
            record('margin', v + 'px', el, side);
            horizontal.push(v);
          }
        }
      }
      const pt = px(style.paddingTop);
      const pb = px(style.paddingBottom);
      const pl = px(style.paddingLeft);
      const pr = px(style.paddingRight);
      for (const [side, v] of [
        ['padding-top', pt],
        ['padding-bottom', pb],
      ] as const) {
        if (v > 0) {
          record('padding', v + 'px', el, side);
          vertical.push(v);
        }
      }
      for (const [side, v] of [
        ['padding-left', pl],
        ['padding-right', pr],
      ] as const) {
        if (v > 0) {
          record('padding', v + 'px', el, side);
          horizontal.push(v);
        }
      }
      if (/flex|grid/.test(style.display)) {
        const rg = px(style.rowGap);
        const cg = px(style.columnGap);
        if (rg > 0) {
          record('gap', rg + 'px', el, cg === rg ? 'gap' : 'row-gap');
          vertical.push(rg);
        }
        if (cg > 0 && cg !== rg) record('gap', cg + 'px', el, 'column-gap');
        if (cg > 0) horizontal.push(cg);
      }
      vertical.forEach((v) => record('spacing-vertical', v + 'px', el));
      horizontal.forEach((v) => record('spacing-horizontal', v + 'px', el));

      // Semantic component sample
      const group = groupOf(el, tag, style, rect);
      if (group) {
        const list = (groups[group] ||= []);
        if (list.length < o.maxPerGroup) {
          list.push({
            group,
            selector: selectorFor(el),
            ref: el.getAttribute(o.refAttr) || undefined,
            text: (
              ((el as HTMLElement).innerText || el.textContent || '').trim() ||
              (el as HTMLInputElement).value ||
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              ''
            )
              .replace(/\s+/g, ' ')
              .slice(0, 40),
            tag,
            fontFamily: style.fontFamily
              .split(',')[0]
              .replace(/['"]/g, '')
              .trim(),
            fontSize: px(style.fontSize) + 'px',
            fontWeight: style.fontWeight,
            lineHeight:
              style.lineHeight === 'normal'
                ? 'normal'
                : px(style.lineHeight) + 'px',
            letterSpacing:
              style.letterSpacing === 'normal'
                ? 'normal'
                : px(style.letterSpacing) + 'px',
            color: normColor(style.color) || 'transparent',
            backgroundColor: bg || 'transparent',
            borderRadius: normRadius(style.borderRadius || '0px'),
            borderWidth: Array.from(borderWidths).join(' ') || '0px',
            boxShadow: cleanShadow(style.boxShadow) || 'none',
            padding: `${pt}px ${pr}px ${pb}px ${pl}px`,
            height: CONTROL_GROUPS.has(group)
              ? Math.round(rect.height)
              : undefined,
          });
        }
      }
    }

    return {
      elementCount: counted,
      truncated: all.length > o.maxElements,
      distributions,
      groups,
    };
  }, evalOpts);

  return {
    url: page.url(),
    elementCount: raw.elementCount,
    truncated: raw.truncated,
    distributions: raw.distributions,
    groups: raw.groups as PageDesignSnapshot['groups'],
  };
}
