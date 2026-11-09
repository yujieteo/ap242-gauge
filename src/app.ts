import { add, basis, boundary, extractFaces, faceEdge, featureFrom, fitFace, len, norm, parseStepLengthUnit, scale, sub } from './geom.ts';
import type { Face, FaceFit, Feature, Fit, LengthUnit, Vec3 } from './geom.ts';
import { describe, escapeHtml, measureRows } from './format.ts';
import { DEFAULT_PART_COLOR, NO_SELECTION, createRenderer, freeBuf, makeBuf } from './gl.ts';
import { startOcct } from './occt.ts';
import type { OcctMesh, OcctReader } from './occt.ts';
import { nextPicks, parsePickMode } from './picks.ts';
import type { Pick, PickMode, Picks } from './picks.ts';
import { camFrame, computeMatrices, draw, orbit, pan } from './render.hot.ts';
import type { Overlay } from './render.hot.ts';
import { at, must } from './util.ts';

type Model = {
  readonly name: string;
  readonly unit: LengthUnit;
  readonly faces: readonly Face[];
  readonly fits: Map<number, FaceFit>;
  readonly tri: Float32Array;
  readonly triFace: Int32Array;
  readonly center: Vec3;
  readonly radius: number;
};

type Hit = { readonly tri: number; readonly face: number; readonly point: Vec3 };
type Ray = { readonly o: Vec3; readonly d: Vec3 };
type Drag = { x: number; y: number; readonly id: number; readonly x0: number; readonly y0: number; readonly pan: boolean };

function el<T extends HTMLElement>(id: string, ctor: { new (): T }): T {
  const e = document.getElementById(id);
  if (!(e instanceof ctor)) throw new Error('page element #' + id + ' is missing or has the wrong type');
  return e;
}

const statusEl = el('status', HTMLDivElement);
const setStatus = (t: string): void => { statusEl.textContent = t; };

const asVec = (a: { x: number; y: number; z: number }): Vec3 => [a.x, a.y, a.z];

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function loadOcct(): Promise<OcctReader> {
  const b64: unknown = Reflect.get(window, 'OCCT_WASM_B64');
  if (typeof b64 !== 'string') throw new Error('the inlined wasm is missing');
  return startOcct(Reflect.get(window, 'occtimportjs'), [{ wasmBinary: decodeBase64(b64) }]);
}
const occtReady = loadOcct().then((o) => { setStatus('Ready. Open a STEP file.'); return o; },
  (e: unknown) => { setStatus('Cannot start the STEP reader: ' + String(e)); throw e; });

let model: Model | null = null;
let picks: Picks = [];

const canvas = el('gl', HTMLCanvasElement);
const r = createRenderer(canvas);
const feats = el('feats', HTMLDivElement);
const meas = el('meas', HTMLTableElement);

async function openFile(file: File): Promise<void> {
  setStatus('Reading ' + file.name + '...');
  const occt = await occtReady;
  const buf = new Uint8Array(await file.arrayBuffer());
  const unit = parseStepLengthUnit(new TextDecoder('latin1').decode(buf));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const t0 = performance.now();
  const result = occt(buf, unit.occt);
  if (!result.success || !result.meshes.length) { setStatus('occt-import-js could not read ' + file.name); return; }
  const faces = extractFaces(result.meshes);
  if (!faces.length) { setStatus(file.name + ' has no surfaces to show'); return; }
  setModel(file.name, unit, faces, result.meshes);
  setStatus(file.name + ': ' + result.meshes.length + ' part mesh(es), ' + faces.length + ' faces, unit ' +
    unit.label + ' (' + Math.round(performance.now() - t0) + ' ms)');
}

function setModel(name: string, unit: LengthUnit, faces: readonly Face[], meshes: readonly OcctMesh[]): void {
  let nt = 0;
  for (const f of faces) nt += f.tri.length / 9;
  const tri = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9), col = new Float32Array(nt * 9);
  const fid = new Float32Array(nt * 3), triFace = new Int32Array(nt);
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let t = 0;
  for (const f of faces) {
    const c = meshes[f.mesh]?.color ?? DEFAULT_PART_COLOR, T = f.tri;
    for (let k = 0; k < T.length; k += 9, t++) {
      const ax = at(T, k), ay = at(T, k + 1), az = at(T, k + 2);
      const ux = at(T, k + 3) - ax, uy = at(T, k + 4) - ay, uz = at(T, k + 5) - az;
      const vx = at(T, k + 6) - ax, vy = at(T, k + 7) - ay, vz = at(T, k + 8) - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const scaleN = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      for (let j = 0; j < 9; j += 3) {
        const o = t * 9 + j, x = at(T, k + j), y = at(T, k + j + 1), z = at(T, k + j + 2);
        tri[o] = x; tri[o + 1] = y; tri[o + 2] = z;
        nrm[o] = nx * scaleN; nrm[o + 1] = ny * scaleN; nrm[o + 2] = nz * scaleN;
        col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2];
        if (x < lo[0]) lo[0] = x;
        if (y < lo[1]) lo[1] = y;
        if (z < lo[2]) lo[2] = z;
        if (x > hi[0]) hi[0] = x;
        if (y > hi[1]) hi[1] = y;
        if (z > hi[2]) hi[2] = z;
      }
      fid[t * 3] = fid[t * 3 + 1] = fid[t * 3 + 2] = f.id;
      triFace[t] = f.id;
    }
  }
  model = { name, unit, faces, fits: new Map(), tri, triFace,
    center: scale(add(lo, hi), 0.5), radius: Math.max(len(sub(hi, lo)) / 2, 1e-9) };
  r.modelRadius = model.radius;
  r.hasModel = true;
  picks = nextPicks(picks, { kind: 'load' });
  el('drop', HTMLDivElement).classList.add('hidden');
  el('unit', HTMLSpanElement).textContent = 'Length unit from file: ' + unit.label;
  uploadModel(tri, nrm, col, fid, faces);
  fitView();
  showPicks();
}

function fitOf(m: Model, id: number): FaceFit {
  const known = m.fits.get(id);
  if (known) return known;
  const fit = fitFace(must(m.faces[id]));
  m.fits.set(id, fit);
  return fit;
}

function uploadModel(tri: Float32Array, nrm: Float32Array, col: Float32Array, fid: Float32Array, faces: readonly Face[]): void {
  const gl = r.gl;
  freeBuf(gl, r.faces); freeBuf(gl, r.edges);
  r.faces = makeBuf(gl, { p: tri, n: nrm, c: col, f: fid }, tri.length / 3);
  const seg: number[] = [];
  for (const f of faces) {
    const { first, segs } = boundary(f.tri);
    for (const id of segs) {
      const i = at(first, id) * 3;
      seg.push(at(f.tri, i), at(f.tri, i + 1), at(f.tri, i + 2));
    }
  }
  r.edges = makeBuf(gl, { p: new Float32Array(seg) }, seg.length / 3);
}

function fitView(): void {
  if (!model) return;
  r.cam.target.x = model.center[0]; r.cam.target.y = model.center[1]; r.cam.target.z = model.center[2];
  const aspect = Math.min(1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  r.cam.dist = model.radius / Math.sin(Math.atan(Math.tan(r.cam.fov / 2) * aspect)) * 1.1;
  draw(r);
}

let drawQueued = false;
const requestDraw = (): void => {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(r); });
};
window.addEventListener('resize', requestDraw);

let drag: Drag | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (drag) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId, x0: e.clientX, y0: e.clientY, pan: e.button === 2 || e.shiftKey };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId || !model) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) pan(r.cam, r.scratch.frame, dx, dy, canvas.clientHeight);
  else orbit(r.cam, dx, dy);
  requestDraw();
});
canvas.addEventListener('pointercancel', (e) => { if (drag?.id === e.pointerId) drag = null; });
canvas.addEventListener('pointerup', (e) => {
  const d = drag;
  if (!d || d.id !== e.pointerId) return;
  drag = null;
  if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4 && e.button === 0 && !e.shiftKey) pickAt(e);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  r.cam.dist *= Math.exp(e.deltaY * 0.001);
  requestDraw();
}, { passive: false });

function rayAt(clientX: number, clientY: number): Ray {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1, y = 1 - ((clientY - rect.top) / rect.height) * 2;
  camFrame(r.cam, r.scratch.frame);
  const { eye, fwd, right, up } = r.scratch.frame;
  const t = Math.tan(r.cam.fov / 2), aspect = rect.width / rect.height;
  return { o: asVec(eye), d: norm(add(asVec(fwd), add(scale(asVec(right), x * t * aspect), scale(asVec(up), y * t)))) };
}

function raycast(m: Model, ray: Ray): Hit | null {
  const T = m.tri;
  let best = Infinity, bestT = -1;
  const [ox, oy, oz] = ray.o, [dx, dy, dz] = ray.d;
  for (let t = 0, n = T.length / 9; t < n; t++) {
    const i = t * 9;
    const t0 = at(T, i), t1 = at(T, i + 1), t2 = at(T, i + 2);
    const e1x = at(T, i + 3) - t0, e1y = at(T, i + 4) - t1, e1z = at(T, i + 5) - t2;
    const e2x = at(T, i + 6) - t0, e2y = at(T, i + 7) - t1, e2z = at(T, i + 8) - t2;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-20) continue;
    const inv = 1 / det, sx = ox - t0, sy = oy - t1, sz = oz - t2;
    const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (d > 0 && d < best) { best = d; bestT = t; }
  }
  if (bestT < 0) return null;
  return { tri: bestT, face: at(m.triFace, bestT), point: add(ray.o, scale(ray.d, best)) };
}

function pickMode(): PickMode {
  const checked = document.querySelector('input[name=mode]:checked');
  if (!(checked instanceof HTMLInputElement)) throw new Error('no pick mode is selected');
  return parsePickMode(checked.value);
}

function pickAt(e: { clientX: number; clientY: number }): void {
  if (!model) return;
  const hit = raycast(model, rayAt(e.clientX, e.clientY));
  if (!hit) return;
  const mode = pickMode();
  let fit: Fit, feature: Feature, hitPoint = hit.point;
  if (mode === 'face') {
    fit = fitOf(model, hit.face);
    feature = featureFrom(fit);
  } else if (mode === 'edge') {
    const edge = faceEdge(must(model.faces[hit.face]), hit.point);
    if (!edge) { setStatus('This face has no boundary edge near the click.'); return; }
    fit = edge;
    feature = featureFrom(fit);
  } else {
    const T = model.tri, i = hit.tri * 9;
    let best: Vec3 | null = null, bd = Infinity;
    for (let k = 0; k < 3; k++) {
      const p: Vec3 = [at(T, i + k * 3), at(T, i + k * 3 + 1), at(T, i + k * 3 + 2)], d = len(sub(p, hit.point));
      if (d < bd) { bd = d; best = p; }
    }
    const f = must(model.faces[hit.face]);
    let bestD = Infinity, bestP = must(best);
    for (let j = 0; j < f.tri.length; j += 3) {
      const p: Vec3 = [at(f.tri, j), at(f.tri, j + 1), at(f.tri, j + 2)], d = len(sub(p, must(best)));
      if (d < bestD) { bestD = d; bestP = p; }
    }
    fit = { type: 'vertex', point: bestP, rms: null };
    feature = { kind: 'point', point: bestP };
    hitPoint = bestP;
  }
  picks = nextPicks(picks, { kind: 'pick', pick: { face: hit.face, mode, fit, feature, hit: hitPoint } });
  showPicks();
}

function overlayFor(m: Model, p: Pick, color: readonly [number, number, number]): Overlay[] {
  const gl = r.gl;
  const seg: number[] = [], pts: number[] = [];
  const f = p.fit, size = m.radius * 0.6;
  if (p.feature.kind === 'axis') {
    const fitSize = 'size' in f ? f.size : 0;
    const L = f.type === 'line' ? f.length / 2 + size * 0.1 : Math.max(size * 0.5, fitSize * 0.6);
    seg.push(...add(f.point, scale(p.feature.dir, -L)), ...add(f.point, scale(p.feature.dir, L)));
  }
  if (f.type === 'circle') {
    const d = p.feature.kind === 'axis' ? p.feature.dir : f.dir;
    const [u, v] = basis(d);
    for (let k = 0; k < 64; k++) {
      const a0 = k / 64 * 2 * Math.PI, a1 = (k + 1) / 64 * 2 * Math.PI;
      seg.push(...add(f.point, add(scale(u, f.radius * Math.cos(a0)), scale(v, f.radius * Math.sin(a0)))));
      seg.push(...add(f.point, add(scale(u, f.radius * Math.cos(a1)), scale(v, f.radius * Math.sin(a1)))));
    }
  }
  if (f.type === 'plane') {
    seg.push(...f.point, ...add(f.point, scale(f.normal, size * 0.25)));
  }
  pts.push(...p.hit, ...p.feature.point);
  const out: Overlay[] = [];
  const rgb = new Float32Array(color);
  if (seg.length) out.push({ buf: makeBuf(gl, { p: new Float32Array(seg) }, seg.length / 3), color: rgb, mode: gl.LINES });
  out.push({ buf: makeBuf(gl, { p: new Float32Array(pts) }, pts.length / 3), color: rgb, mode: gl.POINTS });
  return out;
}

const PICK_A_COLOR = [0.91, 0.45, 0.05] as const;
const PICK_B_COLOR = [0.12, 0.44, 0.82] as const;

function selectedFace(index: 0 | 1): number {
  const p = picks[index];
  return p && p.mode === 'face' ? p.face : NO_SELECTION;
}

function showPicks(): void {
  const gl = r.gl;
  for (const o of r.overlays) freeBuf(gl, o.buf);
  r.overlays = [];
  feats.innerHTML = ''; meas.innerHTML = '';
  const m = model;
  if (!m) return;
  const unit = m.unit;
  picks.forEach((p, i) => {
    r.overlays.push(...overlayFor(m, p, i === 0 ? PICK_A_COLOR : PICK_B_COLOR));
    const lines = describe(p.face, p.fit, unit);
    feats.insertAdjacentHTML('beforeend', '<div class="feat ' + (i ? 'b' : 'a') + '"><b>' + (i ? 'B: ' : 'A (reference): ') +
      escapeHtml(must(lines[0])) + '</b>' + lines.slice(1).map(escapeHtml).join('<br>') + '</div>');
  });
  r.selA = selectedFace(0);
  r.selB = selectedFace(1);
  meas.innerHTML = measureRows(picks, unit).map((row) => '<tr><td>' + escapeHtml(row[0]) + '</td><td class="v">' + escapeHtml(row[1]) + '</td></tr>').join('');
  requestDraw();
}

const fileInput = el('file', HTMLInputElement);
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) openFile(file).catch((x: unknown) => setStatus(String(x)));
});
el('fit', HTMLButtonElement).addEventListener('click', fitView);
el('clear', HTMLButtonElement).addEventListener('click', () => { picks = nextPicks(picks, { kind: 'clear' }); showPicks(); });
el('lic', HTMLButtonElement).addEventListener('click', () => {
  const l = el('licences', HTMLDivElement);
  l.style.display = l.style.display === 'block' ? 'none' : 'block';
});
const drop = el('drop', HTMLDivElement);
window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) openFile(f).catch((x: unknown) => setStatus(String(x)));
});
draw(r);

type Ap242GaugeHooks = {
  openFile: (file: File) => Promise<void>;
  pickAt: (x: number, y: number) => void;
  setView: (yaw: number, pitch: number) => void;
  project: (p: Vec3) => [number, number];
  readonly picks: Picks;
  readonly model: Model | null;
  measurements: () => string[][];
};

declare global {
  interface Window { ap242gauge: Ap242GaugeHooks }
}

window.ap242gauge = {
  openFile,
  pickAt: (x, y) => pickAt({ clientX: x, clientY: y }),
  setView(yaw, pitch) { r.cam.yaw = yaw; r.cam.pitch = pitch; fitView(); },
  project(p) {
    computeMatrices(r.cam, r.scratch, r.canvas.width / r.canvas.height, r.modelRadius);
    const mvp = r.scratch.mvp, rect = canvas.getBoundingClientRect();
    const c = [0, 1, 2, 3].map((i) => at(mvp, i) * p[0] + at(mvp, 4 + i) * p[1] + at(mvp, 8 + i) * p[2] + at(mvp, 12 + i));
    const c0 = must(c[0]), c1 = must(c[1]), c3 = must(c[3]);
    return [rect.left + (c0 / c3 + 1) / 2 * rect.width, rect.top + (1 - c1 / c3) / 2 * rect.height];
  },
  get picks() { return picks; },
  get model() { return model; },
  measurements: () => [...meas.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent ?? '')),
};
