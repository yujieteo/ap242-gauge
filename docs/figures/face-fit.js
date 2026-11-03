// ap242-gauge README figure: how one face is fitted to a plane or a cylinder.
// Drawn with the schematic-emil style on the schematic-figure engine (venue web).
// Rebuild: copy style.js of schematic-emil to emil.js and its fonts/ next to this file, then
//   node <schematic-figure>/foundation/tools/render.mjs --root . --fig docs/figures/face-fit.js
// from the repository root, and copy docs/figures/out/face-fit.svg to docs/figures/face-fit.svg.
// Every label comes from README.md ("How it measures") and src/geom.js (fitFace).
// Hero: none, a geometric diagram of mesh fits: flat vector 3D (orthographic projection), diagrammatic marks only.
import * as E from './emil.js';

export const figure = { width: 76, height: 36, name: 'face-fit', format: 'journal' };

export default function draw(F, L) {
  const { r, line, text } = E.useEmil(F, L, 'web');
  const G = E.gray, mesh = G[1000], fillA = G[300], fillB = G[400];
  const BLUE = E.hue.blue[11], FIT = E.hue.orange[11];
  const head = (p, x, y, s) => L.text(p, x, y, s, { size: text.title, weight: E.weight.title, color: G[1200] });
  const lab = (p, x, y, s, o = {}) => L.text(p, x, y, s, { size: text.label, color: G[1100], ...o });
  const arr = (p, a, b, color, w = line.bold) => L.arrow(p, a, b, { stroke: color, width: w, head: 3.4, headWidth: 3 });

  // Orthographic view: yaw psi about z, then the camera looks down by phi (degrees). P.view points toward the viewer.
  const proj = (ox, oy, psiDeg, phiDeg) => {
    const ps = (psiDeg * Math.PI) / 180, ph = (phiDeg * Math.PI) / 180;
    const P = (x, y, z) => {
      const q = -x * Math.sin(ps) + y * Math.cos(ps);
      return [ox + x * Math.cos(ps) + y * Math.sin(ps), oy - z * Math.cos(ph) - q * Math.sin(ph)];
    };
    P.view = [Math.sin(ps) * Math.cos(ph), -Math.cos(ps) * Math.cos(ph), Math.sin(ph)];
    return P;
  };
  const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const poly = (p, pts, st) => L.polygon(p, pts, st);

  // ---- a: plane -------------------------------------------------------------------------------------
  const a = F.panel('a', { x: 1, y: 1, w: 21, h: 34 });
  head(a, 12, 9, 'Plane');
  {
    const P = proj(1, 58, 24, 26);
    // 3 x 3 vertex grid with fixed offsets, on the plane z = 0
    const J = [[0, 0], [2, -3], [0, 2], [-3, 1], [2, 2], [3, -2], [1, 3], [-2, -1], [0, 0]];
    const V = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const d = J[i * 3 + j]; V.push([i * 18 + d[0], j * 18 + d[1], 0]);
    }
    const id = (i, j) => i * 3 + j;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const t1 = [id(i, j), id(i + 1, j), id(i + 1, j + 1)], t2 = [id(i, j), id(i + 1, j + 1), id(i, j + 1)];
      for (const t of [t1, t2]) poly(a, t.map((q) => P(...V[q])), { fill: fillA, stroke: mesh, width: line.thin, join: 'round' });
    }
    for (const v of V) L.circle(a, ...P(...v), 1.3, { fill: G[1200] });
    const c = P(18, 18, 0), top = P(18, 18, 28);
    arr(a, c, top, FIT);
    L.circle(a, ...c, 1.6, { fill: FIT });
    lab(a, top[0] + 3, top[1] + 4, 'normal *n*', { color: FIT, weight: E.weight.name });
    lab(a, 28, 88, 'least spread\nof vertices', { anchor: 'middle', lineGap: 1.15 });
  }

  // ---- b: cylinder ----------------------------------------------------------------------------------
  const b = F.panel('b', { x: 23, y: 1, w: 31, h: 34 });
  head(b, 12, 9, 'Cylinder');
  const R = 14, Lc = 36, N = 12;
  {
    const P = proj(6, 48, 42, 16);
    const th = (k) => (2 * Math.PI * k) / N + Math.PI / N;
    const pt = (x, k) => [x, R * Math.cos(th(k)), R * Math.sin(th(k))];
    const facets = [];
    for (let k = 0; k < N; k++) {
      const m = (th(k) + th(k + 1)) / 2, nrm = [0, Math.cos(m), Math.sin(m)];
      const q = [pt(0, k), pt(Lc, k), pt(Lc, k + 1), pt(0, k + 1)].map((v) => P(...v));
      facets.push({ k, m, nrm, q, vis: dot3(nrm, P.view) });
    }
    // inside of the far wall first (seen through the open near end), then the near wall
    const back = facets.filter((f) => f.vis <= 0), front = facets.filter((f) => f.vis > 0);
    for (const f of back) poly(b, f.q, { fill: G[200], stroke: G[800], width: line.thin, join: 'round' });
    const ax1 = P(Lc + 34, 0, 0);
    L.line(b, P(0, 0, 0), P(Lc, 0, 0), { stroke: FIT, width: line.bold, dash: '2.4 1.6' });
    front.sort((u, v) => u.vis - v.vis);
    for (const f of front) {
      poly(b, f.q, { fill: f.vis > 0.5 ? fillA : fillB, stroke: mesh, width: line.thin, join: 'round' });
      L.line(b, f.q[0], f.q[2], { stroke: mesh, width: line.hair });   // the diagonal: two triangles per facet
    }
    L.line(b, P(Lc, 0, 0), ax1, { stroke: FIT, width: line.bold });
    arr(b, P(Lc + 25, 0, 0), ax1, FIT);
    lab(b, ax1[0] - 2, ax1[1] + 9, 'axis', { color: FIT, weight: E.weight.name, anchor: 'middle' });
    // the open near end, then one triangle normal per facet at that end: all of them lie across the axis
    const ring = Array.from({ length: N }, (_, k) => P(...pt(Lc, k)));
    poly(b, ring, { fill: 'none', stroke: mesh, width: line.thin, join: 'round' });
    const rr = R * Math.cos(Math.PI / N);
    let top = null;
    for (const f of facets) {
      const base = P(Lc, rr * f.nrm[1], rr * f.nrm[2]), w = P(Lc, (rr + 8) * f.nrm[1], (rr + 8) * f.nrm[2]);
      arr(b, base, w, BLUE, line.normal);
      if (!top || w[1] < top[1]) top = w;
    }
    lab(b, top[0] - 6, top[1] - 4, 'triangle normals', { color: BLUE, weight: E.weight.name, anchor: 'start' });
    lab(b, 44, 88, 'axis ⟂ all normals', { anchor: 'middle' });
  }

  // ---- c: along the axis ----------------------------------------------------------------------------
  const c = F.panel('c', { x: 55, y: 1, w: 20, h: 34 });
  head(c, 12, 9, 'Along axis');
  {
    const cx = 28, cy = 46, Rc = 19;
    const th = (k) => (2 * Math.PI * k) / N + Math.PI / N;
    const V = Array.from({ length: N }, (_, k) => [cx + Rc * Math.cos(th(k)), cy - Rc * Math.sin(th(k))]);
    poly(c, V, { fill: G[200], stroke: mesh, width: line.thin, join: 'round' });
    L.circle(c, cx, cy, Rc, { fill: 'none', stroke: FIT, width: line.bold });
    for (const v of V) L.circle(c, ...v, 1.3, { fill: G[1200] });
    const rEnd = [cx + Rc * Math.cos(Math.PI * 0.25 + Math.PI / N), cy - Rc * Math.sin(Math.PI * 0.25 + Math.PI / N)];
    L.line(c, [cx, cy], rEnd, { stroke: FIT, width: line.normal });
    L.circle(c, cx, cy, 1.6, { fill: FIT });
    lab(c, cx + 3, cy + 9, 'axis', { color: FIT, weight: E.weight.name });
    lab(c, (cx + rEnd[0]) / 2 - 4, (cy + rEnd[1]) / 2 - 1, '*r*', { color: FIT, weight: E.weight.name, anchor: 'end' });
    lab(c, cx, 88, 'least squares\ncircle', { anchor: 'middle', lineGap: 1.15, color: FIT });
  }
  E.emilTheme(F);
}
