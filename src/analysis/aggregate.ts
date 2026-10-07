import {
  ComponentGroup,
  ComponentSample,
  PageDesignSnapshot,
} from '@extractors/design-samples.js';

export interface Example {
  url: string;
  selector: string;
  text?: string;
  // data-da-i stamp and exact CSS property, used to apply fixes to snapshots
  ref?: string;
  property?: string;
}

export interface AggregatedValue {
  value: string;
  count: number;
  pages: string[];
  examples: Example[];
}

export interface PageSample extends ComponentSample {
  url: string;
}

export interface AggregatedDesign {
  pageCount: number;
  // property → values sorted by count (desc)
  distributions: Record<string, AggregatedValue[]>;
  groups: Partial<Record<ComponentGroup, PageSample[]>>;
}

const MAX_EXAMPLES = 5;

// Incremental merge so the crawler can drop each page's snapshot after adding it
export class DesignAggregator {
  private pageCount = 0;
  private values = new Map<
    string,
    Map<string, { count: number; pages: Set<string>; examples: Example[] }>
  >();
  private groups: Partial<Record<ComponentGroup, PageSample[]>> = {};

  add(snapshot: PageDesignSnapshot): void {
    this.pageCount++;
    for (const [prop, byValue] of Object.entries(snapshot.distributions)) {
      let target = this.values.get(prop);
      if (!target) this.values.set(prop, (target = new Map()));
      for (const [value, stat] of Object.entries(byValue)) {
        let entry = target.get(value);
        if (!entry) {
          target.set(
            value,
            (entry = { count: 0, pages: new Set(), examples: [] })
          );
        }
        entry.count += stat.count;
        entry.pages.add(snapshot.url);
        for (const ex of stat.examples) {
          if (entry.examples.length >= MAX_EXAMPLES) break;
          entry.examples.push({ url: snapshot.url, ...ex });
        }
      }
    }
    for (const [group, samples] of Object.entries(snapshot.groups)) {
      const list = (this.groups[group as ComponentGroup] ||= []);
      for (const s of samples ?? []) list.push({ ...s, url: snapshot.url });
    }
  }

  result(): AggregatedDesign {
    const distributions: Record<string, AggregatedValue[]> = {};
    for (const [prop, byValue] of this.values) {
      distributions[prop] = Array.from(byValue, ([value, e]) => ({
        value,
        count: e.count,
        pages: Array.from(e.pages),
        examples: e.examples,
      })).sort((a, b) => b.count - a.count);
    }
    return { pageCount: this.pageCount, distributions, groups: this.groups };
  }
}

export function aggregate(snapshots: PageDesignSnapshot[]): AggregatedDesign {
  const agg = new DesignAggregator();
  snapshots.forEach((s) => agg.add(s));
  return agg.result();
}
