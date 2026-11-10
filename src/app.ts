import { add, basis, faceEdge, featureFrom, fitFace, len, norm, scale, sub } from './geom.ts';
import type { Face, FaceFit, Feature, Fit, LengthUnit, Vec3 } from './geom.ts';
import { describe, escapeHtml, measureRows } from './format.ts';
import { NO_SELECTION, createRenderer, freeBuf, makeBuf } from './gl.ts';
import { facesOf } from './model.ts';
import type { ModelData } from './model.ts';
import { nextPicks, parsePickMode } from './picks.ts';
import type { Pick, PickMode, Picks } from './picks.ts';
import { CANCELLED, startReader } from './reader.ts';
import { camFrame, computeMatrices, draw, orbitAbout, pan, zoomAbout } from './render.hot.ts';
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
type Drag = { x: number; y: number; moved: boolean; readonly x0: number; readonly y0: number; readonly pan: boolean; readonly pick: boolean; readonly pivot: Vec3 };
type Point2 = { x: number; y: number };
type View = { readonly yaw: number; readonly pitch: number };

const VIEWS: Readonly<Record<string, View>> = {
  iso: { yaw: -0.8, pitch: 0.5 },
  front: { yaw: -Math.PI / 2, pitch: 0 },
  top: { yaw: -Math.PI / 2, pitch: 1.55 },
  right: { yaw: 0, pitch: 0 },
};
const VIEW_KEYS: Readonly<Record<string, string>> = { '1': 'iso', '2': 'front', '3': 'top', '4': 'right' };
const MODE_KEYS: Readonly<Record<string, PickMode>> = { f: 'face', e: 'edge', p: 'point' };
const CAMERA_MOVE_MS = 250;
const DONE_TOAST_MS = 4000;
const HOVER_EDGE_MAX_TRIANGLES = 20000;
const CLICK_SLOP_PX = 4;
const PICK_A_COLOR = [0.91, 0.45, 0.05] as const;
const PICK_B_COLOR = [0.12, 0.44, 0.82] as const;

function el<T extends HTMLElement>(id: string, ctor: { new (): T }): T {
  const e = document.getElementById(id);
  if (!(e instanceof ctor)) throw new Error('page element #' + id + ' is missing or has the wrong type');
  return e;
}

const asVec = (a: { x: number; y: number; z: number }): Vec3 => [a.x, a.y, a.z];
const count = (n: number): string => n.toLocaleString('en-US');
const seconds = (ms: number): string => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const toastEl = el('toast', HTMLDivElement);
const toastText = el('toast-text', HTMLSpanElement);
const cancelButton = el('cancel', HTMLButtonElement);
let toastTimer = 0, busyTimer = 0;

function toast(text: string, kind: 'busy' | 'done' | 'error'): void {
  window.clearTimeout(toastTimer);
  toastText.textContent = text;
  toastEl.dataset['kind'] = kind;
  toastEl.dataset['show'] = 'true';
  if (kind === 'done') toastTimer = window.setTimeout(() => { toastEl.dataset['show'] = 'false'; }, DONE_TOAST_MS);
}

function startBusy(label: () => string, canCancel: boolean): void {
  const t0 = performance.now();
  cancelButton.hidden = !canCancel;
  const tick = (): void => toast(label() + ' · ' + seconds(performance.now() - t0), 'busy');
  window.clearInterval(busyTimer);
  busyTimer = window.setInterval(tick, 100);
  tick();
}

function stopBusy(): void {
  window.clearInterval(busyTimer);
  cancelButton.hidden = true;
}

function pageText(id: string): string {
  return el(id, HTMLScriptElement).text;
}

async function loadReader(): ReturnType<typeof startReader> {
  const b64: unknown = Reflect.get(window, 'OCCT_WASM_B64');
  if (typeof b64 !== 'string') throw new Error('the inlined wasm is missing');
  return startReader({ occt: pageText('occt-src'), worker: pageText('worker-src'), wasm: decodeBase64(b64) });
}
toast('Starting the STEP reader', 'busy');
const readerReady = loadReader().then((reader) => { toast('Ready. Open a STEP file.', 'done'); return reader; },
  (e: unknown) => { toast('Cannot start the STEP reader: ' + String(e), 'error'); throw e; });

let model: Model | null = null;
let picks: Picks = [];
let mode: PickMode = 'face';
let openToken = 0;

const canvas = el('gl', HTMLCanvasElement);
const r = createRenderer(canvas);
const feats = el('feats', HTMLDivElement);
const meas = el('meas', HTMLTableElement);
const hint = el('hint', HTMLParagraphElement);
const info = el('info', HTMLDivElement);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

async function openFile(file: File): Promise<void> {
  const reader = await readerReady;
  reader.cancel();
  const token = ++openToken;
  let stage = 'Reading ' + file.name;
  startBusy(() => stage, reader.background);
  try {
    const data = await reader.read(file.name, await file.arrayBuffer(), (text) => { stage = text; });
    if (token !== openToken) return;
    stopBusy();
    setModel(file.name, data);
    toast('Opened ' + file.name + ' in ' + seconds(data.readMs + data.prepareMs), 'done');
  } catch (x) {
    if (token !== openToken) return;
    stopBusy();
    if (x instanceof Error && x.message === CANCELLED) toast('Cancelled', 'done');
    else toast(x instanceof Error ? x.message : String(x), 'error');
  }
}

function setModel(name: string, d: ModelData): void {
  const center = scale(add(d.lo, d.hi), 0.5);
  model = { name, unit: d.unit, faces: facesOf(d), fits: new Map(), tri: d.tri, triFace: d.triFace,
    center, radius: Math.max(len(sub(d.hi, d.lo)) / 2, 1e-9) };
  r.modelRadius = model.radius;
  r.center.x = center[0]; r.center.y = center[1]; r.center.z = center[2];
  r.hasModel = true;
  r.hover = NO_SELECTION;
  picks = nextPicks(picks, { kind: 'load' });
  document.body.dataset['model'] = 'true';
  info.innerHTML = '<div class="name">' + escapeHtml(name) + '</div><div class="muted">' +
    [count(d.parts) + (d.parts === 1 ? ' part' : ' parts'), count(model.faces.length) + ' faces', count(d.tri.length / 9) + ' triangles', 'unit ' + d.unit.label]
      .join(' · ') + '</div><div class="muted">Read ' + seconds(d.readMs) + ', prepare ' + seconds(d.prepareMs) + '</div>';
  const gl = r.gl;
  freeBuf(gl, r.faces); freeBuf(gl, r.edges);
  r.faces = makeBuf(gl, { p: d.tri, n: d.nrm, c: d.col, f: d.fid }, d.tri.length / 3);
  r.edges = makeBuf(gl, { p: d.edges }, d.edges.length / 3);
  moveCamera(VIEWS['iso'], false);
  showPicks();
}

function fitOf(m: Model, id: number): FaceFit {
  const known = m.fits.get(id);
  if (known) return known;
  const fit = fitFace(must(m.faces[id]));
  m.fits.set(id, fit);
  return fit;
}

let drawQueued = false;
const requestDraw = (): void => {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(r); });
};
window.addEventListener('resize', requestDraw);

let cameraMove = 0;
const stopCameraMove = (): void => { cancelAnimationFrame(cameraMove); cameraMove = 0; };

function moveCamera(view: View | undefined, animate: boolean): void {
  const m = model;
  if (!m) return;
  stopCameraMove();
  const cam = r.cam;
  const aspect = Math.min(1, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const from = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: asVec(cam.target) };
  const turn = view ? Math.atan2(Math.sin(view.yaw - cam.yaw), Math.cos(view.yaw - cam.yaw)) : 0;
  const to = { yaw: cam.yaw + turn, pitch: view ? view.pitch : cam.pitch, target: m.center,
    dist: m.radius / Math.sin(Math.atan(Math.tan(cam.fov / 2) * aspect)) * 1.1 };
  const t0 = performance.now();
  const step = (): void => {
    const t = animate && !reduceMotion.matches ? Math.min(1, (performance.now() - t0) / CAMERA_MOVE_MS) : 1;
    const k = 1 - (1 - t) ** 5;
    cam.yaw = from.yaw + (to.yaw - from.yaw) * k;
    cam.pitch = from.pitch + (to.pitch - from.pitch) * k;
    cam.dist = from.dist + (to.dist - from.dist) * k;
    cam.target.x = from.target[0] + (to.target[0] - from.target[0]) * k;
    cam.target.y = from.target[1] + (to.target[1] - from.target[1]) * k;
    cam.target.z = from.target[2] + (to.target[2] - from.target[2]) * k;
    draw(r);
    cameraMove = t < 1 ? requestAnimationFrame(step) : 0;
  };
  step();
}

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

function pointUnder(m: Model, clientX: number, clientY: number): Vec3 {
  const ray = rayAt(clientX, clientY);
  const hit = raycast(m, ray);
  if (hit) return hit.point;
  const along = ray.d[0] * r.scratch.frame.fwd.x + ray.d[1] * r.scratch.frame.fwd.y + ray.d[2] * r.scratch.frame.fwd.z;
  return add(ray.o, scale(ray.d, r.cam.dist / along));
}

function nearestVertex(m: Model, hit: Hit): Vec3 {
  const f = must(m.faces[hit.face]);
  let bestD = Infinity, best = hit.point;
  for (let j = 0; j < f.tri.length; j += 3) {
    const p: Vec3 = [at(f.tri, j), at(f.tri, j + 1), at(f.tri, j + 2)], d = len(sub(p, hit.point));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function pickFrom(m: Model, hit: Hit, pickMode: PickMode): Pick | null {
  if (pickMode === 'point') {
    const point = nearestVertex(m, hit);
    return { face: hit.face, mode: pickMode, fit: { type: 'vertex', point, rms: null }, feature: { kind: 'point', point }, hit: point };
  }
  const fit: Fit | null = pickMode === 'face' ? fitOf(m, hit.face) : faceEdge(must(m.faces[hit.face]), hit.point);
  return fit ? { face: hit.face, mode: pickMode, fit, feature: featureFrom(fit), hit: hit.point } : null;
}

function pickAt(e: { clientX: number; clientY: number }): void {
  if (!model) return;
  const hit = raycast(model, rayAt(e.clientX, e.clientY));
  if (!hit) return;
  const pick = pickFrom(model, hit, mode);
  if (!pick) { toast('This face has no boundary edge near the click.', 'done'); return; }
  picks = nextPicks(picks, { kind: 'pick', pick });
  showPicks();
}

function overlayFor(m: Model, p: Pick, color: readonly [number, number, number]): Overlay[] {
  const gl = r.gl;
  const seg: number[] = [], pts: number[] = [];
  const f = p.fit, size = m.radius * 0.6;
  const feature: Feature = p.feature;
  if (f.type === 'line') seg.push(...f.ends[0], ...f.ends[1]);
  else if (feature.kind === 'axis') {
    const L = Math.max(size * 0.5, ('size' in f ? f.size : 0) * 0.6);
    seg.push(...add(f.point, scale(feature.dir, -L)), ...add(f.point, scale(feature.dir, L)));
  }
  if (f.type === 'circle') {
    const [u, v] = basis(f.dir);
    for (let k = 0; k < 64; k++) {
      const a0 = k / 64 * 2 * Math.PI, a1 = (k + 1) / 64 * 2 * Math.PI;
      seg.push(...add(f.point, add(scale(u, f.radius * Math.cos(a0)), scale(v, f.radius * Math.sin(a0)))));
      seg.push(...add(f.point, add(scale(u, f.radius * Math.cos(a1)), scale(v, f.radius * Math.sin(a1)))));
    }
  }
  if (f.type === 'plane') seg.push(...f.point, ...add(f.point, scale(f.normal, size * 0.25)));
  pts.push(...p.hit, ...feature.point);
  const out: Overlay[] = [];
  const rgb = new Float32Array(color);
  if (seg.length) out.push({ buf: makeBuf(gl, { p: new Float32Array(seg) }, seg.length / 3), color: rgb, mode: gl.LINES });
  out.push({ buf: makeBuf(gl, { p: new Float32Array(pts) }, pts.length / 3), color: rgb, mode: gl.POINTS });
  return out;
}

let pickOverlays: Overlay[] = [], hoverOverlays: Overlay[] = [];
const nextColor = (): readonly [number, number, number] => (picks.length === 0 ? PICK_A_COLOR : PICK_B_COLOR);

function setOverlays(which: 'pick' | 'hover', next: Overlay[]): void {
  for (const o of which === 'pick' ? pickOverlays : hoverOverlays) freeBuf(r.gl, o.buf);
  if (which === 'pick') pickOverlays = next; else hoverOverlays = next;
  r.overlays = [...pickOverlays, ...hoverOverlays];
}

function clearHover(): void {
  if (r.hover === NO_SELECTION && !hoverOverlays.length) return;
  r.hover = NO_SELECTION;
  setOverlays('hover', []);
  requestDraw();
}

function hoverAt(clientX: number, clientY: number): void {
  const m = model;
  if (!m) return;
  const hit = raycast(m, rayAt(clientX, clientY));
  if (!hit) { clearHover(); return; }
  r.hoverColor.set(nextColor());
  if (mode === 'face') {
    if (r.hover === hit.face && !hoverOverlays.length) return;
    r.hover = hit.face;
    setOverlays('hover', []);
  } else {
    r.hover = NO_SELECTION;
    const small = mode === 'point' || must(m.faces[hit.face]).tri.length / 9 <= HOVER_EDGE_MAX_TRIANGLES;
    const preview = small ? pickFrom(m, hit, mode) : null;
    setOverlays('hover', preview ? overlayFor(m, preview, nextColor()) : []);
  }
  requestDraw();
}

function selectedFace(index: 0 | 1): number {
  const p = picks[index];
  return p && p.mode === 'face' ? p.face : NO_SELECTION;
}

function showPicks(): void {
  const m = model;
  if (!m) return;
  const unit = m.unit;
  const overlays: Overlay[] = [];
  const cards: string[] = [];
  picks.forEach((p, i) => {
    overlays.push(...overlayFor(m, p, i === 0 ? PICK_A_COLOR : PICK_B_COLOR));
    const lines = describe(p.face, p.fit, unit);
    const slot = i === 0 ? 'A' : 'B';
    cards.push('<div class="pick ' + slot.toLowerCase() + '"><div class="pick-head"><span class="slot">' + slot + '</span><span class="name">' +
      escapeHtml(must(lines[0])) + '</span><button class="button icon" data-remove="' + i + '" aria-label="Remove ' + slot + '">×</button></div>' +
      '<div class="muted">' + lines.slice(1).map(escapeHtml).join('<br>') + '</div></div>');
  });
  setOverlays('pick', overlays);
  setOverlays('hover', []);
  r.hover = NO_SELECTION;
  feats.innerHTML = cards.join('');
  const rows = measureRows(picks, unit).filter((row) => row[0] !== '');
  meas.innerHTML = rows.map((row) => '<tr><td>' + escapeHtml(row[0]) + '</td><td class="v">' + escapeHtml(row[1]) + '</td></tr>').join('');
  hint.textContent = picks.length === 0 ? 'Click a feature to set reference A.'
    : picks.length === 1 ? 'Click a second feature to measure from A.' : 'Click another feature to replace B. A stays.';
  el('swap', HTMLButtonElement).disabled = picks.length !== 2;
  el('clear', HTMLButtonElement).disabled = picks.length === 0;
  r.selA = selectedFace(0);
  r.selB = selectedFace(1);
  requestDraw();
}

function setMode(next: PickMode): void {
  mode = next;
  for (const b of document.querySelectorAll('[data-mode]')) if (b instanceof HTMLElement) b.dataset['active'] = String(b.dataset['mode'] === next);
  clearHover();
}

const pointers = new Map<number, Point2>();
let drag: Drag | null = null;
let pinch: { cx: number; cy: number; span: number } | null = null;
let hoverQueued = false, hoverX = 0, hoverY = 0;

function pinchState(): { cx: number; cy: number; span: number } | null {
  const [a, b] = [...pointers.values()];
  return a && b ? { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y) } : null;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (!model) return;
  if (e.button === 1) e.preventDefault();
  stopCameraMove();
  clearHover();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 1) {
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, pan: e.button !== 0 || e.shiftKey,
      pick: e.button === 0 && !e.shiftKey, pivot: pointUnder(model, e.clientX, e.clientY) };
  } else {
    drag = null;
    pinch = pinchState();
  }
});
canvas.addEventListener('pointermove', (e) => {
  const m = model;
  if (!m) return;
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'touch') return;
    hoverX = e.clientX; hoverY = e.clientY;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => { hoverQueued = false; if (!pointers.size) hoverAt(hoverX, hoverY); });
    return;
  }
  p.x = e.clientX; p.y = e.clientY;
  if (pinch) {
    const now = pinchState();
    if (!now) return;
    pan(r.cam, r.scratch.frame, now.cx - pinch.cx, now.cy - pinch.cy, canvas.clientHeight);
    const q = pointUnder(m, now.cx, now.cy);
    zoomAbout(r.cam, q[0], q[1], q[2], pinch.span / Math.max(1, now.span));
    pinch = now;
  } else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < CLICK_SLOP_PX) return;
    drag.moved = true;
    canvas.dataset['dragging'] = 'true';
    if (drag.pan) pan(r.cam, r.scratch.frame, dx, dy, canvas.clientHeight);
    else orbitAbout(r.cam, r.scratch.frame, drag.pivot[0], drag.pivot[1], drag.pivot[2], dx, dy);
  }
  requestDraw();
});
const endPointer = (e: PointerEvent, click: boolean): void => {
  if (!pointers.delete(e.pointerId)) return;
  const d = drag;
  drag = null;
  pinch = null;
  canvas.dataset['dragging'] = 'false';
  if (click && d && d.pick && !d.moved && !pointers.size) pickAt(e);
};
canvas.addEventListener('pointerup', (e) => endPointer(e, true));
canvas.addEventListener('pointercancel', (e) => endPointer(e, false));
canvas.addEventListener('pointerleave', () => { if (!pointers.size) clearHover(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const m = model;
  if (!m) return;
  stopCameraMove();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  const k = Math.exp(Math.max(-1, Math.min(1, delta * (e.ctrlKey ? 0.01 : 0.0015))));
  const q = pointUnder(m, e.clientX, e.clientY);
  zoomAbout(r.cam, q[0], q[1], q[2], k);
  requestDraw();
}, { passive: false });

feats.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-remove]') : null;
  if (!(b instanceof HTMLElement)) return;
  picks = nextPicks(picks, { kind: 'remove', index: b.dataset['remove'] === '0' ? 0 : 1 });
  showPicks();
});
for (const b of document.querySelectorAll('[data-mode]')) {
  if (b instanceof HTMLElement) b.addEventListener('click', () => setMode(parsePickMode(b.dataset['mode'] ?? '')));
}
for (const b of document.querySelectorAll('[data-view]')) {
  if (b instanceof HTMLElement) b.addEventListener('click', () => moveCamera(VIEWS[b.dataset['view'] ?? ''], true));
}
const clearPicks = (): void => { picks = nextPicks(picks, { kind: 'clear' }); showPicks(); };
el('fit', HTMLButtonElement).addEventListener('click', () => moveCamera(undefined, true));
el('clear', HTMLButtonElement).addEventListener('click', clearPicks);
el('swap', HTMLButtonElement).addEventListener('click', () => { picks = nextPicks(picks, { kind: 'swap' }); showPicks(); });
cancelButton.addEventListener('click', () => { readerReady.then((reader) => reader.cancel()).catch(() => undefined); });
el('lic', HTMLButtonElement).addEventListener('click', () => {
  const l = el('licences', HTMLDivElement);
  l.hidden = !l.hidden;
});

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  const pickMode = MODE_KEYS[key], view = VIEW_KEYS[key];
  if (pickMode) setMode(pickMode);
  else if (view) moveCamera(VIEWS[view], false);
  else if (key === 'z') moveCamera(undefined, false);
  else if (key === 'x') { picks = nextPicks(picks, { kind: 'swap' }); showPicks(); }
  else if (key === 'escape') clearPicks();
  else return;
  e.preventDefault();
});

const fileInput = el('file', HTMLInputElement);
const openFrom = (file: File | undefined): void => {
  if (file) openFile(file).catch((x: unknown) => toast(String(x), 'error'));
};
el('open', HTMLButtonElement).addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  openFrom(file);
});
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.dataset['over'] = 'true'; });
window.addEventListener('dragleave', () => { document.body.dataset['over'] = 'false'; });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.dataset['over'] = 'false';
  openFrom(e.dataTransfer?.files[0]);
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
  setView(yaw, pitch) { moveCamera({ yaw, pitch }, false); },
  project(p) {
    computeMatrices(r.cam, r.scratch, r.canvas.width / r.canvas.height, r.center, r.modelRadius);
    const mvp = r.scratch.mvp, rect = canvas.getBoundingClientRect();
    const c = [0, 1, 2, 3].map((i) => at(mvp, i) * p[0] + at(mvp, 4 + i) * p[1] + at(mvp, 8 + i) * p[2] + at(mvp, 12 + i));
    const c0 = must(c[0]), c1 = must(c[1]), c3 = must(c[3]);
    return [rect.left + (c0 / c3 + 1) / 2 * rect.width, rect.top + (1 - c1 / c3) / 2 * rect.height];
  },
  get picks() { return picks; },
  get model() { return model; },
  measurements: () => [...meas.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent ?? '')),
};
