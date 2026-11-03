import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_STEP_BYTES = 10_000;
export const DEFAULT_BUDGET_BYTES = 4_230_000;
export const PAGE_BUDGETS_BYTES: Readonly<Record<string, number>> = { 'ap242-gauge.html': 4_230_000 };

export type PageSize = { readonly page: string; readonly gzipBytes: number; readonly budget: number };

export const roundUpToStep = (bytes: number): number => Math.ceil(bytes / BUDGET_STEP_BYTES) * BUDGET_STEP_BYTES;

export function measurePages(distDir: string, budgets: Readonly<Record<string, number>>, defaultBudget: number): PageSize[] {
  return readdirSync(distDir).filter((f) => f.endsWith('.html')).sort().map((page) => {
    const gzipBytes = Bun.gzipSync(readFileSync(join(distDir, page)), { level: 9 }).length;
    return { page, gzipBytes, budget: budgets[page] ?? defaultBudget };
  });
}

export function overBudget(sizes: readonly PageSize[]): PageSize[] {
  return sizes.filter((s) => s.gzipBytes > s.budget);
}
