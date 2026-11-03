import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import occtimportjs from 'occt-import-js';
import type { Face, LengthUnit, Vec3 } from '../src/geom.ts';
import { add, cross, dot, len, scale, sub } from '../src/geom.ts';
import { startOcct } from '../src/occt.ts';
import type { OcctReader } from '../src/occt.ts';
import { extractFaces, parseStepLengthUnit } from './subject.ts';
import { at, must } from '../src/util.ts';

export type Model = { readonly unit: LengthUnit; readonly faces: Face[] };

export const MODEL_MM = 'nist_ctc_01_asme1_ap242-e1.stp';
export const MODEL_INCH = 'nist_ctc_05_asme1_ap242-e1.stp';

let reader: Promise<OcctReader> | undefined;
const cache = new Map<string, Promise<Model>>();

async function read(file: string): Promise<Model> {
  reader = reader ?? startOcct(occtimportjs, []);
  const occt = await reader;
  const buf = readFileSync(join(import.meta.dir, 'data', file));
  const unit = parseStepLengthUnit(buf.toString('latin1'));
  const result = occt(buf, unit.occt);
  if (!result.success) throw new Error('occt-import-js cannot read ' + file);
  return { unit, faces: extractFaces(result.meshes) };
}

export function load(file: string): Promise<Model> {
  const known = cache.get(file);
  if (known) return known;
  const loading = read(file);
  cache.set(file, loading);
  return loading;
}

function vertex(tri: Float64Array, t: number, k: number): Vec3 {
  return [at(tri, t * 9 + k * 3), at(tri, t * 9 + k * 3 + 1), at(tri, t * 9 + k * 3 + 2)];
}

function distTri(p: Vec3, tri: Float64Array, t: number): number {
  const a = vertex(tri, t, 0), b = vertex(tri, t, 1), c = vertex(tri, t, 2);
  const n = cross(sub(b, a), sub(c, a));
  const nn = dot(n, n);
  if (nn > 0) {
    const ap = sub(p, a);
    const w = dot(cross(sub(b, a), ap), n) / nn;
    const v = dot(cross(ap, sub(c, a)), n) / nn;
    if (v >= 0 && w >= 0 && v + w <= 1) return Math.abs(dot(ap, n)) / Math.sqrt(nn);
  }
  const seg = (x: Vec3, y: Vec3): number => {
    const d = sub(y, x), s = Math.max(0, Math.min(1, dot(sub(p, x), d) / (dot(d, d) || 1)));
    return len(sub(p, add(x, scale(d, s))));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

export function faceNear(faces: readonly Face[], probe: Vec3): Face {
  let best: Face | undefined, bestD = Infinity;
  for (const f of faces) {
    for (let t = 0; t < f.tri.length / 9; t++) {
      const d = distTri(probe, f.tri, t);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  return must(best, 'a face near the probe');
}
