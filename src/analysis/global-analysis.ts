import { AggregatedDesign, AggregatedValue } from '@/analysis/aggregate.js';
import { Outlier, detectOutliers, Thresholds } from '@/analysis/outliers.js';

export interface ValueCount {
  value: string;
  count: number;
  pages: number;
}

export interface GlobalAnalysis {
  pageCount: number;
  typography: Record<string, ValueCount[]>;
  spacing: Record<string, ValueCount[]>;
  colors: Record<string, ValueCount[]>;
  components: {
    distributions: Record<string, ValueCount[]>;
    groups: Record<string, { samples: number; typography: ValueCount[] }>;
  };
  outliers: Outlier[];
}

const TOP_N = 20;

function top(values: AggregatedValue[] | undefined): ValueCount[] {
  return (values ?? [])
    .slice(0, TOP_N)
    .map((v) => ({ value: v.value, count: v.count, pages: v.pages.length }));
}

function pick(design: AggregatedDesign, props: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(props).map(([key, prop]) => [
      key,
      top(design.distributions[prop]),
    ])
  );
}

// JSON-friendly summary: top-N tables per property plus every outlier
export function buildGlobalAnalysis(
  design: AggregatedDesign,
  thresholds?: Partial<Thresholds>
): GlobalAnalysis {
  const groups: GlobalAnalysis['components']['groups'] = {};
  for (const [group, samples] of Object.entries(design.groups)) {
    const counts = new Map<string, { count: number; pages: Set<string> }>();
    for (const s of samples ?? []) {
      const key = `${s.fontSize} / ${s.fontWeight}`;
      const e = counts.get(key) ?? { count: 0, pages: new Set<string>() };
      e.count++;
      e.pages.add(s.url);
      counts.set(key, e);
    }
    groups[group] = {
      samples: samples?.length ?? 0,
      typography: Array.from(counts, ([value, e]) => ({
        value,
        count: e.count,
        pages: e.pages.size,
      }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_N),
    };
  }

  return {
    pageCount: design.pageCount,
    typography: pick(design, {
      fontFamilies: 'font-family',
      fontSizes: 'font-size',
      fontWeights: 'font-weight',
      lineHeights: 'line-height',
      letterSpacings: 'letter-spacing',
    }),
    spacing: pick(design, {
      margins: 'margin',
      paddings: 'padding',
      gaps: 'gap',
      vertical: 'spacing-vertical',
      horizontal: 'spacing-horizontal',
    }),
    colors: pick(design, {
      text: 'color',
      background: 'background-color',
      border: 'border-color',
    }),
    components: {
      distributions: pick(design, {
        borderRadius: 'border-radius',
        borderWidth: 'border-width',
        boxShadow: 'box-shadow',
      }),
      groups,
    },
    outliers: detectOutliers(design, thresholds),
  };
}
