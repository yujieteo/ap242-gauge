import type { BrepGroup, LinearUnitName, MeshGeometry } from './geom.ts';
import type { Vec3 } from './geom.ts';

type OcctMesh = MeshGeometry & { readonly color: Vec3 | null };
export type OcctResult =
  | { readonly success: false }
  | { readonly success: true; readonly meshes: readonly OcctMesh[] };
export type OcctReader = (content: Uint8Array, linearUnit: LinearUnitName) => OcctResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, name: string): unknown {
  if (!isRecord(value)) throw new Error('expected an object with ' + name);
  return value[name];
}

function numberArray(value: unknown, what: string): ArrayLike<number> {
  if (value instanceof Float32Array || value instanceof Float64Array || value instanceof Int32Array || value instanceof Uint32Array ||
    value instanceof Int16Array || value instanceof Uint16Array || value instanceof Int8Array || value instanceof Uint8Array) return value;
  if (!Array.isArray(value)) throw new Error(what + ' is not an array');
  const out: number[] = [];
  for (const x of value) {
    if (typeof x !== 'number') throw new Error(what + ' holds a value that is not a number');
    out.push(x);
  }
  return out;
}

function parseGroups(value: unknown): BrepGroup[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('brep_faces is not an array');
  return value.map((g: unknown) => {
    const first = field(g, 'first'), last = field(g, 'last');
    if (typeof first !== 'number' || typeof last !== 'number') throw new Error('brep face range is not numeric');
    return { first, last };
  });
}

function parseColor(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [r, g, b] = value;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return [r, g, b];
}

function parseMesh(value: unknown): OcctMesh {
  const position = numberArray(field(field(field(value, 'attributes'), 'position'), 'array'), 'position');
  const index = numberArray(field(field(value, 'index'), 'array'), 'index');
  return { position, index, brepFaces: parseGroups(field(value, 'brep_faces')), color: parseColor(field(value, 'color')) };
}

export function parseOcctResult(value: unknown): OcctResult {
  if (!field(value, 'success')) return { success: false };
  const meshes = field(value, 'meshes');
  if (!Array.isArray(meshes)) throw new Error('meshes is not an array');
  return { success: true, meshes: meshes.map(parseMesh) };
}

export async function startOcct(factory: unknown, args: readonly unknown[]): Promise<OcctReader> {
  if (typeof factory !== 'function') throw new Error('occt-import-js factory is missing');
  const module: unknown = await Reflect.apply(factory, undefined, args);
  const readStepFile = field(module, 'ReadStepFile');
  if (typeof readStepFile !== 'function') throw new Error('occt-import-js has no ReadStepFile');
  return (content, linearUnit) => parseOcctResult(Reflect.apply(readStepFile, module, [content, { linearUnit }]));
}
