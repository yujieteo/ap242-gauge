import * as E from './emil.js';
import type { Figure, Layout, Panel, Pt, Shape, TextStyle } from './emil.js';
import { must } from '../../src/util.ts';

export const figure = { width: 68, height: 36, name: 'face-fit', format: 'journal' };

type P3 = readonly [number, number, number];
type Projector = { (x: number, y: number, z: number): Pt; readonly view: P3 };
type Facet = { readonly k: number; readonly m: number; readonly nrm: readonly [number, number, number]; readonly q: Pt[]; readonly vis: number };

export default function draw(F: Figure, L: Layout): void {
  const { line, text } = E.useEmil(F, L, 'web');
  const G = E.gray, mesh = G[1000], fillA = G[300], fillB = G[400];
  const BLUE = E.hue.blue[11], FIT = E.hue.orange[11];
  const head = (p: Panel, x: number, y: number, s: string): void => L.text(p, x, y, s, { size: text.title, weight: E.weight.title, color: G[1200] });
  const lab = (p: Panel, x: number, y: number, s: string, o: Partial<TextStyle> = {}): void => L.text(p, x, y, s, { size: text.label, color: G[1100], ...o });
  const arr = (p: Panel, a: Pt, b: Pt, color: string, w: number = line.bold): void => L.arrow(p, a, b, { stroke: color, width: w, head: 3.4, headWidth: 3 });

  const proj = (ox: number, oy: number, psiDeg: number, phiDeg: number): Projector => {
    const ps = (psiDeg * Math.PI) / 180, ph = (phiDeg * Math.PI) / 180;
    const P = (x: number, y: number, z: number): Pt => {
      const q = -x * Math.sin(ps) + y * Math.cos(ps);
      return [ox + x * Math.cos(ps) + y * Math.sin(ps), oy - z * Math.cos(ph) - q * Math.sin(ph)];
    };
    return Object.assign(P, { view: [Math.sin(ps) * Math.cos(ph), -Math.cos(ps) * Math.cos(ph), Math.sin(ph)] as const });
  };
  const dot3 = (u: P3, v: P3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const poly = (p: Panel, pts: readonly Pt[], st: Shape): void => L.polygon(p, pts, st);

  const a = F.panel('a', { x: 1, y: 1, w: 19, h: 34 });
  head(a, 12, 9, 'Plane');
  {
    const P = proj(1, 58, 24, 26);
    const J: readonly Pt[] = [[0, 0], [2, -3], [0, 2], [-3, 1], [2, 2], [3, -2], [1, 3], [-2, -1], [0, 0]];
    const V: P3[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const d = must(J[i * 3 + j]); V.push([i * 16 + d[0], j * 16 + d[1], 0]);
    }
    const id = (i: number, j: number): number => i * 3 + j;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const t1 = [id(i, j), id(i + 1, j), id(i + 1, j + 1)], t2 = [id(i, j), id(i + 1, j + 1), id(i, j + 1)];
      for (const t of [t1, t2]) poly(a, t.map((q) => P(...must(V[q]))), { fill: fillA, stroke: mesh, width: line.thin, join: 'round' });
    }
    for (const v of V) L.circle(a, ...P(...v), 1.3, { fill: G[1200] });
    const c = P(16, 16, 0), top = P(16, 16, 26);
    arr(a, c, top, FIT);
    L.circle(a, ...c, 1.6, { fill: FIT });
    lab(a, top[0] + 3, top[1] + 4, 'normal *n*', { color: FIT, weight: E.weight.name });
    lab(a, 25, 88, 'least spread\nof vertices', { anchor: 'middle', lineGap: 1.15 });
  }

  const b = F.panel('b', { x: 20.5, y: 1, w: 27, h: 34 });
  head(b, 12, 9, 'Cylinder');
  const R = 13, Lc = 30, N = 12;
  {
    const P = proj(4, 48, 42, 16);
    const th = (k: number): number => (2 * Math.PI * k) / N + Math.PI / N;
    const pt = (x: number, k: number): P3 => [x, R * Math.cos(th(k)), R * Math.sin(th(k))];
    const facets: Facet[] = [];
    for (let k = 0; k < N; k++) {
      const m = (th(k) + th(k + 1)) / 2, nrm = [0, Math.cos(m), Math.sin(m)] as const;
      const q = [pt(0, k), pt(Lc, k), pt(Lc, k + 1), pt(0, k + 1)].map((v) => P(...v));
      facets.push({ k, m, nrm, q, vis: dot3(nrm, P.view) });
    }
    const back = facets.filter((f) => f.vis <= 0), front = facets.filter((f) => f.vis > 0);
    for (const f of back) poly(b, f.q, { fill: G[200], stroke: G[800], width: line.thin, join: 'round' });
    const ax1 = P(Lc + 30, 0, 0);
    L.line(b, P(0, 0, 0), P(Lc, 0, 0), { stroke: FIT, width: line.bold, dash: '2.4 1.6' });
    front.sort((u, v) => u.vis - v.vis);
    for (const f of front) {
      poly(b, f.q, { fill: f.vis > 0.5 ? fillA : fillB, stroke: mesh, width: line.thin, join: 'round' });
      L.line(b, must(f.q[0]), must(f.q[2]), { stroke: mesh, width: line.hair });
    }
    L.line(b, P(Lc, 0, 0), ax1, { stroke: FIT, width: line.bold });
    arr(b, P(Lc + 22, 0, 0), ax1, FIT);
    lab(b, ax1[0] - 2, ax1[1] + 9, 'axis', { color: FIT, weight: E.weight.name, anchor: 'middle' });
    const ring = Array.from({ length: N }, (_, k) => P(...pt(Lc, k)));
    poly(b, ring, { fill: 'none', stroke: mesh, width: line.thin, join: 'round' });
    const rr = R * Math.cos(Math.PI / N);
    let top: Pt | null = null;
    for (const f of facets) {
      const base = P(Lc, rr * f.nrm[1], rr * f.nrm[2]), w = P(Lc, (rr + 8) * f.nrm[1], (rr + 8) * f.nrm[2]);
      arr(b, base, w, BLUE, line.normal);
      if (!top || w[1] < top[1]) top = w;
    }
    const t = must(top);
    lab(b, t[0] - 6, t[1] - 4, 'triangle normals', { color: BLUE, weight: E.weight.name, anchor: 'start' });
    lab(b, 38, 88, 'axis ⟂ all normals', { anchor: 'middle' });
  }

  const c = F.panel('c', { x: 48, y: 1, w: 19, h: 34 });
  head(c, 12, 9, 'Along axis');
  {
    const cx = 27, cy = 46, Rc = 18;
    const th = (k: number): number => (2 * Math.PI * k) / N + Math.PI / N;
    const V = Array.from({ length: N }, (_, k): Pt => [cx + Rc * Math.cos(th(k)), cy - Rc * Math.sin(th(k))]);
    poly(c, V, { fill: G[200], stroke: mesh, width: line.thin, join: 'round' });
    L.circle(c, cx, cy, Rc, { fill: 'none', stroke: FIT, width: line.bold });
    for (const v of V) L.circle(c, ...v, 1.3, { fill: G[1200] });
    const rEnd: Pt = [cx + Rc * Math.cos(Math.PI * 0.25 + Math.PI / N), cy - Rc * Math.sin(Math.PI * 0.25 + Math.PI / N)];
    L.line(c, [cx, cy], rEnd, { stroke: FIT, width: line.normal });
    L.circle(c, cx, cy, 1.6, { fill: FIT });
    lab(c, cx, cy + 10, 'axis', { color: FIT, weight: E.weight.name, anchor: 'middle' });
    lab(c, (cx + rEnd[0]) / 2 - 4, (cy + rEnd[1]) / 2 - 1, '*r*', { color: FIT, weight: E.weight.name, anchor: 'end' });
    lab(c, cx, 88, 'least squares\ncircle', { anchor: 'middle', lineGap: 1.15, color: FIT });
  }
  E.emilTheme(F);
}
