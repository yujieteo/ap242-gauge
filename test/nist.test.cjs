// Headless check: load NIST AP242 test models with occt-import-js, fit the faces that the
// NIST drawings dimension, and compare the measured values with the drawing values.
// Each face is named by a probe point on it (model coordinates in file units). The nearest
// face to the probe is used: on a curved face the mesh chords lie a little inside the surface.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Geom = require('../src/geom.js');
const occtimportjs = require('occt-import-js');

const LEN_TOL = 1e-3; // file units (mm or in): far below the tightest drawing tolerance (0.001 in)
const ANG_TOL = 0.01; // degrees

let occtPromise;
function load(file) {
  occtPromise = occtPromise || occtimportjs();
  return occtPromise.then((occt) => {
    const buf = fs.readFileSync(path.join(__dirname, 'data', file));
    const unit = Geom.parseStepLengthUnit(buf.toString('latin1'));
    const result = occt.ReadStepFile(buf, { linearUnit: unit.occt });
    assert.ok(result.success, 'occt-import-js reads ' + file);
    return { unit, faces: Geom.extractFaces(result) };
  });
}

// Distance from point p to triangle t (index into face.tri).
function distTri(p, tri, t) {
  const { sub, dot, cross, len, add, scale } = Geom.vec;
  const a = [tri[t * 9], tri[t * 9 + 1], tri[t * 9 + 2]];
  const b = [tri[t * 9 + 3], tri[t * 9 + 4], tri[t * 9 + 5]];
  const c = [tri[t * 9 + 6], tri[t * 9 + 7], tri[t * 9 + 8]];
  const n = cross(sub(b, a), sub(c, a));
  const nn = dot(n, n);
  if (nn > 0) {
    const ap = sub(p, a);
    const w = dot(cross(sub(b, a), ap), n) / nn;
    const v = dot(cross(ap, sub(c, a)), n) / nn;
    if (v >= 0 && w >= 0 && v + w <= 1) return Math.abs(dot(ap, n)) / Math.sqrt(nn);
  }
  const seg = (x, y) => {
    const d = sub(y, x), s = Math.max(0, Math.min(1, dot(sub(p, x), d) / (dot(d, d) || 1)));
    return len(sub(p, add(x, scale(d, s))));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

function faceNear(faces, probe) {
  let best = null, bestD = Infinity;
  for (const f of faces) {
    for (let t = 0; t < f.tri.length / 9; t++) {
      const d = distTri(probe, f.tri, t);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  return best;
}

const faceAt = (faces, probe) => Geom.fitFace(faceNear(faces, probe));

function value(measures, label) {
  const m = measures.find((x) => x.label === label);
  assert.ok(m, 'measurement "' + label + '" exists');
  return m.value;
}

test('STEP length unit is read from the file', async () => {
  assert.equal((await load('nist_ctc_01_asme1_ap242-e1.stp')).unit.label, 'mm');
  assert.equal((await load('nist_ctc_05_asme1_ap242-e1.stp')).unit.label, 'in');
});

test('CTC 01 (mm): diameters and 60 degree notch match the drawing', async () => {
  const { faces } = await load('nist_ctc_01_asme1_ap242-e1.stp');
  const dia = (probe) => {
    const fit = faceAt(faces, probe);
    assert.equal(fit.type, 'cylinder');
    return 2 * fit.radius;
  };
  // Drawing: boss diameter 35 0/-0.2
  assert.ok(Math.abs(dia([-342.5, -175, -75]) - 35) < LEN_TOL);
  // Drawing: hole diameter 25 +/-0.15
  assert.ok(Math.abs(dia([-172.5, -45, -25]) - 25) < LEN_TOL);
  // Drawing: side hole diameter 20 +0.05/-0.10
  assert.ok(Math.abs(dia([-30, -102.5, -15]) - 20) < LEN_TOL);
  // Drawing: notch angle 60 +/-0.5 degrees
  const a = Geom.featureFrom(faceAt(faces, [-128.764, -107.5, -25]));
  const b = Geom.featureFrom(faceAt(faces, [-91.236, -107.5, -25]));
  assert.equal(a.kind, 'plane');
  assert.equal(b.kind, 'plane');
  assert.ok(Math.abs(value(Geom.measure(a, b), 'angle between planes') - 60) < ANG_TOL);
});

test('CTC 05 (inch): bore diameter and block width match the drawing', async () => {
  const { faces } = await load('nist_ctc_05_asme1_ap242-e1.stp');
  // Drawing: datum B diameter 10.000 +/-0.001
  const bore = faceAt(faces, [-5, 0, 2.188]);
  assert.equal(bore.type, 'cylinder');
  assert.ok(Math.abs(2 * bore.radius - 10) < LEN_TOL);
  // Drawing: 5.000 +/-0.008 between two parallel side faces
  const a = Geom.featureFrom(faceAt(faces, [2.5, 0.817, 7.853]));
  const b = Geom.featureFrom(faceAt(faces, [-2.5, 0.848, 7.916]));
  const m = Geom.measure(a, b);
  assert.ok(value(m, 'angle between planes') < ANG_TOL);
  assert.ok(Math.abs(value(m, 'distance (parallel planes)') - 5) < LEN_TOL);
  // The bore axis is perpendicular to the back face (datum A side): plane-to-axis angle 90.
  const axis = Geom.featureFrom(bore);
  const back = Geom.featureFrom(faceAt(faces, [-6.5, 1, 0]));
  assert.ok(Math.abs(value(Geom.measure(back, axis), 'angle axis to plane') - 90) < ANG_TOL);
});

test('edge pick: circle edge of the bore gives its diameter', async () => {
  const { faces } = await load('nist_ctc_05_asme1_ap242-e1.stp');
  const probe = [-5, 0, 2.188];
  const face = faceNear(faces, probe);
  // Pick at the low end of the cylinder (the boundary is a circle there).
  let zMin = Infinity;
  for (let i = 2; i < face.tri.length; i += 3) zMin = Math.min(zMin, face.tri[i]);
  const edge = Geom.faceEdge(face, [-5, 0, zMin]);
  assert.ok(edge, 'an edge was found');
  assert.equal(edge.type, 'circle');
  assert.ok(Math.abs(2 * edge.radius - 10) < LEN_TOL);
});

test('edge pick: a chain that is no circle is never reported as a circle', async () => {
  const { faces } = await load('nist_ctc_05_asme1_ap242-e1.stp');
  // Side face of the block (x = 3.5): its boundary has lines and arcs.
  const probe = [3.5, -1.613, 8.125];
  assert.equal(Geom.fitFace(faceNear(faces, probe)).type, 'plane');
  const face = faceNear(faces, probe);
  for (let i = 0; i < face.tri.length; i += 3) {
    const e = Geom.faceEdge(face, [face.tri[i], face.tri[i + 1], face.tri[i + 2]]);
    if (e && e.type === 'circle') assert.ok(e.radius < 1, 'circle edge radius ' + e.radius + ' is a real arc of this face');
  }
});
