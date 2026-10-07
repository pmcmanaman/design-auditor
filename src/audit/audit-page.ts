import { Page } from 'playwright';
import { ModuleReport } from '@/types.js';
import { AuditModule } from '@/audit/modules.js';

// Runs the selected audit modules against an already-loaded page.
// Shared by single-page mode and the crawler so audit logic lives in one place.
export async function auditPage(
  page: Page,
  modules: AuditModule[],
  onModule?: (module: AuditModule) => void
): Promise<ModuleReport[]> {
  const reports: ModuleReport[] = [];
  for (const module of modules) {
    onModule?.(module);
    reports.push({ name: module.name, violations: await module.run(page) });
  }
  return reports;
}
