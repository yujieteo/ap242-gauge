import { at, must } from './util.ts';

export type Vec3 = readonly [number, number, number];
type Idx = 0 | 1 | 2;
type Row = [number, number, number];
type Mat3 = [Row, Row, Row];
type Pt4 = readonly [number, number, number, number];
type Pt2 = readonly [number, number];

export const AXES: readonly Idx[] = [0, 1, 2];
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

export function parseStepLengthUnit(text: string): LengthUnit {
  const flat = text.replace(/\s+/g, ' ');
  const records = flat.split(';');
  const byId = new Map<string, string>();
  for (const r of records) {
    const m = /^\s*#(\d+)\s*=\s*(.*)$/.exec(r);
    if (m) byId.set(must(m[1]), must(m[2]));
  }
  for (const body of byId.values()) {
    if (!/LENGTH_UNIT\s*\(\s*\)/i.test(body)) continue;
    const conv = /CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/i.exec(body);
    if (conv) {
      const unit = unitFromConversionName(must(conv[1]));
      if (unit) return unit;
      continue;
    }
    const si = /SI_UNIT\s*\(\s*([^,]*),\s*\.METRE\.\s*\)/i.exec(body);
    if (si) {
      const unit = unitFromSiPrefix(must(si[1]));
      if (unit) return unit;
    }
  }
  return DEFAULT_UNIT;
}

export type BrepGroup = { readonly first: number; readonly last: number };
export type MeshGeometry = {
  readonly position: ArrayLike<number>;
  readonly index: ArrayLike<number>;
  readonly brepFaces: readonly BrepGroup[];
};
export type Face = { readonly id: number; readonly mesh: number; readonly tri: Float64Array };

export function extractFaces(meshes: readonly MeshGeometry[]): Face[] {
  const faces: Face[] = [];
  meshes.forEach((mesh, mi) => {
    const pos = mesh.position;
    const idx = mesh.index;
    const groups = mesh.brepFaces.length ? mesh.brepFaces : [{ first: 0, last: idx.length / 3 - 1 }];
    for (const g of groups) {
      const n = g.last - g.first + 1;
      const tri = new Float64Array(n * 9);
      for (let t = 0; t < n; t++) {
        for (let k = 0; k < 3; k++) {
          const v = at(idx, (g.first + t) * 3 + k);
          tri[t * 9 + k * 3] = at(pos, v * 3);
          tri[t * 9 + k * 3 + 1] = at(pos, v * 3 + 1);
          tri[t * 9 + k * 3 + 2] = at(pos, v * 3 + 2);
        }
      }
      faces.push({ id: faces.length, mesh: mi, tri });
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

export function fitCircle2(p2: readonly Pt2[]): Circle2 | null {
  let mx = 0, my = 0;
  for (const p of p2) { mx += p[0]; my += p[1]; }
  mx /= p2.length; my /= p2.length;
  const M = zeroRows();
  const b: Row = [0, 0, 0];
  for (const p of p2) {
    const x = p[0] - mx, y = p[1] - my, z = x * x + y * y;
    const row: Vec3 = [x, y, 1];
    for (const i of AXES) { for (const j of AXES) M[i][j] += row[i] * row[j]; b[i] -= row[i] * z; }
  }
  const s = solve3(M, b);
  if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
  if (!(r2 > 0)) return null;
  return { cx: cx + mx, cy: cy + my, r: Math.sqrt(r2) };
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

  const axis = eigSym3(N).vectors[0];
  const [u, v] = basis(axis);
  const p2: Pt2[] = pts.map((p) => [dot(p, u), dot(p, v)]);
  const circ = fitCircle2(p2);
  if (circ) {
    let ss = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = must(p2[i]);
      const d = Math.hypot(q[0] - circ.cx, q[1] - circ.cy) - circ.r;
      ss += must(pts[i])[3] * d * d;
    }
    const cylRms = Math.sqrt(ss / W);
    if (cylRms <= tol) {
      const onAxis = add(add(scale(u, circ.cx), scale(v, circ.cy)), scale(axis, dot(c, axis)));
      return { type: 'cylinder', point: onAxis, dir: axis, radius: circ.r, rms: cylRms, size };
    }
  }
  return { type: 'surface', point: c, rms: null, size };
}

const EDGE_CHAIN_TURN_DEG = 40;
const EDGE_STRAIGHT_TURN_DEG = 0.5;

export function faceEdge(face: Face, hit: Vec3): EdgeFit | null {
  const e = faceEdgeChain(face, hit, EDGE_CHAIN_TURN_DEG);
  if (!e || e.type !== 'polyline') return e;
  const straight = faceEdgeChain(face, hit, EDGE_STRAIGHT_TURN_DEG);
  return straight && straight.type === 'line' ? straight : e;
}

type BoundaryEdge = { readonly a: number; readonly b: number; n: number };

function faceEdgeChain(face: Face, hit: Vec3, maxTurnDeg: number): EdgeFit | null {
  const tri = face.tri, nt = tri.length / 9;
  const keyOf = (p: Vec3): string => [p[0], p[1], p[2]].map((x) => Math.round(x * 1e6)).join(',');
  const vid = new Map<string, number>();
  const verts: Vec3[] = [];
  const id = (p: Vec3): number => {
    const k = keyOf(p);
    const known = vid.get(k);
    if (known !== undefined) return known;
    vid.set(k, verts.length);
    verts.push(p);
    return verts.length - 1;
  };
  const count = new Map<string, BoundaryEdge>();
  for (let t = 0; t < nt; t++) {
    const ids: Vec3 = [id(vertexAt(tri, t * 3)), id(vertexAt(tri, t * 3 + 1)), id(vertexAt(tri, t * 3 + 2))];
    for (const k of AXES) {
      const a = ids[k], b = ids[NEXT_AXIS[k]];
      if (a === b) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const ek = lo + '_' + hi;
      const known = count.get(ek);
      if (known) known.n++;
      else count.set(ek, { a: lo, b: hi, n: 1 });
    }
  }
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  let best: [number, number] | null = null, bestD = Infinity;
  for (const edge of count.values()) {
    if (edge.n !== 1) continue;
    const { a, b } = edge;
    link(a, b); link(b, a);
    const d = distPointSegment(hit, must(verts[a]), must(verts[b]));
    if (d < bestD) { bestD = d; best = [a, b]; }
  }
  if (!best) return null;
  const cosMax = Math.cos(maxTurnDeg / DEG);
  const walk = (from: number, to: number, seen: Set<number>): number[] => {
    const out: number[] = [];
    let prev = from, cur = to;
    for (;;) {
      const dirIn = norm(sub(must(verts[cur]), must(verts[prev])));
      const next = (adj.get(cur) ?? []).filter((n) => n !== prev && !seen.has(n));
      const only = next[0];
      if (next.length !== 1 || only === undefined) break;
      const dirOut = norm(sub(must(verts[only]), must(verts[cur])));
      if (dot(dirIn, dirOut) < cosMax) break;
      seen.add(only); out.push(only);
      prev = cur; cur = only;
    }
    return out;
  };
  const seen = new Set<number>(best);
  const fwd = walk(best[0], best[1], seen);
  const back = walk(best[1], best[0], seen);
  const chain = [...back.reverse(), best[0], best[1], ...fwd].map((i) => must(verts[i]));
  const first = must(chain[0]), last = must(chain[chain.length - 1]);
  const closed = chain.length > 3 && (adj.get(must(vid.get(keyOf(first)))) ?? []).includes(must(vid.get(keyOf(last))));
  return fitEdgeChain(chain, closed);
}

function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, scale(ab, t))));
}

function fitEdgeChain(chain: readonly Vec3[], closed: boolean): EdgeFit {
  const a = must(chain[0]), b = must(chain[chain.length - 1]);
  const L = len(sub(b, a));
  const { lo, hi } = emptyBounds();
  for (const p of chain) for (const k of AXES) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const size = len(sub(hi, lo));
  const tol = Math.max(1e-4 * size, 1e-7);
  if (!closed && L > 0) {
    const d = scale(sub(b, a), 1 / L);
    let worst = 0;
    for (const p of chain) worst = Math.max(worst, len(cross(sub(p, a), d)));
    if (worst <= tol) return { type: 'line', point: scale(add(a, b), 0.5), dir: d, length: L, ends: [a, b], rms: worst };
  }
  if (chain.length >= 3) {
    const pts: Pt4[] = chain.map((p) => [p[0], p[1], p[2], 1]);
    const { c, C } = moments(pts);
    const n = eigSym3(C).vectors[0];
    const [u, v] = basis(n);
    const p2: Pt2[] = chain.map((p) => [dot(p, u), dot(p, v)]);
    const circ = fitCircle2(p2);
    if (circ) {
      let ss = 0;
      for (const p of p2) { const d = Math.hypot(p[0] - circ.cx, p[1] - circ.cy) - circ.r; ss += d * d; }
      const rms = Math.sqrt(ss / p2.length);
      if (rms <= tol) {
        const center = add(add(scale(u, circ.cx), scale(v, circ.cy)), scale(n, dot(c, n)));
        return { type: 'circle', point: center, dir: n, radius: circ.r, rms, ends: [a, b] };
      }
    }
  }
  return { type: 'polyline', point: must(chain[Math.floor(chain.length / 2)]), ends: [a, b], rms: null };
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
    else L('distance of B point from plane A', Math.abs(dot(dp, A.normal)));
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
