import { readFileSync } from 'node:fs';

export const PAGE = 'dist/ap242-gauge.html';
export const PAGE_BUDGET_BYTES = 4_230_000;

export const gzipBytes = (file: string): number => Bun.gzipSync(readFileSync(file), { level: 9 }).length;

export const overBudget = (bytes: number): boolean => bytes > PAGE_BUDGET_BYTES;
