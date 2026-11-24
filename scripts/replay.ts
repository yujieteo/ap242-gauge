import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../src/util.ts';

const root = join(import.meta.dir, '..');
const SHOWN_DIFFS = 5;
const ACCEPTED_NAME = 'scripts/replay-accepted.json';
const ACCEPTED_FILE = join(root, ACCEPTED_NAME);

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

type OutputPair = { readonly base: string; readonly branch: string };

export function parseAccepted(text: string): OutputPair[] {
  const json: unknown = JSON.parse(text);
  if (!Array.isArray(json)) throw new Error(ACCEPTED_NAME + ' is not an array');
  return json.map((entry: unknown, i): OutputPair => {
    if (!isRecord(entry) || typeof entry['base'] !== 'string' || typeof entry['branch'] !== 'string') {
      throw new Error(ACCEPTED_NAME + ' entry ' + i + ' needs the strings base and branch');
    }
    return { base: entry['base'], branch: entry['branch'] };
  });
}

const pairKey = (d: OutputPair): string => JSON.stringify([d.base, d.branch]);

export function splitAccepted<D extends OutputPair>(diffs: readonly D[], accepted: readonly OutputPair[]): { readonly fresh: D[]; readonly unused: OutputPair[] } {
  const known = new Set(accepted.map(pairKey));
  const seen = new Set(diffs.map(pairKey));
  return { fresh: diffs.filter((d) => !known.has(pairKey(d))), unused: accepted.filter((a) => !seen.has(pairKey(a))) };
}

export function addAccepted(accepted: readonly OutputPair[], fresh: readonly OutputPair[]): OutputPair[] {
  const out = [...accepted];
  const known = new Set(out.map(pairKey));
  for (const d of fresh) {
    if (known.has(pairKey(d))) continue;
    known.add(pairKey(d));
    out.push({ base: d.base, branch: d.branch });
  }
  return out;
}

const lines = (file: string): string[] => readFileSync(file, 'utf8').split('\n').filter(Boolean);

function main(): void {
  const accept = process.argv.includes('--accept');
  const baseRef = defaultBase();
  const work = mkdtempSync(join(tmpdir(), 'ap242-replay-'));
  try {
    const inputs = join(work, 'inputs.jsonl');
    console.log('capture: running the tests on the working tree');
    if (run(['bun', 'test'], { AP242_REPLAY_CAPTURE: inputs }) !== 0) console.log('capture: some tests failed; the inputs they recorded are still replayed');
    if (!existsSync(inputs)) throw new Error('the tests captured no inputs');
    const baseCopy = join(work, 'base');
    mkdirSync(baseCopy);
    const tar = join(work, 'base.tar');
    git('archive', '--format=tar', '-o', tar, baseRef);
    mustRun(['tar', '-xf', tar, '-C', baseCopy]);
    const runner = join(import.meta.dir, 'replay-runner.ts');
    const baseOut = join(work, 'base.out'), branchOut = join(work, 'branch.out');
    mustRun(['bun', 'run', runner, baseCopy, inputs, baseOut]);
    mustRun(['bun', 'run', runner, root, inputs, branchOut]);
    const result = compareOutputs(lines(baseOut), lines(branchOut));
    const accepted = existsSync(ACCEPTED_FILE) ? parseAccepted(readFileSync(ACCEPTED_FILE, 'utf8')) : [];
    const { fresh, unused } = splitAccepted(result.diffs, accepted);
    console.log('replay: ' + result.total + ' outputs compared against ' + baseRef + ', ' + result.diffs.length + ' differ, ' +
      (result.diffs.length - fresh.length) + ' of them accepted in ' + ACCEPTED_NAME);
    if (unused.length) console.log('replay: ' + unused.length + ' entries in ' + ACCEPTED_NAME + ' matched no difference on this run; remove them when the change is on main');
    if (!fresh.length) return;
    for (const d of fresh.slice(0, SHOWN_DIFFS)) {
      console.log('--- input ' + d.index + '\n- ' + d.base.slice(0, 600) + '\n+ ' + d.branch.slice(0, 600));
    }
    if (!accept) {
      console.error('replay failed: ' + fresh.length + ' differences are not accepted; treat the commit as a refactor, or run with --accept after you read the diff');
      process.exitCode = 1;
      return;
    }
    writeFileSync(ACCEPTED_FILE, JSON.stringify(addAccepted(accepted, fresh), null, 2) + '\n');
    console.log('replay: ' + fresh.length + ' differences added to ' + ACCEPTED_NAME + '; commit that file');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
