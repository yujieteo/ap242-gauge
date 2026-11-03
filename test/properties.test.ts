import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { UNITS, basis, cross, dot, eigSym3, extractFaces, fitCircle2, fitFace, len, measure, norm, parseStepLengthUnit, scale, add } from '../src/geom.ts';
import type { Face, Feature, Vec3 } from '../src/geom.ts';
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
