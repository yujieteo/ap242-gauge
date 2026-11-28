import { readFileSync } from 'node:fs';
import { EXCLUDED_PATHS, HOT_FILE, hotAllocations, isExcluded } from './rules.ts';
import type { Violation } from './rules.ts';

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

function sourceRules(): void {
  console.log('\n== hot paths (excluded: ' + EXCLUDED_PATHS.join(', ') + ')');
  const report = (file: string, kind: string, v: readonly Violation[]): void => {
    for (const x of v) {
      console.error(file + ':' + x.line + ' ' + kind + ': ' + x.text);
      failures.push(kind);
    }
  };
  for (const file of trackedFiles()) {
    if (!HOT_FILE.test(file)) continue;
    const source = readFileSync(root + file, 'utf8');
    report(file, 'hot-path allocation', hotAllocations(source));
  }
}

run('type check', ['node_modules/.bin/tsc', '--noEmit']);
sourceRules();
run('dead code', ['node_modules/.bin/knip']);
run('tests', ['bun', 'test']);
run('build', ['bun', 'run', 'build.ts']);
run('output replay', ['bun', 'run', 'scripts/replay.ts']);

if (failures.length) {
  console.error('\ncheck failed: ' + [...new Set(failures)].join(', '));
  process.exit(1);
}
console.log('\ncheck passed');
