import { expect, test } from 'bun:test';
import { faceNear, load, MODEL_INCH, MODEL_MM } from './models.ts';
import { faceEdge, featureFrom, fitFace, measure } from './subject.ts';
import type { Face, Feature, Measurement, Vec3 } from '../src/geom.ts';

const LEN_TOL = 1e-3;
const ANG_TOL = 0.01;

const faceAt = (faces: readonly Face[], probe: Vec3) => fitFace(faceNear(faces, probe));

function value(measures: readonly Measurement[], label: string): number {
  const m = measures.find((x) => x.label === label);
  if (!m) throw new Error('measurement "' + label + '" is missing');
  return m.value;
}

function expectPlane(feature: Feature): void {
  expect(feature.kind).toBe('plane');
}

test('STEP length unit is read from the file', async () => {
  expect((await load(MODEL_MM)).unit.label).toBe('mm');
  expect((await load(MODEL_INCH)).unit.label).toBe('in');
});

test('CTC 01 (mm): diameters and 60 degree notch match the drawing', async () => {
  const { faces } = await load(MODEL_MM);
  const dia = (probe: Vec3): number => {
    const fit = faceAt(faces, probe);
    if (fit.type !== 'cylinder') throw new Error('expected a cylinder at ' + probe.join(','));
    return 2 * fit.radius;
  };
  expect(Math.abs(dia([-342.5, -175, -75]) - 35)).toBeLessThan(LEN_TOL);
  expect(Math.abs(dia([-172.5, -45, -25]) - 25)).toBeLessThan(LEN_TOL);
  expect(Math.abs(dia([-30, -102.5, -15]) - 20)).toBeLessThan(LEN_TOL);
  const a = featureFrom(faceAt(faces, [-128.764, -107.5, -25]));
  const b = featureFrom(faceAt(faces, [-91.236, -107.5, -25]));
  expectPlane(a);
  expectPlane(b);
  expect(Math.abs(value(measure(a, b), 'angle between planes') - 60)).toBeLessThan(ANG_TOL);
});

test('CTC 05 (inch): bore diameter and block width match the drawing', async () => {
  const { faces } = await load(MODEL_INCH);
  const bore = faceAt(faces, [-5, 0, 2.188]);
  if (bore.type !== 'cylinder') throw new Error('expected a cylinder bore');
  expect(Math.abs(2 * bore.radius - 10)).toBeLessThan(LEN_TOL);
  const a = featureFrom(faceAt(faces, [2.5, 0.817, 7.853]));
  const b = featureFrom(faceAt(faces, [-2.5, 0.848, 7.916]));
  const m = measure(a, b);
  expect(value(m, 'angle between planes')).toBeLessThan(ANG_TOL);
  expect(Math.abs(value(m, 'distance (parallel planes)') - 5)).toBeLessThan(LEN_TOL);
  const axis = featureFrom(bore);
  const back = featureFrom(faceAt(faces, [-6.5, 1, 0]));
  expect(Math.abs(value(measure(back, axis), 'angle axis to plane') - 90)).toBeLessThan(ANG_TOL);
});

test('edge pick: circle edge of the bore gives its diameter', async () => {
  const { faces } = await load(MODEL_INCH);
  const face = faceNear(faces, [-5, 0, 2.188]);
  let zMin = Infinity;
  for (let i = 2; i < face.tri.length; i += 3) zMin = Math.min(zMin, face.tri[i] ?? Infinity);
  const edge = faceEdge(face, [-5, 0, zMin]);
  if (!edge || edge.type !== 'circle') throw new Error('expected a circle edge');
  expect(Math.abs(2 * edge.radius - 10)).toBeLessThan(LEN_TOL);
});

test('edge pick: a chain that is no circle is never reported as a circle', async () => {
  const { faces } = await load(MODEL_INCH);
  const probe: Vec3 = [3.5, -1.613, 8.125];
  expect(fitFace(faceNear(faces, probe)).type).toBe('plane');
  const face = faceNear(faces, probe);
  for (let i = 0; i < face.tri.length; i += 3) {
    const e = faceEdge(face, [face.tri[i] ?? 0, face.tri[i + 1] ?? 0, face.tri[i + 2] ?? 0]);
    if (e && e.type === 'circle') expect(e.radius).toBeLessThan(1);
  }
});
