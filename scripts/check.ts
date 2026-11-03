import { readFileSync } from 'node:fs';
import { EXCLUDED_PATHS, HOT_FILE, hotAllocations, htmlComments, isExcluded, tsComments } from './rules.ts';
import type { Violation } from './rules.ts';
import { DEFAULT_BUDGET_BYTES, PAGE_BUDGETS_BYTES, measurePages, overBudget } from './budget.ts';

const root = new URL('..', import.meta.url).pathname;
const failures: string[] = [];

function run(name: string, cmd: string[]): void {
  console.log('\n== ' + name);
  const r = Bun.spawnSync(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) failures.push(name);
}

function trackedFiles(): string[] {
  const r = Bun.spawnSync(['git', '-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], { stdout: 'pipe' });
  return r.stdout.toString().split('\n').filter((f) => f && !isExcluded(f));
}

async function sourceRules(): Promise<void> {
  console.log('\n== comments and hot paths (excluded: ' + EXCLUDED_PATHS.join(', ') + ')');
  const report = (file: string, kind: string, v: readonly Violation[]): void => {
    for (const x of v) {
      console.error(file + ':' + x.line + ' ' + kind + ': ' + x.text);
      failures.push(kind);
    }
  };
  for (const file of trackedFiles()) {
    const source = readFileSync(root + file, 'utf8');
    if (file.endsWith('.ts')) report(file, 'comment', tsComments(source));
    if (file.endsWith('.html')) report(file, 'comment', await htmlComments(source));
    if (HOT_FILE.test(file)) report(file, 'hot-path allocation', hotAllocations(source));
  }
}

function distIsCurrent(): void {
  console.log('\n== build and committed dist');
  const dist = root + 'dist/ap242-gauge.html';
  const before = readFileSync(dist);
  const r = Bun.spawnSync(['bun', 'run', 'build.ts'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) { failures.push('build'); return; }
  if (!before.equals(readFileSync(dist))) {
    console.error('dist/ap242-gauge.html was stale; it is rebuilt now, so commit it');
    failures.push('dist is stale');
  }
}

function budgets(): void {
  console.log('\n== page budget (gzip bytes)');
  const sizes = measurePages(root + 'dist', PAGE_BUDGETS_BYTES, DEFAULT_BUDGET_BYTES);
  for (const s of sizes) console.log(s.page + ': ' + s.gzipBytes + ' of ' + s.budget);
  for (const s of overBudget(sizes)) { console.error(s.page + ' is over its budget'); failures.push('budget ' + s.page); }
}

run('type check', ['node_modules/.bin/tsc', '--noEmit']);
await sourceRules();
run('dead code', ['node_modules/.bin/knip']);
run('tests', ['bun', 'test']);
distIsCurrent();
budgets();
run('output replay', ['bun', 'run', 'scripts/replay.ts']);

if (failures.length) {
  console.error('\ncheck failed: ' + [...new Set(failures)].join(', '));
  process.exit(1);
}
console.log('\ncheck passed');
