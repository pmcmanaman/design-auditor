import { Page } from 'playwright';

export interface BreakpointEntry {
  value: number; // px
  query: string; // original string: "(max-width: 768px)"
  type: 'max-width' | 'min-width' | 'other';
  count: number; // how many rules use this breakpoint
}

export interface BreakpointsData {
  breakpoints: BreakpointEntry[];
  uniqueValues: number[];
  strategy: 'mobile-first' | 'desktop-first' | 'mixed' | 'none';
  knownSystem: string | null; // Tailwind / Bootstrap / custom
}

// Known design systems and their breakpoints
const KNOWN_SYSTEMS: Array<{
  name: string;
  values: number[];
  tolerance: number;
}> = [
  {
    name: 'Tailwind CSS',
    values: [640, 768, 1024, 1280, 1536],
    tolerance: 8,
  },
  {
    name: 'Bootstrap 5',
    values: [576, 768, 992, 1200, 1400],
    tolerance: 8,
  },
  {
    name: 'Material UI',
    values: [600, 900, 1200, 1536],
    tolerance: 8,
  },
];

function detectKnownSystem(values: number[]): string | null {
  for (const system of KNOWN_SYSTEMS) {
    const matches = system.values.filter((sv) =>
      values.some((v) => Math.abs(v - sv) <= system.tolerance)
    );
    // if more than half the values match — it's this system
    if (matches.length >= Math.floor(system.values.length * 0.5)) {
      return system.name;
    }
  }
  return null;
}

export interface WidthCondition {
  type: 'min-width' | 'max-width';
  value: number; // px (em/rem converted at 16px)
}

const NUM = '(\\d+(?:\\.\\d+)?)\\s*(px|em|rem)';

function toPx(value: string, unit: string): number {
  const n = parseFloat(value);
  return unit.toLowerCase() === 'px' ? n : Math.round(n * 16);
}

// Parses width features from a media condition. Supports the legacy
// "(min-width: 768px)" form and Media Queries 4 range syntax
// ("(width >= 48rem)", "(48rem <= width)", "(40rem <= width < 64rem)") that
// Tailwind v4 and modern CSS emit. A leading "not" inverts the direction
// (Tailwind's max-* variants compile to "not all and (width >= 48rem)").
export function parseWidthConditions(condition: string): WidthCondition[] {
  const out: WidthCondition[] = [];
  const legacy = new RegExp(
    `\\(\\s*(min|max)-width\\s*:\\s*${NUM}\\s*\\)`,
    'gi'
  );
  const range = new RegExp(
    `\\(\\s*(?:${NUM}\\s*(<=|<|>=|>)\\s*)?width(?:\\s*(<=|<|>=|>)\\s*${NUM})?\\s*\\)`,
    'gi'
  );

  for (const m of condition.matchAll(legacy)) {
    out.push({
      type: m[1].toLowerCase() === 'min' ? 'min-width' : 'max-width',
      value: toPx(m[2], m[3]),
    });
  }
  for (const m of condition.matchAll(range)) {
    const [, leftValue, leftUnit, leftOp, rightOp, rightValue, rightUnit] = m;
    // "V < width": width is above V → min-width
    if (leftValue && leftOp) {
      out.push({
        type: leftOp.startsWith('<') ? 'min-width' : 'max-width',
        value: toPx(leftValue, leftUnit),
      });
    }
    // "width < V": width is below V → max-width
    if (rightValue && rightOp) {
      out.push({
        type: rightOp.startsWith('<') ? 'max-width' : 'min-width',
        value: toPx(rightValue, rightUnit),
      });
    }
  }

  if (/^\s*not\b/i.test(condition)) {
    return out.map((c) => ({
      ...c,
      type: c.type === 'min-width' ? 'max-width' : 'min-width',
    }));
  }
  return out;
}

export async function extractBreakpoints(page: Page): Promise<BreakpointsData> {
  // collect raw media conditions in the browser; parse them in Node
  const conditions = await page.evaluate(() => {
    const found: string[] = [];

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet
      }

      const processRules = (ruleList: CSSRuleList) => {
        for (const rule of Array.from(ruleList)) {
          if (rule instanceof CSSMediaRule) {
            found.push(rule.conditionText || rule.media?.mediaText || '');
          }
          // recursively process nested rules (@media, @supports, @layer)
          if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
            processRules((rule as CSSGroupingRule).cssRules);
          }
        }
      };
      processRules(rules);
    }
    return found;
  });

  const bpMap = new Map<
    string,
    { query: string; type: string; count: number }
  >();
  for (const condition of conditions) {
    // capture every value, incl. combined queries like
    // "(min-width: 768px) and (max-width: 1024px)"
    for (const { type, value } of parseWidthConditions(condition)) {
      const key = `${value}|${type}`;
      if (!bpMap.has(key)) bpMap.set(key, { query: condition, type, count: 0 });
      bpMap.get(key)!.count++;
    }
  }
  const raw = Array.from(bpMap.entries()).map(([key, data]) => ({
    value: parseFloat(key.split('|')[0]),
    query: data.query,
    type: data.type,
    count: data.count,
  }));

  const breakpoints: BreakpointEntry[] = raw
    .map((bp) => ({
      value: bp.value,
      query: bp.query,
      type:
        bp.type === 'max-width'
          ? ('max-width' as const)
          : bp.type === 'min-width'
            ? ('min-width' as const)
            : ('other' as const),
      count: bp.count,
    }))
    .sort((a, b) => a.value - b.value);

  const uniqueValues = [...new Set(breakpoints.map((bp) => bp.value))];

  // strategy: mobile-first = predominantly min-width
  const minCount = breakpoints.filter((bp) => bp.type === 'min-width').length;
  const maxCount = breakpoints.filter((bp) => bp.type === 'max-width').length;
  const strategy =
    breakpoints.length === 0
      ? 'none'
      : minCount > 0 && maxCount > 0
        ? 'mixed'
        : minCount > maxCount
          ? 'mobile-first'
          : 'desktop-first';

  const knownSystem = detectKnownSystem(uniqueValues);

  return { breakpoints, uniqueValues, strategy, knownSystem };
}
