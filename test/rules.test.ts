import { expect, test } from 'bun:test';
import { overBudget, roundUpToStep } from '../scripts/budget.ts';
import { hotAllocations, htmlComments, isExcluded, tsComments } from '../scripts/rules.ts';
import { compareOutputs } from '../scripts/replay.ts';

test('comment rule: finds line, block, trailing and end-of-file comments', () => {
  expect(tsComments('// one\nconst a = 1;').length).toBe(1);
  expect(tsComments('const a = /* two */ 1;').length).toBe(1);
  expect(tsComments('const a = 1; // three').length).toBe(1);
  expect(tsComments('const a = 1;\n// four').length).toBe(1);
  expect(tsComments('function f() {\n  // five\n}').length).toBe(1);
});

test('comment rule: ignores comment markers inside strings, templates, regular expressions and colours', () => {
  expect(tsComments("const a = '// not'; const b = `/* not */`; const c = /\\/\\//; const d = '#fff';")).toEqual([]);
  expect(tsComments('#!/usr/bin/env bun\nconst a = 1;')).toEqual([]);
});

test('comment rule: keeps a comment that links to an outside source', () => {
  expect(tsComments('// see https://example.org/rfc\nconst a = 1;')).toEqual([]);
});

test('comment rule: finds html comments and style comments, keeps a linked one', async () => {
  expect((await htmlComments('<p>a</p><!-- note -->')).length).toBe(1);
  expect((await htmlComments('<style>a { color: red; } /* note */</style>')).length).toBe(1);
  expect(await htmlComments('<!-- https://example.org/licence --><p>a</p>')).toEqual([]);
  expect(await htmlComments('<style>a { color: #fff; }</style><script>const a = "<!-- not -->";</script>')).toEqual([]);
});

test('hot-path rule: finds object, array, closure and new', () => {
  for (const code of ['const a = {};', 'const a = [];', 'const a = () => 1;', 'const a = function () {};', 'const a = new Map();']) {
    expect(hotAllocations(code).length).toBe(1);
  }
});

test('hot-path rule: allows declarations, destructuring and type literals', () => {
  expect(hotAllocations('type T = { a: number };\nfunction f(t: T): number { const { a } = t; return a; }')).toEqual([]);
});

test('excluded paths: dist, vendored data and lock file are skipped, source is not', () => {
  expect(isExcluded('dist/ap242-gauge.html')).toBe(true);
  expect(isExcluded('test/data/SOURCE.md')).toBe(true);
  expect(isExcluded('bun.lock')).toBe(true);
  expect(isExcluded('src/geom.ts')).toBe(false);
});

test('page budget: rounds up to the next 10 KB and flags a page over its budget', () => {
  expect(roundUpToStep(4_225_863)).toBe(4_230_000);
  expect(roundUpToStep(4_230_000)).toBe(4_230_000);
  expect(overBudget([{ page: 'a.html', gzipBytes: 11, budget: 10 }, { page: 'b.html', gzipBytes: 10, budget: 10 }]).map((s) => s.page)).toEqual(['a.html']);
});

test('output replay: reports every differing output and a missing one', () => {
  expect(compareOutputs(['a', 'b'], ['a', 'b']).diffs).toEqual([]);
  expect(compareOutputs(['a', 'b'], ['a', 'c']).diffs).toEqual([{ index: 1, base: 'b', branch: 'c' }]);
  expect(compareOutputs(['a'], ['a', 'x']).diffs.length).toBe(1);
});
