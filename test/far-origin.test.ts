import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import occtimportjs from 'occt-import-js';
import { describe } from '../src/format.ts';
import { add, sub } from '../src/geom.ts';
import type { Face, Vec3 } from '../src/geom.ts';
import { facesOf, readModel } from '../src/model.ts';
import type { ModelData } from '../src/model.ts';
import { startOcct } from '../src/occt.ts';
import type { OcctReader } from '../src/occt.ts';
import { raycast } from '../src/raycast.ts';
import { at } from '../src/util.ts';
import { faceNear, MODEL_MM } from './models.ts';
import { fitFace } from './subject.ts';

const OFFSET = 8388608;
const SHIFT: Vec3 = [OFFSET, OFFSET, OFFSET];

function read(reader: OcctReader, text: string): ModelData {
  const out = readModel(reader, new TextEncoder().encode(text), 'part.stp', () => undefined);
  if (!out.ok) throw new Error(out.message);
  return out.data;
}

function triangleReader(shift: number): OcctReader {
  const position = [0, 0, 0, 0.25, 0, 0, 0, 0.25, 0].map((x) => x + shift);
  return () => ({ success: true, meshes: [{ position, index: [0, 1, 2], brepFaces: [], color: null }] });
}

function area(tri: ArrayLike<number>, i: number): number {
  const ux = at(tri, i + 3) - at(tri, i), uy = at(tri, i + 4) - at(tri, i + 1), uz = at(tri, i + 5) - at(tri, i + 2);
  const vx = at(tri, i + 6) - at(tri, i), vy = at(tri, i + 7) - at(tri, i + 1), vz = at(tri, i + 8) - at(tri, i + 2);
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

function collapsed(d: ModelData): number {
  let n = 0;
  for (let i = 0; i < d.tri.length; i += 9) if (area(d.faceTri, i) > 1e-6 && area(d.tri, i) === 0) n++;
  return n;
}

function zeroLength(edges: Float32Array): number {
  let n = 0;
  for (let i = 0; i < edges.length; i += 6) {
    if (at(edges, i) === at(edges, i + 3) && at(edges, i + 1) === at(edges, i + 4) && at(edges, i + 2) === at(edges, i + 5)) n++;
  }
  return n;
}

function pickedFaces(d: ModelData, rays: ModelData): number[] {
  const out: number[] = [];
  const T = rays.tri;
  for (let i = 0; i < T.length; i += 9) {
    const mid = (k: number): number => (at(T, i + k) + at(T, i + 3 + k) + at(T, i + 6 + k)) / 3;
    const c: Vec3 = [mid(0), mid(1), mid(2)];
    const n: Vec3 = [at(rays.nrm, i), at(rays.nrm, i + 1), at(rays.nrm, i + 2)];
    const hit = raycast(d.tri, d.triFace, { o: add(c, n), d: [-n[0], -n[1], -n[2]] });
    out.push(hit ? hit.face : -1);
  }
  return out;
}

function faceMid(f: Face, k: 0 | 1 | 2): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = k; i < f.tri.length; i += 3) { lo = Math.min(lo, at(f.tri, i)); hi = Math.max(hi, at(f.tri, i)); }
  return (lo + hi) / 2;
}

function moveStep(text: string, by: number): string {
  const real = (x: number): string => {
    const s = String(x);
    if (/[eE]/.test(s) && !s.includes('.')) return s.replace(/[eE]/, '.E');
    return s.includes('.') ? s : s + '.';
  };
  return text.replace(/CARTESIAN_POINT\('([^']*)',\(([^)]*)\)\)/g, (_m, name: string, xyz: string) =>
    "CARTESIAN_POINT('" + name + "',(" + xyz.split(',').map((v) => real(Number(v) + by)).join(',') + '))');
}

test('Float32 cannot hold a 0.25 mm triangle at the test offset', () => {
  const far = new Float32Array([OFFSET, OFFSET + 0.25]);
  expect(far[0]).toBe(far[1] ?? NaN);
});

test('a 0.25 mm triangle far from the origin stays pickable', () => {
  for (const shift of [0, OFFSET]) {
    const d = read(triangleReader(shift), '');
    expect(d.origin).toEqual([shift, shift, shift]);
    expect(area(d.tri, 0)).toBeGreaterThan(0);
    expect(zeroLength(d.edges)).toBe(0);
    const target: Vec3 = [shift + 0.05, shift + 0.05, shift];
    const local = sub(target, d.origin);
    const hit = raycast(d.tri, d.triFace, { o: add(local, [0, 0, 10]), d: [0, 0, -1] });
    expect(hit?.face).toBe(0);
    const point = add(hit?.point ?? [NaN, NaN, NaN], d.origin);
    for (const k of [0, 1, 2] as const) expect(Math.abs(point[k] - target[k])).toBeLessThan(1e-6);
    expect(describe(0, { type: 'vertex', point: local, rms: null }, d.unit, d.origin)[1])
      .toBe('(' + [target[0], target[1], target[2]].map((x) => x.toFixed(4)).join(', ') + ')');
  }
});

test('a translated copy of NIST CTC 01 gives the same faces, picks and fits', async () => {
  const occt = await startOcct(occtimportjs, []);
  const text = readFileSync(join(import.meta.dir, 'data', MODEL_MM), 'latin1');
  const near = read(occt, text), far = read(occt, moveStep(text, OFFSET));
  expect(far.faceStart.length).toBe(near.faceStart.length);
  expect(far.tri.length).toBe(near.tri.length);
  expect(sub(far.origin, near.origin)).toEqual(SHIFT);
  for (const k of [0, 1, 2] as const) {
    expect(Math.abs(far.lo[k] - near.lo[k])).toBeLessThan(1e-6);
    expect(Math.abs(far.hi[k] - near.hi[k])).toBeLessThan(1e-6);
  }
  const nearFaces = facesOf(near), farFaces = facesOf(far);
  nearFaces.forEach((f, id) => {
    const g = farFaces[id];
    if (!g) throw new Error('face ' + id + ' is missing');
    expect(g.tri.length).toBe(f.tri.length);
    for (const k of [0, 1, 2] as const) expect(Math.abs(faceMid(g, k) - faceMid(f, k))).toBeLessThan(1e-6);
  });
  expect(collapsed(near)).toBe(0);
  expect(collapsed(far)).toBe(0);
  const nearPicks = pickedFaces(near, near);
  expect(nearPicks.filter((f) => f >= 0).length).toBeGreaterThan(nearPicks.length * 0.99);
  expect(pickedFaces(far, near)).toEqual(nearPicks);

  const probe: Vec3 = [-342.5, -175, -75];
  const nearFit = fitFace(faceNear(nearFaces, sub(probe, near.origin)));
  const farFit = fitFace(faceNear(farFaces, sub(add(probe, SHIFT), far.origin)));
  if (nearFit.type !== 'cylinder' || farFit.type !== 'cylinder') throw new Error('expected the 35 mm bore');
  expect(Math.abs(2 * farFit.radius - 35)).toBeLessThan(1e-3);
  expect(Math.abs(farFit.radius - nearFit.radius)).toBeLessThan(1e-6);
  const moved = sub(add(farFit.point, far.origin), add(nearFit.point, near.origin));
  for (const k of [0, 1, 2] as const) expect(Math.abs(moved[k] - OFFSET)).toBeLessThan(1e-3);
});
