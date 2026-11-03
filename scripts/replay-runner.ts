import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return 'non-finite:' + String(v);
    if (isRecord(v) && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return v;
  });
}

function reviveFace(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value['tri'])) return value;
  return { ...value, tri: Float64Array.from(value['tri'].map(Number)) };
}

function legacyMeshes(meshes: unknown): unknown {
  if (!Array.isArray(meshes)) return meshes;
  return { meshes: meshes.map((m: unknown) => (isRecord(m)
    ? { attributes: { position: { array: m['position'] } }, index: { array: m['index'] }, brep_faces: m['brepFaces'] }
    : m)) };
}

function faceDigest(face: unknown): unknown {
  if (!isRecord(face) || !(face['tri'] instanceof Float64Array)) return face;
  const tri = face['tri'];
  return { ...face, tri: createHash('sha256').update(Buffer.from(tri.buffer, tri.byteOffset, tri.byteLength)).digest('hex') };
}

const [repoDir, inputsFile, outFile] = process.argv.slice(2);
if (!repoDir || !inputsFile || !outFile) throw new Error('usage: replay-runner <repo dir> <inputs file> <output file>');

const tsPath = join(repoDir, 'src/geom.ts');
const legacy = !existsSync(tsPath);
const loaded: unknown = await import(legacy ? join(repoDir, 'src/geom.js') : tsPath);
const api: unknown = isRecord(loaded) && 'fitFace' in loaded ? loaded : isRecord(loaded) ? loaded['default'] : undefined;

function call(name: string, args: readonly unknown[]): unknown {
  const fn: unknown = isRecord(api) ? api[name] : undefined;
  if (typeof fn !== 'function') throw new Error('src/geom has no function ' + name);
  return Reflect.apply(fn, undefined, args);
}

function run(fn: string, input: unknown): unknown {
  switch (fn) {
    case 'parseStepLengthUnit': return call(fn, [input]);
    case 'extractFaces': {
      const faces = call(fn, [legacy ? legacyMeshes(input) : input]);
      return Array.isArray(faces) ? faces.map(faceDigest) : faces;
    }
    case 'fitFace': return call(fn, [reviveFace(input)]);
    case 'faceEdge': return isRecord(input) ? call(fn, [reviveFace(input['face']), input['hit']]) : undefined;
    case 'measure': return isRecord(input) ? call(fn, [input['a'], input['b']]) : undefined;
    default: throw new Error('unknown captured function ' + fn);
  }
}

const out: string[] = [];
for (const line of readFileSync(inputsFile, 'utf8').split('\n')) {
  if (!line) continue;
  const record: unknown = JSON.parse(line);
  if (!isRecord(record) || typeof record['fn'] !== 'string') throw new Error('bad captured line');
  out.push(record['fn'] + ' ' + canonical(run(record['fn'], record['input'])));
}
writeFileSync(outFile, out.join('\n') + '\n');
