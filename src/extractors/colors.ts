import { Page } from 'playwright';
import {
  parseRGB,
  normalizeColor,
  rgbToLab,
  rgbToHex,
  getContrast,
  isNeutral,
  isTransparent,
  isNearWhite,
  isNearBlack,
  clusterColors,
  ColorEntry,
  ColorCluster,
} from '@utils/color.js';

// Text+background pairs for contrast checking
export interface ContrastPair {
  textColor: string;
  bgColor: string;
  textHex: string;
  bgHex: string;
  contrast: number;
  tag: string;
  fontSize: number;
  isBold: boolean;
  passesAA: boolean;
  passesAAA: boolean;
}

export interface ColorsData {
  all: ColorEntry[]; // all unique colors
  clusters: ColorCluster[]; // clusters of similar colors
  brandColors: ColorCluster[]; // excluding neutrals
  primaryCandidate?: ColorEntry; // most likely primary color
  secondaryCandidate?: ColorEntry; // secondary
  accentCandidate?: ColorEntry; // accent
  contrastPairs: ContrastPair[]; // pairs for WCAG checking
  cssVarCoverage: number; // % of colors using var()
}

const SKIP_TAGS = ['script', 'style', 'meta', 'head', 'link', 'br', 'hr'];

export async function extractColors(page: Page): Promise<ColorsData> {
  const raw = await page.evaluate((skipTags) => {
    type RawColor = {
      css: string;
      property: string;
      tag: string;
      fontSize: number;
      isBold: boolean;
      bgCss?: string; // for contrast pairs
    };

    const collected: RawColor[] = [];
    const elements = Array.from(document.querySelectorAll('*'));

    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (skipTags.includes(tag)) return;

      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      const isBold = parseInt(style.fontWeight) >= 700;

      // color properties we're interested in
      const colorProps: Array<[string, string]> = [
        ['color', style.color],
        ['background-color', style.backgroundColor],
        ['border-color', style.borderColor],
      ];

      colorProps.forEach(([prop, value]) => {
        if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)')
          return;

        collected.push({ css: value, property: prop, tag, fontSize, isBold });

        // for text color, store background for contrast pair
        if (prop === 'color') {
          collected[collected.length - 1].bgCss = style.backgroundColor;
        }
      });
    });

    // CSS variable coverage — computed styles never contain var(),
    // so scan raw declarations across all reachable stylesheets
    let totalColorDecls = 0;
    let cssVarDecls = 0;
    const colorPropNames = [
      'color',
      'background-color',
      'border-color',
      'background',
    ];

    const walkRules = (ruleList: CSSRuleList) => {
      for (const rule of Array.from(ruleList)) {
        if (rule instanceof CSSStyleRule) {
          for (const prop of colorPropNames) {
            const val = rule.style.getPropertyValue(prop);
            if (!val) continue;
            totalColorDecls++;
            if (val.includes('var(')) cssVarDecls++;
          }
        } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
          walkRules((rule as CSSGroupingRule).cssRules);
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walkRules(sheet.cssRules);
      } catch {
        // cross-origin stylesheet — skip
      }
    }

    const cssVarCoverage =
      totalColorDecls > 0
        ? Math.round((cssVarDecls / totalColorDecls) * 100)
        : 0;

    return { collected, cssVarCoverage };
  }, SKIP_TAGS);

  // ─── Aggregate into ColorEntry map ──────────────────────────────────────────
  const colorMap = new Map<string, ColorEntry>();

  for (const item of raw.collected) {
    const rgb = parseRGB(item.css);
    if (!rgb) continue;
    if (isTransparent(rgb)) continue;

    const key = normalizeColor(item.css);

    if (!colorMap.has(key)) {
      colorMap.set(key, {
        raw: key,
        rgb,
        lab: rgbToLab(rgb),
        count: 0,
        properties: [],
        tags: [],
      });
    }

    const entry = colorMap.get(key)!;
    entry.count++;
    if (!entry.properties.includes(item.property))
      entry.properties.push(item.property);
    if (!entry.tags.includes(item.tag)) entry.tags.push(item.tag);
  }

  const all = Array.from(colorMap.values()).sort((a, b) => b.count - a.count);

  // ─── Clustering ───────────────────────────────────────────────────────────────
  const clusters = clusterColors(all, 8);

  // Brand colors — excluding neutrals, whites, blacks
  const brandColors = clusterColors(
    all.filter(
      (c) => !isNeutral(c.rgb) && !isNearWhite(c.rgb) && !isNearBlack(c.rgb)
    ),
    8
  );

  // Detect primary/secondary/accent by usage frequency
  const [primary, secondary, accent] = brandColors.map((c) => c.representative);

  // ─── Contrast pairs (WCAG) ────────────────────────────────────────────────────
  const contrastPairs: ContrastPair[] = [];
  const seenPairs = new Set<string>();

  for (const item of raw.collected) {
    if (!item.bgCss) continue;

    const textRgb = parseRGB(item.css);
    const bgRgb = parseRGB(item.bgCss);
    if (!textRgb || !bgRgb) continue;
    if (isTransparent(bgRgb)) continue;

    // skip pairs where text and background are the same color (false positive)
    const textKey = normalizeColor(item.css);
    const bgKey = normalizeColor(item.bgCss);
    if (textKey === bgKey) continue;

    // skip if both are near-white — element is not visible
    if (isNearWhite(textRgb) && isNearWhite(bgRgb)) continue;

    // skip if both are near-black
    if (isNearBlack(textRgb) && isNearBlack(bgRgb)) continue;

    const pairKey = `${textKey}|${bgKey}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const contrast = getContrast(textRgb, bgRgb);
    const isLargeText =
      item.fontSize >= 18 || (item.isBold && item.fontSize >= 14);

    contrastPairs.push({
      textColor: normalizeColor(item.css),
      bgColor: normalizeColor(item.bgCss),
      textHex: rgbToHex(textRgb),
      bgHex: rgbToHex(bgRgb),
      contrast: Math.round(contrast * 100) / 100,
      tag: item.tag,
      fontSize: item.fontSize,
      isBold: item.isBold,
      passesAA: isLargeText ? contrast >= 3 : contrast >= 4.5,
      passesAAA: isLargeText ? contrast >= 4.5 : contrast >= 7,
    });
  }

  // sort: worst contrasts first
  contrastPairs.sort((a, b) => a.contrast - b.contrast);

  return {
    all,
    clusters,
    brandColors,
    primaryCandidate: primary,
    secondaryCandidate: secondary,
    accentCandidate: accent,
    contrastPairs,
    cssVarCoverage: raw.cssVarCoverage,
  };
}
