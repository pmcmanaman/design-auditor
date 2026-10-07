import { Page } from 'playwright';
import { extractTypography } from '@extractors/typography.js';
import { extractRhythm } from '@extractors/rhythm.js';
import { extractColors } from '@extractors/colors.js';
import { extractComponents } from '@extractors/components.js';
import { extractReadingWidth } from '@extractors/reading-width.js';
import { extractImages } from '@extractors/images.js';
import { extractLinks } from '@extractors/links.js';
import { extractBreakpoints } from '@extractors/breakpoints.js';
import { extractHeadings } from '@extractors/headings.js';
import { checkTypography } from '@rules/typography.rules.js';
import { checkRhythm } from '@rules/rhythm.rules.js';
import { checkColors } from '@rules/colors.rules.js';
import { checkComponents } from '@rules/components.rules.js';
import { checkReadingWidth } from '@rules/reading-width.rules.js';
import { checkImages } from '@rules/images.rules.js';
import { checkLinks } from '@rules/links.rules.js';
import { checkBreakpoints } from '@rules/breakpoints.rules.js';
import { checkHeadings } from '@rules/headings.rules.js';
import { Violation } from '@/types.js';

export interface AuditModule {
  key: string;
  name: string;
  run: (page: Page) => Promise<Violation[]>;
}

export const MODULES: AuditModule[] = [
  {
    key: 'typography',
    name: 'Typography',
    run: async (p) => checkTypography(await extractTypography(p)),
  },
  {
    key: 'spacing',
    name: 'Vertical Rhythm & Spacing',
    run: async (p) => checkRhythm(await extractRhythm(p)),
  },
  {
    key: 'colors',
    name: 'Colors',
    run: async (p) => checkColors(await extractColors(p)),
  },
  {
    key: 'components',
    name: 'Components',
    run: async (p) => checkComponents(await extractComponents(p)),
  },
  {
    key: 'reading-width',
    name: 'Reading Width',
    run: async (p) => checkReadingWidth(await extractReadingWidth(p)),
  },
  {
    key: 'images',
    name: 'Images',
    run: async (p) => checkImages(await extractImages(p)),
  },
  {
    key: 'links',
    name: 'Links',
    run: async (p) => checkLinks(await extractLinks(p)),
  },
  {
    key: 'breakpoints',
    name: 'Breakpoints',
    run: async (p) => checkBreakpoints(await extractBreakpoints(p)),
  },
  {
    key: 'headings',
    name: 'Headings',
    run: async (p) => checkHeadings(await extractHeadings(p)),
  },
];

export function resolveModules(only?: string): AuditModule[] {
  if (!only) return MODULES;

  const keys = only.split(',').map((k) => k.trim().toLowerCase());
  const unknown = keys.filter((k) => !MODULES.some((m) => m.key === k));
  if (unknown.length > 0) {
    console.error(
      `Unknown module(s): ${unknown.join(', ')}\n` +
        `Valid modules: ${MODULES.map((m) => m.key).join(', ')}`
    );
    process.exit(1);
  }

  return MODULES.filter((m) => keys.includes(m.key));
}
