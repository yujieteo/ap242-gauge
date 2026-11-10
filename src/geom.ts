import { at, must } from './util.ts';

export type Vec3 = readonly [number, number, number];
type Idx = 0 | 1 | 2;
type Row = [number, number, number];
type Mat3 = [Row, Row, Row];
type Pt4 = readonly [number, number, number, number];
type Pt2 = readonly [number, number];

const AXES: readonly Idx[] = [0, 1, 2];
const NEXT_AXIS: Readonly<Record<Idx, Idx>> = { 0: 1, 1: 2, 2: 0 };
const JACOBI_PAIRS: readonly (readonly [Idx, Idx])[] = [[0, 1], [0, 2], [1, 2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
type Vec3Like = readonly [number, number, number, ...number[]];
export const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};
const DEG = 180 / Math.PI;

export const UNITS = {
  mm: { label: 'mm', occt: 'millimeter' },
  cm: { label: 'cm', occt: 'centimeter' },
  m: { label: 'm', occt: 'meter' },
  in: { label: 'in', occt: 'inch' },
  ft: { label: 'ft', occt: 'foot' },
} as const;
type UnitLabel = keyof typeof UNITS;
export type LengthUnit = (typeof UNITS)[UnitLabel];
export type LinearUnitName = LengthUnit['occt'];

const DEFAULT_UNIT: LengthUnit = UNITS.mm;

function unitFromConversionName(name: string): LengthUnit | null {
  const n = name.toLowerCase();
  if (n.startsWith('inch')) return UNITS.in;
  if (n.startsWith('foot') || n === 'feet') return UNITS.ft;
  if (n.startsWith('milli')) return UNITS.mm;
  if (n.startsWith('centi')) return UNITS.cm;
  if (n.startsWith('metre') || n.startsWith('meter')) return UNITS.m;
  return null;
}

function unitFromSiPrefix(prefix: string): LengthUnit | null {
  const p = prefix.trim().toUpperCase();
  if (p === '.MILLI.') return UNITS.mm;
  if (p === '.CENTI.') return UNITS.cm;
  if (p === '$') return UNITS.m;
  return null;
}

function unitOfRecord(body: string): LengthUnit | null {
  if (!/LENGTH_UNIT\s*\(\s*\)/.test(body)) return null;
  const conv = /CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/i.exec(body);
  if (conv) return unitFromConversionName(must(conv[1]));
  const si = /SI_UNIT\s*\(\s*([^,]*),\s*\.METRE\.\s*\)/i.exec(body);
  return si ? unitFromSiPrefix(must(si[1])) : null;
}

function recordsWith(text: string, word: string): string[] {
  const out: string[] = [];
  for (let i = text.indexOf(word); i >= 0;) {
    const end = text.indexOf(';', i);
    const stop = end < 0 ? text.length : end;
    out.push(text.slice(text.lastIndexOf(';', i) + 1, stop));
    i = text.indexOf(word, stop);
  }
  return out;
}

export function parseStepLengthUnit(text: string): LengthUnit {
  const byId = new Map<string, LengthUnit>();
  let firstUnit: LengthUnit | null = null;
  for (const record of recordsWith(text, 'LENGTH_UNIT')) {
    const m = /^\s*#(\d+)\s*=([\s\S]*)$/.exec(record);
    const unit = m ? unitOfRecord(must(m[2])) : null;
    if (!m || !unit) continue;
    byId.set(must(m[1]), unit);
    firstUnit = firstUnit ?? unit;
  }
  for (const record of recordsWith(text, 'GLOBAL_UNIT_ASSIGNED_CONTEXT')) {
    const refs = /GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)/.exec(record);
    for (const ref of refs ? must(refs[1]).split(',') : []) {
      const unit = byId.get(ref.trim().slice(1));
      if (unit) return unit;
    }
  }
  return firstUnit ?? DEFAULT_UNIT;
}

export type BrepGroup = { readonly first: number; readonly last: number };
export type MeshGeometry = {
  readonly position: ArrayLike<number>;
  readonly index: ArrayLike<number>;
  readonly brepFaces: readonly BrepGroup[];
};
export type Face = { readonly id: number; readonly mesh: number; readonly tri: Float64Array };

export function extractFaces(meshes: readonly MeshGeometry[]): Face[] {
  let total = 0;
  for (const mesh of meshes) {
    const groups = mesh.brepFaces.length ? mesh.brepFaces : [{ first: 0, last: mesh.index.length / 3 - 1 }];
    for (const g of groups) total += Math.max(0, g.last - g.first + 1);
  }
  const all = new Float64Array(total * 9);
  const faces: Face[] = [];
  let o = 0;
  meshes.forEach((mesh, mi) => {
    const pos = mesh.position;
    const idx = mesh.index;
    const groups = mesh.brepFaces.length ? mesh.brepFaces : [{ first: 0, last: idx.length / 3 - 1 }];
    for (const g of groups) {
      const n = g.last - g.first + 1;
      if (!(n > 0)) continue;
      const start = o;
      for (let i = g.first * 3, end = (g.last + 1) * 3; i < end; i++, o += 3) {
        const v = at(idx, i) * 3;
        all[o] = at(pos, v);
        all[o + 1] = at(pos, v + 1);
        all[o + 2] = at(pos, v + 2);
      }
      faces.push({ id: faces.length, mesh: mi, tri: all.subarray(start, o) });
    }
  });
  return faces;
}

export const vertexAt = (tri: Float64Array, i: number): Vec3 => [at(tri, i * 3), at(tri, i * 3 + 1), at(tri, i * 3 + 2)];

const unitRows = (): Mat3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const zeroRows = (): Mat3 => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

type Eigen = { readonly values: Vec3; readonly vectors: readonly [Vec3, Vec3, Vec3] };

export function eigSym3(A: Mat3): Eigen {
  const a: Mat3 = [[...A[0]], [...A[1]], [...A[2]]];
  const v = unitRows();
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-30) break;
    for (const [p, q] of JACOBI_PAIRS) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (const k of AXES) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (const k of AXES) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (const k of AXES) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order: [Idx, Idx, Idx] = [0, 1, 2];
  order.sort((i, j) => a[i][i] - a[j][j]);
  const [o0, o1, o2] = order;
  return {
    values: [a[o0][o0], a[o1][o1], a[o2][o2]],
    vectors: [
      [v[0][o0], v[1][o0], v[2][o0]],
      [v[0][o1], v[1][o1], v[2][o1]],
      [v[0][o2], v[1][o2], v[2][o2]],
    ],
  };
}

type Moments = { readonly W: number; readonly c: Vec3; readonly C: Mat3 };

function moments(pts: readonly Pt4[]): Moments {
  let W = 0;
  const c: Row = [0, 0, 0];
  for (const p of pts) { W += p[3]; c[0] += p[0] * p[3]; c[1] += p[1] * p[3]; c[2] += p[2] * p[3]; }
  c[0] /= W; c[1] /= W; c[2] /= W;
  const C = zeroRows();
  for (const p of pts) {
    const d: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (const i of AXES) for (const j of AXES) C[i][j] += p[3] * d[i] * d[j];
  }
  return { W, c, C };
}

export function basis(d: Vec3): readonly [Vec3, Vec3] {
  const t: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, t));
  return [u, cross(d, u)];
}

type Circle2 = { readonly cx: number; readonly cy: number; readonly r: number };

function fitCircleXY(xs: Float64Array, ys: Float64Array, n: number): Circle2 | null {
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += at(xs, i); my += at(ys, i); }
  mx /= n; my /= n;
  let m00 = 0, m01 = 0, m02 = 0, m11 = 0, m12 = 0, m22 = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const x = at(xs, i) - mx, y = at(ys, i) - my, z = x * x + y * y;
    m00 += x * x; m01 += x * y; m02 += x;
    m11 += y * y; m12 += y; m22 += 1;
    b0 -= x * z; b1 -= y * z; b2 -= z;
  }
  const s = solve3([[m00, m01, m02], [m01, m11, m12], [m02, m12, m22]], [b0, b1, b2]);
  if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
  if (!(r2 > 0)) return null;
  return { cx: cx + mx, cy: cy + my, r: Math.sqrt(r2) };
}

export function fitCircle2(p2: readonly Pt2[]): Circle2 | null {
  const xs = new Float64Array(p2.length), ys = new Float64Array(p2.length);
  p2.forEach((p, i) => { xs[i] = p[0]; ys[i] = p[1]; });
  return fitCircleXY(xs, ys, p2.length);
}

const det3 = (m: Mat3): number => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
  - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

function solve3(M: Mat3, b: Vec3): Vec3 | null {
  const D = det3(M);
  if (Math.abs(D) < 1e-300) return null;
  const out: Row = [0, 0, 0];
  for (const k of AXES) {
    const m: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const i of AXES) for (const j of AXES) m[i][j] = j === k ? b[i] : M[i][j];
    out[k] = det3(m) / D;
  }
  return out;
}

type PlaneFit = { readonly type: 'plane'; readonly point: Vec3; readonly normal: Vec3; readonly rms: number; readonly size: number };
type CylinderFit = { readonly type: 'cylinder'; readonly point: Vec3; readonly dir: Vec3; readonly radius: number; readonly rms: number; readonly size: number };
type SurfaceFit = { readonly type: 'surface'; readonly point: Vec3; readonly rms: null; readonly size: number };
export type FaceFit = PlaneFit | CylinderFit | SurfaceFit;
type LineFit = { readonly type: 'line'; readonly point: Vec3; readonly dir: Vec3; readonly length: number; readonly ends: readonly [Vec3, Vec3]; readonly rms: number };
type CircleFit = { readonly type: 'circle'; readonly point: Vec3; readonly dir: Vec3; readonly radius: number; readonly rms: number; readonly ends: readonly [Vec3, Vec3] };
type PolylineFit = { readonly type: 'polyline'; readonly point: Vec3; readonly ends: readonly [Vec3, Vec3]; readonly rms: null };
export type EdgeFit = LineFit | CircleFit | PolylineFit;
type VertexFit = { readonly type: 'vertex'; readonly point: Vec3; readonly rms: null };
export type Fit = FaceFit | EdgeFit | VertexFit;

type AxisTry = { readonly axis: Vec3; readonly u: Vec3; readonly v: Vec3; readonly circ: Circle2; readonly rms: number };
const CYLINDER_REFINE_GATE = 1e-2;
const CYLINDER_REFINE_STEP = 0.02;

const emptyBounds = (): { lo: Row; hi: Row } => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });

export function fitFace(face: Face): FaceFit {
  const tri = face.tri, nt = tri.length / 9;
  const pts: Pt4[] = [];
  const N = zeroRows();
  const { lo, hi } = emptyBounds();
  for (let t = 0; t < nt; t++) {
    const a = vertexAt(tri, t * 3), b = vertexAt(tri, t * 3 + 1), c = vertexAt(tri, t * 3 + 2);
    const nrm = cross(sub(b, a), sub(c, a));
    const area = len(nrm) / 2;
    if (!(area > 0)) continue;
    const n = scale(nrm, 0.5 / area);
    for (const i of AXES) for (const j of AXES) N[i][j] += area * n[i] * n[j];
    for (const p of [a, b, c]) {
      pts.push([p[0], p[1], p[2], area / 3]);
      for (const k of AXES) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
  }
  if (!pts.length) return { type: 'surface', point: vertexAt(tri, 0), rms: null, size: 0 };
  const size = len(sub(hi, lo));
  const tol = Math.max(1e-4 * size, 1e-7);
  const { W, c, C } = moments(pts);

  const e = eigSym3(C);
  const pn = e.vectors[0];
  const planeRms = Math.sqrt(Math.max(e.values[0], 0) / W);
  if (planeRms <= tol) {
    let s = 0;
    for (let t = 0; t < nt; t++) {
      const a = vertexAt(tri, t * 3);
      const nrm = cross(sub(vertexAt(tri, t * 3 + 1), a), sub(vertexAt(tri, t * 3 + 2), a));
      s += dot(nrm, pn);
    }
    return { type: 'plane', point: c, normal: s < 0 ? scale(pn, -1) : pn, rms: planeRms, size };
  }

  const xs = new Float64Array(pts.length), ys = new Float64Array(pts.length);
  const across = (axis: Vec3): AxisTry | null => {
    const [u, v] = basis(axis);
    pts.forEach((p, i) => { xs[i] = dot(p, u); ys[i] = dot(p, v); });
    const circ = fitCircleXY(xs, ys, pts.length);
    if (!circ) return null;
    let ss = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(at(xs, i) - circ.cx, at(ys, i) - circ.cy) - circ.r;
      ss += must(pts[i])[3] * d * d;
    }
    return { axis, u, v, circ, rms: Math.sqrt(ss / W) };
  };
  let best = across(eigSym3(N).vectors[0]);
  if (best && best.rms <= CYLINDER_REFINE_GATE * size) {
    for (let step = CYLINDER_REFINE_STEP, tries = 0; step > 1e-13 && best.rms > 1e-13 * size && tries < 400; tries++) {
      const from: AxisTry = best;
      for (const side of [from.u, scale(from.u, -1), from.v, scale(from.v, -1)]) {
        const next = across(norm(add(from.axis, scale(side, step))));
        if (next && next.rms < best.rms) best = next;
      }
      if (best === from) step /= 2;
    }
  }
  if (best && best.rms <= tol) {
    const onAxis = add(add(scale(best.u, best.circ.cx), scale(best.v, best.circ.cy)), scale(best.axis, dot(c, best.axis)));
    return { type: 'cylinder', point: onAxis, dir: best.axis, radius: best.circ.r, rms: best.rms, size };
  }
  return { type: 'surface', point: c, rms: null, size };
}

const EDGE_CHAIN_TURN_DEG = 40;
const EDGE_STRAIGHT_TURN_DEG = 0.5;
const ARC_MIN_POINTS = 4;
const ARC_FREE_POINTS = 5;
const UNIFORM_CHORD = 1e-3;
const FACET_TURN_RATIO = 0.7;
const FACET_LENGTH_RATIO = 2;

export type Boundary = { readonly first: readonly number[]; readonly segs: readonly number[] };

export function boundary(tri: Float64Array): Boundary {
  const nv = tri.length / 3;
  const ids = new Map<string, number>();
  const first: number[] = [];
  const vid = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const key = Math.round(at(tri, i * 3) * 1e6) + ',' + Math.round(at(tri, i * 3 + 1) * 1e6) + ',' + Math.round(at(tri, i * 3 + 2) * 1e6);
    let id = ids.get(key);
    if (id === undefined) {
      id = first.length;
      ids.set(key, id);
      first.push(i);
    }
    vid[i] = id;
  }
  const n = first.length;
  const count = new Map<number, number>();
  for (let i = 0; i < nv; i += 3) {
    for (const k of AXES) {
      const a = at(vid, i + k), b = at(vid, i + NEXT_AXIS[k]);
      if (a === b) continue;
      const key = a < b ? a * n + b : b * n + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const segs: number[] = [];
  for (const [key, uses] of count) if (uses === 1) segs.push(Math.floor(key / n), key % n);
  return { first, segs };
}

export function faceEdge(face: Face, hit: Vec3): EdgeFit | null {
  const { first, segs } = boundary(face.tri);
  const verts = first.map((i) => vertexAt(face.tri, i));
  const adj: number[][] = verts.map(() => []);
  let seed: [number, number] | null = null, bestD = Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    const a = must(segs[i]), b = must(segs[i + 1]);
    must(adj[a]).push(b); must(adj[b]).push(a);
    const d = distPointSegment(hit, must(verts[a]), must(verts[b]));
    if (d < bestD) { bestD = d; seed = [a, b]; }
  }
  if (!seed) return null;
  const cosMax = Math.cos(EDGE_CHAIN_TURN_DEG / DEG);
  const seen = new Set<number>(seed);
  const walk = (from: number, to: number): number[] => {
    const out: number[] = [];
    let prev = from, cur = to;
    for (;;) {
      const dirIn = norm(sub(must(verts[cur]), must(verts[prev])));
      const next = must(adj[cur]).filter((n) => n !== prev && !seen.has(n));
      const only = next[0];
      if (next.length !== 1 || only === undefined) break;
      const dirOut = norm(sub(must(verts[only]), must(verts[cur])));
      if (dot(dirIn, dirOut) < cosMax) break;
      seen.add(only); out.push(only);
      prev = cur; cur = only;
    }
    return out;
  };
  const fwd = walk(seed[0], seed[1]);
  const back = walk(seed[1], seed[0]).reverse();
  const ids = [...back, seed[0], seed[1], ...fwd];
  const closed = ids.length > 3 && must(adj[must(ids[0])]).includes(must(ids[ids.length - 1]));
  const chain = ids.map((i) => must(verts[i]));
  const whole = fitEdgeChain(chain, closed);
  return whole.type === 'polyline' ? fitEdgeRun(chain, closed, back.length) ?? whole : whole;
}

function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, scale(ab, t))));
}

function chainTol(chain: readonly Vec3[]): number {
  const { lo, hi } = emptyBounds();
  for (const p of chain) for (const k of AXES) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return Math.max(1e-4 * len(sub(hi, lo)), 1e-7);
}

function fitLine(chain: readonly Vec3[]): LineFit | null {
  const a = must(chain[0]), b = must(chain[chain.length - 1]);
  const L = len(sub(b, a));
  if (!(L > 0)) return null;
  const d = scale(sub(b, a), 1 / L);
  let worst = 0;
  for (const p of chain) worst = Math.max(worst, len(cross(sub(p, a), d)));
  return worst <= chainTol(chain) ? { type: 'line', point: scale(add(a, b), 0.5), dir: d, length: L, ends: [a, b], rms: worst } : null;
}

function fitCircle(chain: readonly Vec3[]): CircleFit | null {
  if (chain.length < 3) return null;
  const pts: Pt4[] = chain.map((p) => [p[0], p[1], p[2], 1]);
  const { c, C } = moments(pts);
  const n = eigSym3(C).vectors[0];
  const [u, v] = basis(n);
  const p2: Pt2[] = chain.map((p) => [dot(p, u), dot(p, v)]);
  const circ = fitCircle2(p2);
  if (!circ) return null;
  let ss = 0;
  for (const p of p2) { const d = Math.hypot(p[0] - circ.cx, p[1] - circ.cy) - circ.r; ss += d * d; }
  const rms = Math.sqrt(ss / p2.length);
  if (rms > Math.max(1e-4 * chordRange(chain)[0], 1e-7)) return null;
  const center = add(add(scale(u, circ.cx), scale(v, circ.cy)), scale(n, dot(c, n)));
  return { type: 'circle', point: center, dir: n, radius: circ.r, rms, ends: [must(chain[0]), must(chain[chain.length - 1])] };
}

function chordRange(chain: readonly Vec3[]): readonly [number, number] {
  let lo = Infinity, hi = 0;
  for (let i = 1; i < chain.length; i++) {
    const l = len(sub(must(chain[i]), must(chain[i - 1])));
    lo = Math.min(lo, l); hi = Math.max(hi, l);
  }
  return [lo, hi];
}

function uniformChords(chain: readonly Vec3[]): boolean {
  const [lo, hi] = chordRange(chain);
  return hi - lo <= UNIFORM_CHORD * hi;
}

const looksLikeArc = (chain: readonly Vec3[], minPoints: number): boolean =>
  chain.length >= ARC_FREE_POINTS || (chain.length >= minPoints && uniformChords(chain));

function fitEdgeChain(chain: readonly Vec3[], closed: boolean): EdgeFit {
  const line = closed ? null : fitLine(chain);
  if (line) return line;
  const circle = looksLikeArc(chain, 3) ? fitCircle(chain) : null;
  if (circle) return circle;
  return { type: 'polyline', point: must(chain[Math.floor(chain.length / 2)]), ends: [must(chain[0]), must(chain[chain.length - 1])], rms: null };
}

function fitEdgeRun(chain: readonly Vec3[], closed: boolean, s: number): EdgeFit | null {
  const n = chain.length;
  const P = (i: number): Vec3 => must(chain[((i % n) + n) % n]);
  const run = (a: number, b: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = a; i <= b; i++) out.push(P(i));
    return out;
  };
  const turn = (i: number): number | null => {
    if (!closed && (i <= 0 || i >= n - 1)) return null;
    const d = dot(norm(sub(P(i), P(i - 1))), norm(sub(P(i + 1), P(i))));
    const t = Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
    return t > EDGE_CHAIN_TURN_DEG ? null : t;
  };
  const grow = (a: number, b: number, leftFirst: boolean, ok: (a: number, b: number, added: number) => boolean): [number, number] => {
    for (const left of [leftFirst, !leftFirst]) {
      for (;;) {
        if (b - a >= n - 1 || turn(left ? a : b) === null) break;
        if (!ok(left ? a - 1 : a, left ? b : b + 1, left ? a : b)) break;
        if (left) a--; else b++;
      }
    }
    return [a, b];
  };
  const straight = grow(s, s + 1, true, (_a, _b, joint) => (turn(joint) ?? Infinity) <= EDGE_STRAIGHT_TURN_DEG);
  if (straight[1] - straight[0] >= 2) {
    const line = fitLine(run(straight[0], straight[1]));
    if (line) return line;
  }
  const onCircle = (a: number, b: number): boolean => fitCircle(run(a, b)) !== null;
  const arcL = grow(s, s + 1, true, onCircle), arcR = grow(s, s + 1, false, onCircle);
  const arc = arcL[1] - arcL[0] >= arcR[1] - arcR[0] ? arcL : arcR;
  const arcPoints = run(arc[0], arc[1]);
  if (looksLikeArc(arcPoints, ARC_MIN_POINTS)) return fitCircle(arcPoints);
  const seedLength = len(sub(P(s + 1), P(s)));
  const facetOf = (joint: number, step: number): boolean => {
    const t0 = turn(joint), t1 = turn(joint + step);
    if (t0 === null || t1 === null || t0 <= FACET_TURN_RATIO * t1 || t1 <= FACET_TURN_RATIO * t0) return false;
    const l = len(sub(P(joint + step), P(joint)));
    return l <= FACET_LENGTH_RATIO * seedLength && seedLength <= FACET_LENGTH_RATIO * l;
  };
  if (facetOf(s, -1) || facetOf(s + 1, 1)) return null;
  return fitLine(run(s, s + 1));
}

type PlaneFeature = { readonly kind: 'plane'; readonly point: Vec3; readonly normal: Vec3 };
type AxisFeature = { readonly kind: 'axis'; readonly point: Vec3; readonly dir: Vec3; readonly radius?: number; readonly center?: true };
type PointFeature = { readonly kind: 'point'; readonly point: Vec3 };
export type Feature = PlaneFeature | AxisFeature | PointFeature;

export function featureFrom(fit: Fit): Feature {
  switch (fit.type) {
    case 'plane': return { kind: 'plane', point: fit.point, normal: fit.normal };
    case 'cylinder': return { kind: 'axis', point: fit.point, dir: fit.dir, radius: fit.radius };
    case 'circle': return { kind: 'axis', point: fit.point, dir: fit.dir, radius: fit.radius, center: true };
    case 'line': return { kind: 'axis', point: fit.point, dir: fit.dir };
    default: return { kind: 'point', point: fit.point };
  }
}

const PARALLEL_DEG = 0.01;

const lineAngle = (d1: Vec3, d2: Vec3): number => Math.acos(Math.min(1, Math.abs(dot(norm(d1), norm(d2))))) * DEG;

export type Measurement = { readonly label: string; readonly value: number; readonly type: 'length' | 'angle' };

export function measure(A: Feature, B: Feature): Measurement[] {
  const out: Measurement[] = [];
  const L = (label: string, value: number): void => { out.push({ label, value, type: 'length' }); };
  const G = (label: string, value: number): void => { out.push({ label, value, type: 'angle' }); };
  if (A.kind === 'point' && B.kind !== 'point') return measure(B, A);
  if (A.kind === 'axis' && B.kind === 'plane') return measure(B, A);
  const dp = sub(B.point, A.point);

  if (A.kind === 'plane' && B.kind === 'plane') {
    const between = Math.acos(Math.max(-1, Math.min(1, dot(A.normal, B.normal)))) * DEG;
    const a = lineAngle(A.normal, B.normal);
    G('angle between planes', a);
    G('angle between normals', between);
    if (a <= PARALLEL_DEG) L('distance (parallel planes)', Math.abs(dot(dp, A.normal)));
    else L('distance of B centroid from plane A', Math.abs(dot(dp, A.normal)));
  } else if (A.kind === 'plane' && B.kind === 'axis') {
    const a = 90 - lineAngle(A.normal, B.dir);
    G('angle axis to plane', a);
    if (a <= PARALLEL_DEG) L('distance axis to plane', Math.abs(dot(dp, A.normal)));
    else L('distance of axis point from plane', Math.abs(dot(dp, A.normal)));
  } else if (A.kind === 'plane' && B.kind === 'point') {
    L('distance point to plane', Math.abs(dot(dp, A.normal)));
  } else if (A.kind === 'axis' && B.kind === 'axis') {
    const a = lineAngle(A.dir, B.dir);
    G('angle between axes', a);
    const c = cross(norm(A.dir), norm(B.dir));
    if (a <= PARALLEL_DEG) L('distance between parallel axes', len(cross(dp, norm(A.dir))));
    else L('shortest distance between axes', Math.abs(dot(dp, norm(c))));
  } else if (A.kind === 'axis' && B.kind === 'point') {
    L('distance point to axis', len(cross(dp, norm(A.dir))));
  }
  L('distance feature points', len(dp));
  return out;
}
