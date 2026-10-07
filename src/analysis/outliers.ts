import { deltaE, rgbToLab, RGB } from '@utils/color.js';
import { ComponentGroup } from '@extractors/design-samples.js';
import {
  AggregatedDesign,
  AggregatedValue,
  Example,
  PageSample,
} from '@/analysis/aggregate.js';

export type Confidence = 'high' | 'medium' | 'info';
export type OutlierCategory =
  | 'typography'
  | 'spacing'
  | 'colors'
  | 'components';

export interface Outlier {
  id: string;
  category: OutlierCategory;
  confidence: Confidence;
  property: string;
  value: string;
  count: number;
  pages: string[];
  examples: Example[];
  dominant?: { value: string; count: number };
  group?: ComponentGroup;
  groupSize?: number;
  reason: string;
  suggestion: string;
}

// All tuning in one place. Defaults favor few false positives over recall.
export const DEFAULT_THRESHOLDS = {
  // global scale analysis (font-size, spacing, radius)
  minSamples: 50, // ignore distributions smaller than this
  rareShare: 0.01, // a candidate outlier is used by < 1% of elements
  dominantShare: 0.05, // a "token" is used by ≥ 5% of elements…
  dominantMinCount: 5, // …and at least this many times
  nearHighPx: 1, // |Δ| ≤ max(nearHighPx, nearHighRatio·token) → high-confidence near-miss
  nearHighRatio: 0.07,
  nearMediumPx: 2,
  nearMediumRatio: 0.12,
  highRatio: 20, // token must be ≥ 20× more common for high confidence
  mediumRatio: 10,
  highMaxPages: 2, // high confidence only when confined to ≤ 2 pages
  gridShare: 0.8, // ≥ 80% of spacing on a 4px grid → off-grid values are suspect
  minSpacingPx: 4, // 1–3px nudges are usually intentional hairline tweaks

  // colors
  colorMinSamples: 30,
  colorRareShare: 0.01,
  colorRatio: 10, // reference used ≥ 10× more → full confidence
  colorMinRatio: 3, // reference must be at least this much more common
  colorDominantMinCount: 10,
  deltaEHigh: 2.3, // ~ just-noticeable difference: almost certainly accidental
  deltaEMedium: 5,

  // component groups
  groupMinSize: 5,
  groupHighMinSize: 10,
  groupHighShare: 0.9,
  groupMediumShare: 0.75,
  groupMaxDeviantShare: 0.05, // a variant used more than this is intentional
  groupMaxDeviantCount: 2,
};

export type Thresholds = typeof DEFAULT_THRESHOLDS;

const SCALE_PROPS: Record<string, OutlierCategory> = {
  'font-size': 'typography',
  margin: 'spacing',
  padding: 'spacing',
  gap: 'spacing',
  'border-radius': 'components',
};
const SPACING_PROPS = new Set(['margin', 'padding', 'gap']);
const COLOR_PROPS = ['color', 'background-color', 'border-color'];

const GROUP_PROPS: Record<
  ComponentGroup,
  Array<keyof typeof GROUP_PROP_READERS>
> = {
  h1: ['typography'],
  h2: ['typography'],
  h3: ['typography'],
  'body-text': ['typography'],
  label: ['typography'],
  link: ['typography'],
  'nav-item': ['typography', 'padding'],
  'button-primary': [
    'typography',
    'border-radius',
    'padding',
    'height',
    'border-width',
  ],
  'button-secondary': [
    'typography',
    'border-radius',
    'padding',
    'height',
    'border-width',
  ],
  'button-danger': ['typography', 'border-radius', 'padding', 'height'],
  'button-icon': ['border-radius', 'height'],
  input: ['typography', 'border-radius', 'height', 'border-width', 'padding'],
  textarea: ['typography', 'border-radius', 'border-width', 'padding'],
  select: ['typography', 'border-radius', 'height', 'border-width'],
  card: ['border-radius', 'box-shadow', 'padding', 'border-width'],
};

const GROUP_PROP_READERS = {
  typography: (s: PageSample) => `${s.fontSize} / ${s.fontWeight}`,
  'border-radius': (s: PageSample) => s.borderRadius,
  padding: (s: PageSample) => s.padding,
  height: (s: PageSample) =>
    s.height !== undefined ? `${s.height}px` : undefined,
  'border-width': (s: PageSample) => s.borderWidth,
  'box-shadow': (s: PageSample) => s.boxShadow,
};

const GROUP_LABEL: Record<ComponentGroup, string> = {
  h1: 'H1 headings',
  h2: 'H2 headings',
  h3: 'H3 headings',
  'body-text': 'Body text',
  label: 'Labels',
  link: 'Links',
  'nav-item': 'Navigation items',
  'button-primary': 'Primary buttons',
  'button-secondary': 'Secondary buttons',
  'button-danger': 'Danger buttons',
  'button-icon': 'Icon buttons',
  input: 'Inputs',
  textarea: 'Textareas',
  select: 'Selects',
  card: 'Cards / panels',
};

export function groupLabel(group: ComponentGroup): string {
  return GROUP_LABEL[group];
}

export function detectOutliers(
  design: AggregatedDesign,
  thresholds: Partial<Thresholds> = {}
): Outlier[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const groupOutliers = detectGroupOutliers(design, t);
  const scaleOutliers = Object.entries(SCALE_PROPS).flatMap(
    ([prop, category]) =>
      detectScaleOutliers(prop, category, design.distributions[prop] ?? [], t)
  );

  // A group finding ("1 of 67 primary buttons uses 6px") explains the same
  // element better than the global one ("6px is rare"), so report it once
  const explained = new Set(
    groupOutliers.flatMap((o) =>
      o.examples.map((e) => `${e.url}|${e.selector}`)
    )
  );
  const unexplained = scaleOutliers.filter(
    (o) =>
      o.count > o.examples.length ||
      !o.examples.every((e) => explained.has(`${e.url}|${e.selector}`))
  );

  const outliers: Outlier[] = [
    ...unexplained,
    ...detectFontFamilyOutliers(design.distributions['font-family'] ?? [], t),
    ...detectColorOutliers(design, t),
    ...groupOutliers,
  ];

  const rank: Record<Confidence, number> = { high: 0, medium: 1, info: 2 };
  return outliers.sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] ||
      (b.dominant?.count ?? 0) / b.count - (a.dominant?.count ?? 0) / a.count
  );
}

// ─── Scale outliers ─────────────────────────────────────────────────────────

function formatPx(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function pxValue(v: string): number | null {
  const m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? parseFloat(m[1]) : null;
}

export function detectScaleOutliers(
  property: string,
  category: OutlierCategory,
  values: AggregatedValue[],
  t: Thresholds = DEFAULT_THRESHOLDS
): Outlier[] {
  const isSpacing = SPACING_PROPS.has(property);
  const numeric = values
    .map((v) => ({ ...v, px: pxValue(v.value) }))
    .filter(
      (v): v is AggregatedValue & { px: number } =>
        v.px !== null && v.px > 0 && (!isSpacing || v.px >= t.minSpacingPx)
    );

  const total = numeric.reduce((s, v) => s + v.count, 0);
  if (total < t.minSamples) return [];

  const tokens = numeric.filter(
    (v) => v.count / total >= t.dominantShare && v.count >= t.dominantMinCount
  );
  if (tokens.length === 0) return [];

  const onGrid = numeric
    .filter((v) => v.px % 4 === 0)
    .reduce((s, v) => s + v.count, 0);
  const grid = isSpacing && onGrid / total >= t.gridShare ? 4 : null;
  const scale = tokens
    .map((v) => v.px)
    .sort((a, b) => a - b)
    .join(' / ');

  const out: Outlier[] = [];
  for (const v of numeric) {
    if (v.count / total >= t.rareShare) continue;
    if (tokens.includes(v)) continue;

    const nearest = tokens.reduce((best, tok) =>
      Math.abs(tok.px - v.px) < Math.abs(best.px - v.px) ? tok : best
    );
    const diff = Math.abs(nearest.px - v.px);
    const nearHigh =
      diff <= Math.max(t.nearHighPx, t.nearHighRatio * nearest.px);
    const nearMedium =
      diff <= Math.max(t.nearMediumPx, t.nearMediumRatio * nearest.px);
    const ratio = nearest.count / v.count;
    const offGrid = grid !== null && v.px % grid !== 0;
    const fewPages = v.pages.length <= t.highMaxPages;

    let confidence: Confidence;
    let reason: string;
    if (nearHigh && ratio >= t.highRatio && fewPages) {
      confidence = 'high';
      reason = `${v.value} is ${formatPx(diff)}px off ${nearest.value}, which is used ${nearest.count}× (${v.count}× vs ${nearest.count}×)`;
    } else if ((nearMedium || offGrid) && ratio >= t.mediumRatio) {
      confidence = 'medium';
      reason = offGrid
        ? `${v.value} is off the ${grid}px grid used by ${Math.round((onGrid / total) * 100)}% of ${property} values; scale appears to be ${scale}px`
        : `${v.value} is close to the common ${nearest.value} (${nearest.count}×) but used only ${v.count}×`;
    } else {
      confidence = 'info';
      reason = `${v.value} is rare (${v.count} of ${total})`;
    }

    out.push({
      id: `${property}:${v.value}`,
      category,
      confidence,
      property,
      value: v.value,
      count: v.count,
      pages: v.pages,
      examples: v.examples,
      dominant: { value: nearest.value, count: nearest.count },
      reason,
      suggestion:
        category === 'typography'
          ? `Possible typography inconsistency — consider ${nearest.value}.`
          : category === 'spacing'
            ? `Possible spacing inconsistency — consider ${nearest.value} or a value on the scale (${scale}px).`
            : `Possible component inconsistency — consider ${nearest.value}.`,
    });
  }
  return out;
}

// A browser-default serif among sans-serif text usually means a font failed
// to load or an element escaped the font stack
const DEFAULT_SERIF = /^(times new roman|times|serif)$/i;

function detectFontFamilyOutliers(
  values: AggregatedValue[],
  t: Thresholds
): Outlier[] {
  const total = values.reduce((s, v) => s + v.count, 0);
  if (total < t.minSamples || values.length < 2) return [];
  const top = values[0];
  if (DEFAULT_SERIF.test(top.value)) return [];

  return values
    .filter((v) => DEFAULT_SERIF.test(v.value) && v.count / total < t.rareShare)
    .map((v) => ({
      id: `font-family:${v.value}`,
      category: 'typography' as const,
      confidence: 'high' as const,
      property: 'font-family',
      value: v.value,
      count: v.count,
      pages: v.pages,
      examples: v.examples,
      dominant: { value: top.value, count: top.count },
      reason: `${v.value} is the browser default font; the app uses ${top.value} (${top.count}×)`,
      suggestion:
        'Likely a missing font-family declaration or a font that failed to load.',
    }));
}

// ─── Colors ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): RGB | null {
  const m = hex.match(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i
  );
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
    a: m[4] ? parseInt(m[4], 16) / 255 : 1,
  };
}

export function detectColorOutliers(
  design: AggregatedDesign,
  t: Thresholds = DEFAULT_THRESHOLDS
): Outlier[] {
  // One palette across text/background/border: #3a82f6 text next to a
  // #3b82f6 background is still an accidental near-duplicate
  const palette = new Map<
    string,
    {
      count: number;
      pages: Set<string>;
      examples: Example[];
      props: Set<string>;
    }
  >();
  for (const prop of COLOR_PROPS) {
    for (const v of design.distributions[prop] ?? []) {
      let e = palette.get(v.value);
      if (!e) {
        palette.set(
          v.value,
          (e = { count: 0, pages: new Set(), examples: [], props: new Set() })
        );
      }
      e.count += v.count;
      v.pages.forEach((p) => e!.pages.add(p));
      e.props.add(prop);
      for (const ex of v.examples)
        if (e.examples.length < 5) e.examples.push(ex);
    }
  }

  const entries = Array.from(palette, ([value, e]) => ({
    value,
    ...e,
    rgb: hexToRgb(value),
  })).filter((e) => e.rgb !== null);
  const total = entries.reduce((s, e) => s + e.count, 0);
  if (total < t.colorMinSamples) return [];

  const out: Outlier[] = [];
  for (const e of entries) {
    if (e.count / total >= t.colorRareShare) continue;
    const lab = rgbToLab(e.rgb!);

    let best: { entry: (typeof entries)[number]; dE: number } | null = null;
    for (const other of entries) {
      if (other === e) continue;
      if (other.count < t.colorDominantMinCount) continue;
      if (other.count < e.count * t.colorMinRatio) continue;
      // only compare like with like: opaque vs translucent are different tokens
      if (Math.abs(other.rgb!.a - e.rgb!.a) > 0.05) continue;
      const dE = deltaE(lab, rgbToLab(other.rgb!));
      if (dE > 0 && (!best || dE < best.dE)) best = { entry: other, dE };
    }
    if (!best) continue;

    // compare against the *nearest* more common color, then grade by how
    // close it is and how much more common it is
    const ratio = best.entry.count / e.count;
    let confidence: Confidence;
    if (best.dE <= t.deltaEHigh && ratio >= t.colorRatio) confidence = 'high';
    else if (
      best.dE <= t.deltaEHigh ||
      (best.dE <= t.deltaEMedium && ratio >= t.colorRatio)
    )
      confidence = 'medium';
    else continue;
    out.push({
      id: `color:${e.value}`,
      category: 'colors',
      confidence,
      property: Array.from(e.props).join(', '),
      value: e.value,
      count: e.count,
      pages: Array.from(e.pages),
      examples: e.examples,
      dominant: { value: best.entry.value, count: best.entry.count },
      reason: `${e.value} (${e.count}×) is ΔE ${best.dE.toFixed(1)} from ${best.entry.value} (${best.entry.count}×)`,
      suggestion:
        'Possible accidental near-duplicate color — use the existing token.',
    });
  }
  return out;
}

// ─── Component groups ───────────────────────────────────────────────────────

export function detectGroupOutliers(
  design: AggregatedDesign,
  t: Thresholds = DEFAULT_THRESHOLDS
): Outlier[] {
  const out: Outlier[] = [];

  for (const [groupKey, samples] of Object.entries(design.groups)) {
    const group = groupKey as ComponentGroup;
    if (!samples || samples.length < t.groupMinSize) continue;

    for (const prop of GROUP_PROPS[group] ?? []) {
      const read = GROUP_PROP_READERS[prop];
      const values = samples
        .map((s) => ({ s, v: read(s) }))
        .filter((x): x is { s: PageSample; v: string } => !!x.v);
      const n = values.length;
      if (n < t.groupMinSize) continue;

      const counts = new Map<string, PageSample[]>();
      for (const { s, v } of values) {
        const list = counts.get(v) ?? [];
        list.push(s);
        counts.set(v, list);
      }
      const [modeValue, modeSamples] = Array.from(counts).sort(
        (a, b) => b[1].length - a[1].length
      )[0];
      const share = modeSamples.length / n;
      if (share < t.groupMediumShare) continue;

      for (const [value, deviants] of counts) {
        if (value === modeValue) continue;
        // heights within 1px of the mode are sub-pixel rounding, not a design choice
        if (
          prop === 'height' &&
          Math.abs(parseFloat(value) - parseFloat(modeValue)) <= 1
        )
          continue;
        if (
          deviants.length >
          Math.max(t.groupMaxDeviantCount, t.groupMaxDeviantShare * n)
        )
          continue;

        const confidence: Confidence =
          share >= t.groupHighShare && n >= t.groupHighMinSize
            ? 'high'
            : 'medium';
        const pages = Array.from(new Set(deviants.map((d) => d.url)));
        const label = GROUP_LABEL[group];

        out.push({
          id: `group:${group}:${prop}:${value}`,
          category:
            prop === 'typography' &&
            !group.startsWith('button') &&
            group !== 'input' &&
            group !== 'select' &&
            group !== 'textarea'
              ? 'typography'
              : 'components',
          confidence,
          property: prop === 'typography' ? 'font-size / font-weight' : prop,
          value,
          count: deviants.length,
          pages,
          examples: deviants.slice(0, 5).map((d) => ({
            url: d.url,
            selector: d.selector,
            text: d.text,
            ref: d.ref,
          })),
          dominant: { value: modeValue, count: modeSamples.length },
          group,
          groupSize: n,
          reason: `${label}: ${modeSamples.length} use ${modeValue}, ${deviants.length} ${deviants.length === 1 ? 'uses' : 'use'} ${value}`,
          suggestion:
            prop === 'typography'
              ? `Possible typography inconsistency — comparable ${label.toLowerCase()} use ${modeValue}.`
              : `Possible component inconsistency — comparable ${label.toLowerCase()} use ${prop} ${modeValue}.`,
        });
      }
    }
  }
  return out;
}
