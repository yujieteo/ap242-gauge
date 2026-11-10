import { boundary, extractFaces, parseStepLengthUnit } from './geom.ts';
import type { Face, LengthUnit, Vec3 } from './geom.ts';
import type { OcctReader } from './occt.ts';
import { at, must } from './util.ts';

const DEFAULT_PART_COLOR: Vec3 = [0.8, 0.8, 0.78];

export type ModelData = {
  readonly unit: LengthUnit;
  readonly parts: number;
  readonly faceTri: Float64Array;
  readonly faceStart: Uint32Array;
  readonly faceMesh: Int32Array;
  readonly tri: Float32Array;
  readonly nrm: Float32Array;
  readonly col: Float32Array;
  readonly fid: Float32Array;
  readonly triFace: Int32Array;
  readonly edges: Float32Array;
  readonly lo: Vec3;
  readonly hi: Vec3;
  readonly readMs: number;
  readonly prepareMs: number;
};

export type ReadOutcome = { readonly ok: true; readonly data: ModelData } | { readonly ok: false; readonly message: string };

export function readModel(reader: OcctReader, buf: Uint8Array, name: string, stage: (text: string) => void): ReadOutcome {
  const unit = parseStepLengthUnit(new TextDecoder('latin1').decode(buf));
  stage('Reading ' + name);
  const t0 = performance.now();
  const result = reader(buf, unit.occt);
  const t1 = performance.now();
  if (!result.success || !result.meshes.length) return { ok: false, message: 'occt-import-js could not read ' + name };
  stage('Preparing ' + name);
  const faces = extractFaces(result.meshes);
  const firstFace = faces[0];
  if (!firstFace) return { ok: false, message: name + ' has no surfaces to show' };
  const faceTri = new Float64Array(firstFace.tri.buffer);
  const nt = faceTri.length / 9;
  const tri = new Float32Array(faceTri), nrm = new Float32Array(nt * 9), col = new Float32Array(nt * 9);
  const fid = new Float32Array(nt * 3), triFace = new Int32Array(nt);
  const faceStart = new Uint32Array(faces.length + 1), faceMesh = new Int32Array(faces.length);
  let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
  let t = 0, edgeCount = 0;
  const outlines = faces.map((f) => boundary(f.tri));
  for (const b of outlines) edgeCount += b.segs.length;
  const edges = new Float32Array(edgeCount * 3);
  let e = 0;
  for (const f of faces) {
    const c = result.meshes[f.mesh]?.color ?? DEFAULT_PART_COLOR;
    const c0 = c[0], c1 = c[1], c2 = c[2];
    faceStart[f.id] = t;
    faceMesh[f.id] = f.mesh;
    for (let n = t + f.tri.length / 9; t < n; t++) {
      const o = t * 9;
      const ax = at(faceTri, o), ay = at(faceTri, o + 1), az = at(faceTri, o + 2);
      const ux = at(faceTri, o + 3) - ax, uy = at(faceTri, o + 4) - ay, uz = at(faceTri, o + 5) - az;
      const vx = at(faceTri, o + 6) - ax, vy = at(faceTri, o + 7) - ay, vz = at(faceTri, o + 8) - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const scaleN = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= scaleN; ny *= scaleN; nz *= scaleN;
      for (let j = o; j < o + 9; j += 3) {
        const x = at(faceTri, j), y = at(faceTri, j + 1), z = at(faceTri, j + 2);
        nrm[j] = nx; nrm[j + 1] = ny; nrm[j + 2] = nz;
        col[j] = c0; col[j + 1] = c1; col[j + 2] = c2;
        if (x < lx) lx = x;
        if (y < ly) ly = y;
        if (z < lz) lz = z;
        if (x > hx) hx = x;
        if (y > hy) hy = y;
        if (z > hz) hz = z;
      }
      fid[t * 3] = fid[t * 3 + 1] = fid[t * 3 + 2] = f.id;
      triFace[t] = f.id;
    }
    const { first, segs } = must(outlines[f.id]);
    for (const id of segs) {
      const i = at(first, id) * 3;
      edges[e] = at(f.tri, i); edges[e + 1] = at(f.tri, i + 1); edges[e + 2] = at(f.tri, i + 2);
      e += 3;
    }
  }
  faceStart[faces.length] = t;
  return {
    ok: true,
    data: {
      unit, parts: result.meshes.length, faceTri, faceStart, faceMesh, tri, nrm, col, fid, triFace, edges,
      lo: [lx, ly, lz], hi: [hx, hy, hz], readMs: t1 - t0, prepareMs: performance.now() - t1,
    },
  };
}

export function transferables(d: ModelData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [d.faceTri, d.faceStart, d.faceMesh, d.tri, d.nrm, d.col, d.fid, d.triFace, d.edges]) {
    if (a.buffer instanceof ArrayBuffer) out.push(a.buffer);
  }
  return out;
}

export function facesOf(d: ModelData): Face[] {
  const faces: Face[] = [];
  for (let id = 0; id + 1 < d.faceStart.length; id++) {
    faces.push({ id, mesh: at(d.faceMesh, id), tri: d.faceTri.subarray(at(d.faceStart, id) * 9, at(d.faceStart, id + 1) * 9) });
  }
  return faces;
}
