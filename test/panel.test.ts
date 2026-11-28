import { expect, test } from 'bun:test';
import { describe, measureRows } from '../src/format.ts';
import type { Pick } from '../src/picks.ts';
import type { Face } from '../src/geom.ts';
import { faceEdge, featureFrom, fitFace, vertexAt } from '../src/geom.ts';
import { load, MODEL_INCH, MODEL_MM } from './models.ts';

function pickOf(face: Face, mode: 'face' | 'edge'): Pick {
  const hit = vertexAt(face.tri, 0);
  const fit = mode === 'face' ? fitFace(face) : faceEdge(face, hit);
  if (!fit) throw new Error('expected fit for face ' + face.id + ' (' + mode + ')');
  return { face: face.id, mode, fit, feature: featureFrom(fit), hit };
}

test('panel text formats cylinders, planes, edges, and pair measurements (mm)', async () => {
  const { unit, faces } = await load(MODEL_MM);
  expect(unit.label).toBe('mm');

  const cyl = pickOf(faces[0]!, 'face');
  const cylDesc = describe(cyl.face, cyl.fit, unit, [0, 0, 0]).join(' | ');
  expect(cylDesc).toContain('Cylinder (face 0');
  expect(cylDesc).toContain('diameter 25.0000 mm');
  expect(cylDesc).toContain('radius 12.5000 mm');
  expect(measureRows([cyl], unit)).toEqual([
    ['diameter', '25.0000 mm'],
    ['radius', '12.5000 mm'],
  ]);

  const circleEdge = pickOf(faces[0]!, 'edge');
  expect(describe(circleEdge.face, circleEdge.fit, unit, [0, 0, 0]).join(' | ')).toContain('Circle edge (face 0');

  const lineEdge = pickOf(faces[1]!, 'edge');
  const lineDesc = describe(lineEdge.face, lineEdge.fit, unit, [0, 0, 0]).join(' | ');
  expect(lineDesc).toContain('Line edge (face 1)');
  expect(lineDesc).toContain('length 50.0000 mm');

  const plane = pickOf(faces[2]!, 'face');
  expect(describe(plane.face, plane.fit, unit, [0, 0, 0]).join(' | ')).toContain('Plane (face 2');

  const pairRows = measureRows([cyl, plane], unit);
  const labels = pairRows.map(([label]) => label);
  expect(labels).toContain('angle axis to plane');
  expect(labels).toContain('point to point (pick points)');
  expect(labels).toContain('dx, dy, dz');

  const otherFace = faces.find((f) => featureFrom(fitFace(f)).kind === 'point');
  if (otherFace) {
    const other = pickOf(otherFace, 'face');
    expect(describe(other.face, other.fit, unit, [0, 0, 0]).join(' | ')).toContain('face ' + otherFace.id);
  }
});

test('panel text formats inch model units', async () => {
  const { unit, faces } = await load(MODEL_INCH);
  expect(unit.label).toBe('in');

  const first = pickOf(faces[0]!, 'face');
  const desc = describe(first.face, first.fit, unit, [0, 0, 0]).join(' | ');
  expect(desc).toContain('in)');
});
