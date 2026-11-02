// Geometry for ap242-gauge: STEP unit, face extraction, feature fits and measurements.
// The browser loads this file as a plain script (global "Geom"); Node loads it with require().
(function (root) {
  'use strict';

  // ---------- small vector helpers ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => { const l = len(a); return l > 0 ? scale(a, 1 / l) : [0, 0, 0]; };
  const DEG = 180 / Math.PI;

  // ---------- STEP length unit ----------
  // Finds the LENGTH_UNIT instance in the DATA section and returns the unit name.
  // occt is the linearUnit value for occt-import-js, so that coordinates stay in file units.
  const UNITS = {
    mm: { label: 'mm', occt: 'millimeter' },
    cm: { label: 'cm', occt: 'centimeter' },
    m: { label: 'm', occt: 'meter' },
    in: { label: 'in', occt: 'inch' },
    ft: { label: 'ft', occt: 'foot' },
  };
  function parseStepLengthUnit(text) {
    const flat = text.replace(/\s+/g, ' ');
    const records = flat.split(';');
    const byId = new Map();
    for (const r of records) {
      const m = /^\s*#(\d+)\s*=\s*(.*)$/.exec(r);
      if (m) byId.set(m[1], m[2]);
    }
    for (const body of byId.values()) {
      if (!/LENGTH_UNIT\s*\(\s*\)/i.test(body)) continue;
      const conv = /CONVERSION_BASED_UNIT\s*\(\s*'([^']*)'/i.exec(body);
      if (conv) {
        const n = conv[1].toLowerCase();
        if (n.startsWith('inch')) return UNITS.in;
        if (n.startsWith('foot') || n === 'feet') return UNITS.ft;
        if (n.startsWith('milli')) return UNITS.mm;
        if (n.startsWith('centi')) return UNITS.cm;
        if (n.startsWith('metre') || n.startsWith('meter')) return UNITS.m;
        continue;
      }
      const si = /SI_UNIT\s*\(\s*([^,]*),\s*\.METRE\.\s*\)/i.exec(body);
      if (si) {
        const p = si[1].trim().toUpperCase();
        if (p === '.MILLI.') return UNITS.mm;
        if (p === '.CENTI.') return UNITS.cm;
        if (p === '$') return UNITS.m;
      }
    }
    return UNITS.mm; // STEP files without a readable unit: occt-import-js default
  }

  // ---------- faces from the occt-import-js result ----------
  // Each B-rep face becomes { id, mesh, tri: Float64Array (9 numbers per triangle) }.
  function extractFaces(result) {
    const faces = [];
    result.meshes.forEach((mesh, mi) => {
      const pos = mesh.attributes.position.array;
      const idx = mesh.index.array;
      const groups = mesh.brep_faces && mesh.brep_faces.length
        ? mesh.brep_faces
        : [{ first: 0, last: idx.length / 3 - 1 }];
      for (const g of groups) {
        const n = g.last - g.first + 1;
        const tri = new Float64Array(n * 9);
        for (let t = 0; t < n; t++) {
          for (let k = 0; k < 3; k++) {
            const v = idx[(g.first + t) * 3 + k];
            tri[t * 9 + k * 3] = pos[v * 3];
            tri[t * 9 + k * 3 + 1] = pos[v * 3 + 1];
            tri[t * 9 + k * 3 + 2] = pos[v * 3 + 2];
          }
        }
        faces.push({ id: faces.length, mesh: mi, tri });
      }
    });
    return faces;
  }

  // ---------- symmetric 3x3 eigen decomposition (Jacobi) ----------
  // Returns { values: [l0,l1,l2] ascending, vectors: [v0,v1,v2] }.
  function eigSym3(A) {
    const a = [A[0].slice(), A[1].slice(), A[2].slice()];
    const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-30) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
        }
      }
    }
    const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
    return {
      values: order.map((i) => a[i][i]),
      vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]),
    };
  }

  // Weighted points (x, y, z, w) -> centroid and covariance.
  function moments(pts) {
    let W = 0; const c = [0, 0, 0];
    for (const p of pts) { W += p[3]; c[0] += p[0] * p[3]; c[1] += p[1] * p[3]; c[2] += p[2] * p[3]; }
    c[0] /= W; c[1] /= W; c[2] /= W;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of pts) {
      const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += p[3] * d[i] * d[j];
    }
    return { W, c, C };
  }

  // Two unit vectors perpendicular to d.
  function basis(d) {
    const t = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(d, t));
    return [u, cross(d, u)];
  }

  // Least squares circle (Kasa) of 2D points [x, y]; returns { cx, cy, r }.
  function fitCircle2(p2) {
    // Shift to the mean for numerical stability.
    let mx = 0, my = 0;
    for (const p of p2) { mx += p[0]; my += p[1]; }
    mx /= p2.length; my /= p2.length;
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const p of p2) {
      const x = p[0] - mx, y = p[1] - my, z = x * x + y * y;
      const row = [x, y, 1];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += row[i] * row[j]; b[i] -= row[i] * z; }
    }
    const s = solve3(M, b);
    if (!s) return null;
    const cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
    if (!(r2 > 0)) return null;
    return { cx: cx + mx, cy: cy + my, r: Math.sqrt(r2) };
  }

  function solve3(M, b) {
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M);
    if (Math.abs(D) < 1e-300) return null;
    const out = [];
    for (let k = 0; k < 3; k++) {
      const m = M.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)));
      out.push(det(m) / D);
    }
    return out;
  }

  // ---------- face fit ----------
  // Fits one face to a plane, else a cylinder. The rms residual is in model units.
  // A face that fits neither (cone, torus, free form) gives type "surface".
  function fitFace(face) {
    const tri = face.tri, nt = tri.length / 9;
    const pts = [];
    const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < nt; t++) {
      const a = [tri[t * 9], tri[t * 9 + 1], tri[t * 9 + 2]];
      const b = [tri[t * 9 + 3], tri[t * 9 + 4], tri[t * 9 + 5]];
      const c = [tri[t * 9 + 6], tri[t * 9 + 7], tri[t * 9 + 8]];
      const nrm = cross(sub(b, a), sub(c, a));
      const area = len(nrm) / 2;
      if (!(area > 0)) continue;
      const n = scale(nrm, 0.5 / area);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) N[i][j] += area * n[i] * n[j];
      for (const p of [a, b, c]) {
        pts.push([p[0], p[1], p[2], area / 3]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
    }
    if (!pts.length) return { type: 'surface', point: [tri[0], tri[1], tri[2]], rms: null, size: 0 };
    const size = len(sub(hi, lo));
    const tol = Math.max(1e-4 * size, 1e-7);
    const { W, c, C } = moments(pts);

    // Plane: normal is the direction of least spread of the points.
    const e = eigSym3(C);
    const pn = e.vectors[0];
    const planeRms = Math.sqrt(Math.max(e.values[0], 0) / W);
    if (planeRms <= tol) {
      // Orient the normal like the triangle normals (outward from the solid).
      let s = 0;
      for (let t = 0; t < nt; t++) {
        const a = [tri[t * 9], tri[t * 9 + 1], tri[t * 9 + 2]];
        const nrm = cross(sub([tri[t * 9 + 3], tri[t * 9 + 4], tri[t * 9 + 5]], a), sub([tri[t * 9 + 6], tri[t * 9 + 7], tri[t * 9 + 8]], a));
        s += dot(nrm, pn);
      }
      return { type: 'plane', point: c, normal: s < 0 ? scale(pn, -1) : pn, rms: planeRms, size };
    }

    // Cylinder: all surface normals are perpendicular to the axis.
    const axis = eigSym3(N).vectors[0];
    const [u, v] = basis(axis);
    const p2 = pts.map((p) => [dot(p, u), dot(p, v)]);
    const circ = fitCircle2(p2);
    if (circ) {
      let ss = 0;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(p2[i][0] - circ.cx, p2[i][1] - circ.cy) - circ.r;
        ss += pts[i][3] * d * d;
      }
      const cylRms = Math.sqrt(ss / W);
      if (cylRms <= tol) {
        const onAxis = add(add(scale(u, circ.cx), scale(v, circ.cy)), scale(axis, dot(c, axis)));
        return { type: 'cylinder', point: onAxis, dir: axis, radius: circ.r, rms: cylRms, size };
      }
    }
    return { type: 'surface', point: c, rms: null, size };
  }

  // ---------- edge from the boundary of a face ----------
  // Takes the face boundary segment nearest to hit, grows it along the boundary while the
  // turn at each vertex stays below maxTurnDeg, and fits a line or a circle to the chain.
  // A chain that fits no line or circle (for example a line that joins an arc tangentially)
  // is walked again with straight segments only.
  function faceEdge(face, hit) {
    const e = faceEdgeChain(face, hit, 40);
    if (!e || e.type !== 'polyline') return e;
    const straight = faceEdgeChain(face, hit, 0.5);
    return straight && straight.type === 'line' ? straight : e;
  }

  function faceEdgeChain(face, hit, maxTurnDeg) {
    const tri = face.tri, nt = tri.length / 9;
    const q = (i) => [tri[i * 3], tri[i * 3 + 1], tri[i * 3 + 2]];
    const keyOf = (p) => p.map((x) => Math.round(x * 1e6)).join(',');
    const vid = new Map(), verts = [];
    const id = (p) => { const k = keyOf(p); if (!vid.has(k)) { vid.set(k, verts.length); verts.push(p); } return vid.get(k); };
    const count = new Map();
    for (let t = 0; t < nt; t++) {
      const ids = [id(q(t * 3)), id(q(t * 3 + 1)), id(q(t * 3 + 2))];
      for (let k = 0; k < 3; k++) {
        const a = ids[k], b = ids[(k + 1) % 3];
        if (a === b) continue;
        const ek = a < b ? a + '_' + b : b + '_' + a;
        count.set(ek, (count.get(ek) || 0) + 1);
      }
    }
    const adj = new Map();
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    let best = null, bestD = Infinity;
    for (const [ek, n] of count) {
      if (n !== 1) continue;
      const [a, b] = ek.split('_').map(Number);
      link(a, b); link(b, a);
      const d = distPointSegment(hit, verts[a], verts[b]);
      if (d < bestD) { bestD = d; best = [a, b]; }
    }
    if (!best) return null;
    const cosMax = Math.cos(maxTurnDeg / DEG);
    // Walk from 'to' away from 'from' while the turn is small.
    const walk = (from, to, seen) => {
      const out = [];
      let prev = from, cur = to;
      for (;;) {
        const dirIn = norm(sub(verts[cur], verts[prev]));
        const next = (adj.get(cur) || []).filter((n) => n !== prev && !seen.has(n));
        if (next.length !== 1) break;
        const dirOut = norm(sub(verts[next[0]], verts[cur]));
        if (dot(dirIn, dirOut) < cosMax) break;
        seen.add(next[0]); out.push(next[0]);
        prev = cur; cur = next[0];
      }
      return out;
    };
    const seen = new Set(best);
    const fwd = walk(best[0], best[1], seen);
    const back = walk(best[1], best[0], seen);
    const chain = [...back.reverse(), best[0], best[1], ...fwd].map((i) => verts[i]);
    const closed = chain.length > 3 && (adj.get(vid.get(keyOf(chain[0]))) || []).includes(vid.get(keyOf(chain[chain.length - 1])));
    return fitEdgeChain(chain, closed);
  }

  function distPointSegment(p, a, b) {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    return len(sub(p, add(a, scale(ab, t))));
  }

  function fitEdgeChain(chain, closed) {
    const a = chain[0], b = chain[chain.length - 1];
    const L = len(sub(b, a));
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of chain) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    const size = len(sub(hi, lo));
    const tol = Math.max(1e-4 * size, 1e-7);
    if (!closed && L > 0) {
      const d = scale(sub(b, a), 1 / L);
      let worst = 0;
      for (const p of chain) worst = Math.max(worst, len(cross(sub(p, a), d)));
      if (worst <= tol) return { type: 'line', point: scale(add(a, b), 0.5), dir: d, length: L, ends: [a, b], rms: worst };
    }
    if (chain.length >= 3) {
      const pts = chain.map((p) => [p[0], p[1], p[2], 1]);
      const { c, C } = moments(pts);
      const n = eigSym3(C).vectors[0];
      const [u, v] = basis(n);
      const p2 = chain.map((p) => [dot(p, u), dot(p, v)]);
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
    return { type: 'polyline', point: chain[Math.floor(chain.length / 2)], ends: [a, b], rms: null };
  }

  // ---------- measurements ----------
  // A feature is one of:
  //   { kind: 'plane', point, normal }
  //   { kind: 'axis', point, dir, radius? }   (cylinder axis, line edge, circle edge)
  //   { kind: 'point', point }
  // featureFrom maps a face fit or an edge fit to a feature.
  function featureFrom(fit) {
    switch (fit.type) {
      case 'plane': return { kind: 'plane', point: fit.point, normal: fit.normal };
      case 'cylinder': return { kind: 'axis', point: fit.point, dir: fit.dir, radius: fit.radius };
      case 'circle': return { kind: 'axis', point: fit.point, dir: fit.dir, radius: fit.radius, center: true };
      case 'line': return { kind: 'axis', point: fit.point, dir: fit.dir };
      default: return { kind: 'point', point: fit.point };
    }
  }

  const PARALLEL_DEG = 0.01;

  // Angle between two directions as lines, 0..90 degrees.
  const lineAngle = (d1, d2) => Math.acos(Math.min(1, Math.abs(dot(norm(d1), norm(d2))))) * DEG;

  // Returns [{ label, value, type: 'length' | 'angle' }].
  function measure(A, B) {
    const out = [];
    const L = (label, value) => out.push({ label, value, type: 'length' });
    const G = (label, value) => out.push({ label, value, type: 'angle' });
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

  const api = {
    UNITS, parseStepLengthUnit, extractFaces, fitFace, faceEdge, featureFrom, measure,
    vec: { sub, add, scale, dot, cross, len, norm },
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Geom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
