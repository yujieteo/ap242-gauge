import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { UNITS, basis, boundary, cross, dot, eigSym3, extractFaces, faceEdge, fitCircle2, fitFace, len, measure, norm, parseStepLengthUnit, scale, add } from '../src/geom.ts';
import type { EdgeFit, Face, Feature, Vec3 } from '../src/geom.ts';
import { describe, measureRows } from '../src/format.ts';
import { parseOcctResult } from '../src/occt.ts';

const coord = fc.double({ min: -100, max: 100, noNaN: true });
const vec3 = fc.tuple(coord, coord, coord);
const direction = vec3.filter((v) => len(v) > 1e-3).map((v): Vec3 => norm(v));

test('eigSym3: eigenpairs satisfy A v = l v, ascending, orthonormal', () => {
  fc.assert(fc.property(fc.tuple(coord, coord, coord, coord, coord, coord), ([a, b, c, d, e, f]) => {
    const A: [[number, number, number], [number, number, number], [number, number, number]] = [[a, b, c], [b, d, e], [c, e, f]];
    const { values, vectors } = eigSym3(A);
    expect(values[0]).toBeLessThanOrEqual(values[1] + 1e-9);
    expect(values[1]).toBeLessThanOrEqual(values[2] + 1e-9);
    const scaleOf = 1 + Math.max(Math.abs(values[0]), Math.abs(values[2]));
    for (const i of [0, 1, 2] as const) {
      const v = vectors[i];
      expect(Math.abs(len(v) - 1)).toBeLessThan(1e-9);
      const av: Vec3 = [dot(A[0], v), dot(A[1], v), dot(A[2], v)];
      const lv = scale(v, values[i]);
      expect(len([av[0] - lv[0], av[1] - lv[1], av[2] - lv[2]])).toBeLessThan(1e-8 * scaleOf);
    }
    expect(Math.abs(dot(vectors[0], vectors[1]))).toBeLessThan(1e-8);
  }));
});

test('fitCircle2: points on a circle give back its centre and radius', () => {
  fc.assert(fc.property(coord, coord, fc.double({ min: 0.5, max: 100, noNaN: true }), fc.integer({ min: 4, max: 40 }), fc.double({ min: 0, max: 6, noNaN: true }), (cx, cy, r, n, phase) => {
    const pts = Array.from({ length: n }, (_, k): [number, number] => {
      const a = phase + (2 * Math.PI * k) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
    const fit = fitCircle2(pts);
    if (!fit) throw new Error('no circle fit');
    expect(Math.abs(fit.cx - cx)).toBeLessThan(1e-6 * (1 + r));
    expect(Math.abs(fit.cy - cy)).toBeLessThan(1e-6 * (1 + r));
    expect(Math.abs(fit.r - r)).toBeLessThan(1e-6 * (1 + r));
  }));
});

function planeFace(origin: Vec3, normal: Vec3, spread: number): Face {
  const [u, v] = basis(normal);
  const at = (i: number, j: number): Vec3 => add(origin, add(scale(u, i * spread), scale(v, j * spread)));
  const grid = [[0, 0], [1, 0.2], [2, 0], [0, 1], [1.1, 1], [2, 1.3], [0, 2], [1, 2.2], [2, 2]] as const;
  const tris: number[] = [];
  const idx = (i: number, j: number): Vec3 => at(grid[j * 3 + i]?.[0] ?? 0, grid[j * 3 + i]?.[1] ?? 0);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    tris.push(...idx(i, j), ...idx(i + 1, j), ...idx(i + 1, j + 1), ...idx(i, j), ...idx(i + 1, j + 1), ...idx(i, j + 1));
  }
  return { id: 0, mesh: 0, tri: Float64Array.from(tris) };
}

test('fitFace: a flat mesh is a plane with the normal of its winding', () => {
  fc.assert(fc.property(vec3, direction, fc.double({ min: 0.5, max: 50, noNaN: true }), (origin, n, spread) => {
    const face = planeFace(origin, n, spread);
    const fit = fitFace(face);
    if (fit.type !== 'plane') throw new Error('expected a plane, got ' + fit.type);
    const [u, v] = basis(n);
    const winding = cross(u, v);
    expect(dot(fit.normal, winding)).toBeGreaterThan(1 - 1e-6);
  }));
});

function cylinderFace(axis: Vec3, radius: number, length: number, facets: number): Face {
  const [u, v] = basis(axis);
  const ring = (k: number, h: number): Vec3 => {
    const a = (2 * Math.PI * k) / facets;
    return add(add(scale(u, radius * Math.cos(a)), scale(v, radius * Math.sin(a))), scale(axis, h));
  };
  const tris: number[] = [];
  for (let k = 0; k < facets; k++) {
    tris.push(...ring(k, 0), ...ring(k + 1, 0), ...ring(k + 1, length), ...ring(k, 0), ...ring(k + 1, length), ...ring(k, length));
  }
  return { id: 0, mesh: 0, tri: Float64Array.from(tris) };
}

test('fitFace: a faceted cylinder gives its axis and radius', () => {
  fc.assert(fc.property(direction, fc.double({ min: 1, max: 50, noNaN: true }), fc.double({ min: 1, max: 100, noNaN: true }), fc.integer({ min: 8, max: 48 }), (axis, radius, length, facets) => {
    const fit = fitFace(cylinderFace(axis, radius, length, facets));
    if (fit.type !== 'cylinder') throw new Error('expected a cylinder, got ' + fit.type);
    expect(Math.abs(fit.radius - radius)).toBeLessThan(1e-6 * radius);
    expect(Math.abs(Math.abs(dot(fit.dir, axis)) - 1)).toBeLessThan(1e-9);
  }));
});

const feature: fc.Arbitrary<Feature> = fc.oneof(
  fc.record({ kind: fc.constant('plane' as const), point: vec3, normal: direction }),
  fc.record({ kind: fc.constant('axis' as const), point: vec3, dir: direction }),
  fc.record({ kind: fc.constant('point' as const), point: vec3 }),
);

test('measure: values are finite and not negative, and the swap keeps the labels of a plane pair', () => {
  fc.assert(fc.property(feature, feature, (a, b) => {
    for (const m of measure(a, b)) {
      expect(Number.isFinite(m.value)).toBe(true);
      expect(m.value).toBeGreaterThanOrEqual(0);
    }
    if (a.kind === 'plane' && b.kind === 'plane') {
      const forward = measure(a, b).map((m) => m.label);
      expect(measure(b, a).map((m) => m.label)).toEqual(forward);
    }
  }));
});

const UNIT_RECORDS = [
  ["SI_UNIT(.MILLI.,.METRE.)", UNITS.mm],
  ["SI_UNIT(.CENTI.,.METRE.)", UNITS.cm],
  ["SI_UNIT($,.METRE.)", UNITS.m],
  ["CONVERSION_BASED_UNIT('INCH',#9)", UNITS.in],
  ["CONVERSION_BASED_UNIT('FOOT',#9)", UNITS.ft],
] as const;

test('parseStepLengthUnit: reads each unit record among arbitrary other records', () => {
  fc.assert(fc.property(fc.constantFrom(...UNIT_RECORDS), fc.array(fc.string({ unit: 'binary-ascii' }).map((s) => s.replace(/;/g, ' ')), { maxLength: 5 }), ([record, unit], junk) => {
    const text = junk.join(';\n') + ';\n#7=(LENGTH_UNIT()NAMED_UNIT(*)' + record + ');\n';
    expect(parseStepLengthUnit(text)).toBe(unit);
  }));
});

test('parseStepLengthUnit: fuzz with arbitrary text never throws and gives a known unit', () => {
  fc.assert(fc.property(fc.string({ unit: 'binary' }), (text) => {
    expect(Object.values(UNITS)).toContain(parseStepLengthUnit(text));
  }), { numRuns: 2000 });
});

test('parseOcctResult: fuzz with arbitrary values fails only with our own errors', () => {
  fc.assert(fc.property(fc.anything(), (value) => {
    try {
      parseOcctResult(value);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(TypeError);
    }
  }), { numRuns: 2000 });
});

test('parseOcctResult: fuzz with mesh-shaped values never reaches a TypeError', () => {
  const arrayish = fc.oneof(fc.array(fc.oneof(fc.double(), fc.string())), fc.float32Array(), fc.constant(null), fc.string());
  const mesh = fc.record({ attributes: fc.record({ position: fc.record({ array: arrayish }) }), index: fc.record({ array: arrayish }), brep_faces: fc.oneof(fc.constant(undefined), fc.array(fc.record({ first: fc.oneof(fc.integer(), fc.string()), last: fc.integer() }))), color: fc.oneof(fc.constant(undefined), fc.array(fc.double())) }, { requiredKeys: ['attributes', 'index'] });
  fc.assert(fc.property(fc.record({ success: fc.boolean(), meshes: fc.oneof(fc.array(mesh, { maxLength: 3 }), fc.anything()) }), (value) => {
    try {
      parseOcctResult(value);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(TypeError);
    }
  }), { numRuns: 1000 });
});

test('extractFaces: one face per group with nine numbers per triangle', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 4 }), (triangles, groupCount) => {
    const position = Array.from({ length: 9 * triangles }, (_, i) => i * 0.5);
    const index = Array.from({ length: 3 * triangles }, (_, i) => i);
    const size = Math.max(1, Math.floor(triangles / groupCount));
    const brepFaces = Array.from({ length: groupCount }, (_, g) => ({ first: Math.min(g * size, triangles - 1), last: Math.min(g * size + size - 1, triangles - 1) }));
    const faces = extractFaces([{ position, index, brepFaces }]);
    expect(faces.length).toBe(groupCount);
    faces.forEach((f, g) => {
      const group = brepFaces[g];
      expect(f.tri.length).toBe(9 * ((group?.last ?? 0) - (group?.first ?? 0) + 1));
      expect(f.id).toBe(g);
    });
  }));
});

function outlineFace(outline: readonly Vec3[], hub: Vec3): Face {
  const tris: number[] = [];
  outline.forEach((p, i) => { tris.push(...p, ...(outline[(i + 1) % outline.length] ?? p), ...hub); });
  return { id: 0, mesh: 0, tri: Float64Array.from(tris) };
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, chords: number): Vec3[] {
  return Array.from({ length: chords + 1 }, (_, k): Vec3 => {
    const a = (fromDeg + ((toDeg - fromDeg) * k) / chords) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), 3];
  });
}

function edgeAtChord(face: Face, outline: readonly Vec3[], i: number): EdgeFit {
  const a = outline[i], b = outline[(i + 1) % outline.length];
  if (!a || !b) throw new Error('no chord ' + i);
  const edge = faceEdge(face, scale(add(a, b), 0.5));
  if (!edge) throw new Error('no edge at chord ' + i);
  return edge;
}

test('faceEdge: a slot gives its arcs as circles and its sides as lines', () => {
  fc.assert(fc.property(fc.double({ min: 0.2, max: 40, noNaN: true }), fc.double({ min: 0.5, max: 200, noNaN: true }), fc.integer({ min: 5, max: 24 }), (r, half, chords) => {
    const outline = [...arc(half, 0, r, -90, 90, chords), ...arc(-half, 0, r, 90, 270, chords)];
    const face = outlineFace(outline, [0, 0, 3]);
    outline.forEach((_, i) => {
      const edge = edgeAtChord(face, outline, i);
      if (i === chords || i === 2 * chords + 1) {
        if (edge.type !== 'line') throw new Error('side ' + i + ' is ' + edge.type);
        expect(Math.abs(edge.length - 2 * half)).toBeLessThan(1e-9 * (1 + half));
      } else {
        if (edge.type !== 'circle') throw new Error('arc chord ' + i + ' is ' + edge.type);
        expect(Math.abs(edge.radius - r)).toBeLessThan(1e-6 * r);
      }
    });
  }));
});

test('faceEdge: a small arc beside a long straight edge keeps its own radius', () => {
  const outline: Vec3[] = [[-5.834, 0, 3], ...arc(0, 0.25, 0.25, -90, -90 + 12.51, 3), [-5.834, 4, 3]];
  const face = outlineFace(outline, [-3, 1, 3]);
  expect(edgeAtChord(face, outline, 0).type).toBe('line');
  for (const i of [1, 2, 3]) {
    const edge = edgeAtChord(face, outline, i);
    if (edge.type !== 'circle') throw new Error('arc chord ' + i + ' is ' + edge.type);
    expect(Math.abs(edge.radius - 0.25)).toBeLessThan(1e-9);
  }
});

test('faceEdge: a chord of an ellipse is a curved edge, never a line or a circle', () => {
  const outline = Array.from({ length: 48 }, (_, k): Vec3 => [30 * Math.cos((k * Math.PI) / 24), 10 * Math.sin((k * Math.PI) / 24), 3]);
  const face = outlineFace(outline, [0, 0, 3]);
  outline.forEach((_, i) => { expect(edgeAtChord(face, outline, i).type).toBe('polyline'); });
});

test('faceEdge: two straight edges at a shallow angle are lines, not a circle', () => {
  const outline: Vec3[] = [[0, 0, 3], [40, 0, 3], [70, 12, 3], [30, 60, 3]];
  const face = outlineFace(outline, [35, 15, 3]);
  const first = edgeAtChord(face, outline, 0), second = edgeAtChord(face, outline, 1);
  if (first.type !== 'line' || second.type !== 'line') throw new Error('got ' + first.type + ' and ' + second.type);
  expect(Math.abs(first.length - 40)).toBeLessThan(1e-9);
  expect(Math.abs(second.length - Math.hypot(30, 12))).toBeLessThan(1e-9);
});

test('boundary: a triangle fan has its outline as boundary, each segment once', () => {
  fc.assert(fc.property(fc.integer({ min: 3, max: 60 }), (n) => {
    const outline = arc(0, 0, 10, 0, 360 - 360 / n, n - 1);
    const { first, segs } = boundary(outlineFace(outline, [0, 0, 3]).tri);
    expect(first.length).toBe(n + 1);
    expect(segs.length).toBe(2 * n);
  }));
});

const STEP_INCH_AFTER_ITS_BASE = `DATA;
#10=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#11=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#10);
#12=(CONVERSION_BASED_UNIT('INCH',#11)LENGTH_UNIT()NAMED_UNIT(#13));
#20=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#21))
GLOBAL_UNIT_ASSIGNED_CONTEXT((#12,#14,#15))REPRESENTATION_CONTEXT('',''));
ENDSEC;`;

test('parseStepLengthUnit: the unit of the geometric context wins over the base unit of a conversion', () => {
  expect(parseStepLengthUnit(STEP_INCH_AFTER_ITS_BASE)).toBe(UNITS.in);
  expect(parseStepLengthUnit(STEP_INCH_AFTER_ITS_BASE.replace('((#12,#14,#15))', '( ( #14 , #10 ) )'))).toBe(UNITS.mm);
  expect(parseStepLengthUnit('#1=( LENGTH_UNIT ( ) NAMED_UNIT(*) SI_UNIT($,.METRE.) );')).toBe(UNITS.m);
  expect(parseStepLengthUnit('no units here')).toBe(UNITS.mm);
});

test('measure: an axis picked first and a plane second is not labelled as plane A', () => {
  const plane: Feature = { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] };
  const axis: Feature = { kind: 'axis', point: [1, 2, 5], dir: norm([1, 0, 1]) };
  expect(measure(axis, plane)).toEqual(measure(plane, axis));
  for (const m of measure(axis, plane)) expect(m.label).not.toMatch(/\b[AB]\b/);
});

test('panel text: a file in metres keeps a tenth of a micrometre', () => {
  const fit = { type: 'cylinder', point: [0, 0, 0], dir: [0, 0, 1], radius: 0.003175, rms: 0, size: 0.01 } as const;
  expect(describe(0, fit, UNITS.m)[1]).toBe('diameter 0.0063500 m, radius 0.0031750 m');
  const pick = { face: 0, mode: 'face', fit, feature: { kind: 'axis', point: fit.point, dir: fit.dir }, hit: [0.00125, 0, 0] } as const;
  expect(measureRows([pick], UNITS.m)[0]).toEqual(['diameter', '0.0063500 m']);
});
