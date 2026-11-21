import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import occtimportjs from 'occt-import-js';
import { facesOf, readModel, transferables } from '../src/model.ts';
import { startOcct } from '../src/occt.ts';
import { load, MODEL_INCH } from './models.ts';
import type { Face } from '../src/geom.ts';
import { must } from '../src/util.ts';

test('readModel packs the faces, the render arrays and the outlines of the NIST CTC 05 model', async () => {
  const occt = await startOcct(occtimportjs, []);
  const stages: string[] = [];
  const out = readModel(occt, readFileSync(join(import.meta.dir, 'data', MODEL_INCH)), MODEL_INCH, (s) => stages.push(s));
  if (!out.ok) throw new Error(out.message);
  const d = out.data, expected = (await load(MODEL_INCH)).faces;
  const faces = facesOf(d);
  expect(d.unit.label).toBe('in');
  expect(stages).toEqual(['Reading ' + MODEL_INCH, 'Preparing ' + MODEL_INCH]);
  expect(faces.length).toBe(expected.length);
  const absolute = (f: Face): number[] => Array.from(f.tri, (x, i) => x + (d.origin[i % 3] ?? NaN));
  const near = (x: number, i: number, all: number[]): boolean => Math.abs(x - (all[i] ?? NaN)) <= 1e-9 * Math.max(1, Math.abs(x));
  faces.forEach((f, id) => {
    const want = Array.from(must(expected[id]).tri);
    expect(absolute(f).every((x, i) => near(x, i, want))).toBe(true);
  });
  expect(d.origin.every(Number.isInteger)).toBe(true);
  expect(d.lo.every((x, k) => Math.abs(x + (d.hi[k] ?? NaN)) <= 1)).toBe(true);
  const triangles = d.faceTri.length / 9;
  expect(d.tri.length).toBe(triangles * 9);
  expect(d.triFace.length).toBe(triangles);
  expect(d.triFace[triangles - 1]).toBe(faces.length - 1);
  expect(d.edges.length % 6).toBe(0);
  expect(d.edges.length).toBeGreaterThan(0);
  expect(d.hi.every((x, k) => x > (d.lo[k] ?? Infinity))).toBe(true);
  let unitNormals = 0;
  for (let i = 0; i < d.nrm.length; i += 9) {
    const l = Math.hypot(d.nrm[i] ?? 0, d.nrm[i + 1] ?? 0, d.nrm[i + 2] ?? 0);
    expect(l === 0 || Math.abs(l - 1) < 1e-5).toBe(true);
    if (l > 0) unitNormals++;
  }
  expect(unitNormals).toBeGreaterThan(triangles * 0.99);
  expect(transferables(d).length).toBe(9);
});

test('readModel reports a file that is not STEP', async () => {
  const occt = await startOcct(occtimportjs, []);
  const out = readModel(occt, new TextEncoder().encode('not a step file'), 'bad.stp', () => undefined);
  expect(out.ok).toBe(false);
});
