import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const SHOWN_DIFFS = 5;

function git(...args: string[]): string {
  const r = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr.toString());
  return r.stdout.toString().trim();
}

function defaultBase(): string {
  for (const ref of ['origin/main', 'main']) {
    const r = Bun.spawnSync(['git', '-C', root, 'rev-parse', '--verify', '--quiet', ref], { stdout: 'pipe' });
    if (r.exitCode === 0) return git('merge-base', 'HEAD', ref);
  }
  throw new Error('no origin/main or main to compare with');
}

function run(cmd: string[], env: Record<string, string> = {}): number {
  const r = Bun.spawnSync(cmd, { cwd: root, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' });
  return r.exitCode;
}

function mustRun(cmd: string[]): void {
  if (run(cmd) !== 0) throw new Error(cmd.join(' ') + ' failed');
}

export type ReplayResult = { readonly total: number; readonly diffs: readonly { readonly index: number; readonly base: string; readonly branch: string }[] };

export function compareOutputs(base: readonly string[], branch: readonly string[]): ReplayResult {
  const total = Math.max(base.length, branch.length);
  const diffs: { index: number; base: string; branch: string }[] = [];
  for (let i = 0; i < total; i++) {
    const b = base[i] ?? '<missing>', n = branch[i] ?? '<missing>';
    if (b !== n) diffs.push({ index: i, base: b, branch: n });
  }
  return { total, diffs };
}

const lines = (file: string): string[] => readFileSync(file, 'utf8').split('\n').filter(Boolean);

function main(): void {
  const accept = process.argv.includes('--accept');
  const baseRef = defaultBase();
  const cache = join(tmpdir(), 'ap242-gauge-replay');
  mkdirSync(cache, { recursive: true });
  const inputs = join(cache, 'inputs.jsonl');
  rmSync(inputs, { force: true });
  console.log('capture: running the tests on the working tree');
  if (run(['bun', 'test'], { AP242_REPLAY_CAPTURE: inputs }) !== 0) console.log('capture: some tests failed; the inputs they recorded are still replayed');
  if (!existsSync(inputs)) throw new Error('the tests captured no inputs');

  const baseCopy = mkdtempSync(join(tmpdir(), 'ap242-replay-base-'));
  try {
    const tar = join(baseCopy, 'base.tar');
    git('archive', '--format=tar', '-o', tar, baseRef);
    mustRun(['tar', '-xf', tar, '-C', baseCopy]);
    const runner = join(import.meta.dir, 'replay-runner.ts');
    const baseOut = join(cache, 'base.out'), branchOut = join(cache, 'branch.out');
    mustRun(['bun', 'run', runner, baseCopy, inputs, baseOut]);
    mustRun(['bun', 'run', runner, root, inputs, branchOut]);
    const result = compareOutputs(lines(baseOut), lines(branchOut));
    console.log('replay: ' + result.total + ' outputs compared against ' + baseRef + ', ' + result.diffs.length + ' differ');
    if (!result.diffs.length) return;
    for (const d of result.diffs.slice(0, SHOWN_DIFFS)) {
      console.log('--- input ' + d.index + '\n- ' + d.base.slice(0, 600) + '\n+ ' + d.branch.slice(0, 600));
    }
    if (!accept) {
      console.error('replay failed: treat the commit as a refactor, or run with --accept after you read the diff');
      process.exit(1);
    }
    console.log('replay: diff accepted on this run');
  } finally {
    rmSync(baseCopy, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
