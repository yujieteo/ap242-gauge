import { at } from './util.ts';

type V3 = { x: number; y: number; z: number };
export type Cam = { target: V3; dist: number; yaw: number; pitch: number; fov: number };
export type Frame = { eye: V3; fwd: V3; right: V3; up: V3 };
export type Buf = { count: number; p: WebGLBuffer; n?: WebGLBuffer; c?: WebGLBuffer; f?: WebGLBuffer };
export type Overlay = { buf: Buf; color: Float32Array; mode: number };
export type Locations = {
  p: number; n: number; c: number; f: number;
  mvp: WebGLUniformLocation | null; selA: WebGLUniformLocation | null; selB: WebGLUniformLocation | null;
  eyeDir: WebGLUniformLocation | null; lit: WebGLUniformLocation | null;
  hov: WebGLUniformLocation | null; hovCol: WebGLUniformLocation | null; off: WebGLUniformLocation | null;
};
export type Scratch = { frame: Frame; view: Float64Array; proj: Float64Array; mvp: Float32Array; eyeDir: Float32Array };
export type Renderer = {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  prog: WebGLProgram;
  loc: Locations;
  cam: Cam;
  scratch: Scratch;
  edgeColor: Float32Array;
  hoverColor: Float32Array;
  center: V3;
  faces: Buf | null;
  edges: Buf | null;
  overlays: Overlay[];
  hasModel: boolean;
  modelRadius: number;
  selA: number;
  selB: number;
  hover: number;
};

export function camFrame(cam: Cam, fr: Frame): void {
  const cp = Math.cos(cam.pitch);
  const bx = cp * Math.cos(cam.yaw), by = cp * Math.sin(cam.yaw), bz = Math.sin(cam.pitch);
  fr.eye.x = cam.target.x + bx * cam.dist;
  fr.eye.y = cam.target.y + by * cam.dist;
  fr.eye.z = cam.target.z + bz * cam.dist;
  fr.fwd.x = bx * -1; fr.fwd.y = by * -1; fr.fwd.z = bz * -1;
  const rx = fr.fwd.y * 1 - fr.fwd.z * 0, ry = fr.fwd.z * 0 - fr.fwd.x * 1, rz = fr.fwd.x * 0 - fr.fwd.y * 0;
  const l = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (l > 0) {
    const s = 1 / l;
    fr.right.x = rx * s; fr.right.y = ry * s; fr.right.z = rz * s;
  } else {
    fr.right.x = 0; fr.right.y = 0; fr.right.z = 0;
  }
  fr.up.x = fr.right.y * fr.fwd.z - fr.right.z * fr.fwd.y;
  fr.up.y = fr.right.z * fr.fwd.x - fr.right.x * fr.fwd.z;
  fr.up.z = fr.right.x * fr.fwd.y - fr.right.y * fr.fwd.x;
}

function dot3(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function computeMatrices(cam: Cam, s: Scratch, aspect: number, center: V3, radius: number): void {
  camFrame(cam, s.frame);
  const { eye, fwd, right, up } = s.frame;
  const cx = eye.x - center.x, cy = eye.y - center.y, cz = eye.z - center.z;
  const away = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const far = away + radius * 1.01, near = Math.max(away - radius * 1.01, far * 1e-4);
  const f = 1 / Math.tan(cam.fov / 2);
  const v = s.view, p = s.proj;
  v[0] = right.x; v[1] = up.x; v[2] = -fwd.x; v[3] = 0;
  v[4] = right.y; v[5] = up.y; v[6] = -fwd.y; v[7] = 0;
  v[8] = right.z; v[9] = up.z; v[10] = -fwd.z; v[11] = 0;
  v[12] = -dot3(right, eye); v[13] = -dot3(up, eye); v[14] = dot3(fwd, eye); v[15] = 1;
  p[0] = f / aspect; p[1] = 0; p[2] = 0; p[3] = 0;
  p[4] = 0; p[5] = f; p[6] = 0; p[7] = 0;
  p[8] = 0; p[9] = 0; p[10] = (far + near) / (near - far); p[11] = -1;
  p[12] = 0; p[13] = 0; p[14] = 2 * far * near / (near - far); p[15] = 0;
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += at(p, k * 4 + r) * at(v, c * 4 + k);
    s.mvp[c * 4 + r] = sum;
  }
  s.eyeDir[0] = fwd.x; s.eyeDir[1] = fwd.y; s.eyeDir[2] = fwd.z;
}

function orbit(cam: Cam, dx: number, dy: number): void {
  cam.yaw -= dx * 0.008;
  cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.008));
}

export function orbitAbout(cam: Cam, fr: Frame, px: number, py: number, pz: number, dx: number, dy: number): void {
  camFrame(cam, fr);
  const ox = cam.target.x - px, oy = cam.target.y - py, oz = cam.target.z - pz;
  const a = ox * fr.right.x + oy * fr.right.y + oz * fr.right.z;
  const b = ox * fr.up.x + oy * fr.up.y + oz * fr.up.z;
  const c = ox * fr.fwd.x + oy * fr.fwd.y + oz * fr.fwd.z;
  orbit(cam, dx, dy);
  camFrame(cam, fr);
  cam.target.x = px + a * fr.right.x + b * fr.up.x + c * fr.fwd.x;
  cam.target.y = py + a * fr.right.y + b * fr.up.y + c * fr.fwd.y;
  cam.target.z = pz + a * fr.right.z + b * fr.up.z + c * fr.fwd.z;
}

export function zoomAbout(cam: Cam, qx: number, qy: number, qz: number, k: number): void {
  cam.target.x = qx + (cam.target.x - qx) * k;
  cam.target.y = qy + (cam.target.y - qy) * k;
  cam.target.z = qz + (cam.target.z - qz) * k;
  cam.dist *= k;
}

export function pan(cam: Cam, fr: Frame, dx: number, dy: number, clientHeight: number): void {
  camFrame(cam, fr);
  const k = 2 * cam.dist * Math.tan(cam.fov / 2) / clientHeight;
  cam.target.x = cam.target.x + (fr.right.x * (-dx * k) + fr.up.x * (dy * k));
  cam.target.y = cam.target.y + (fr.right.y * (-dx * k) + fr.up.y * (dy * k));
  cam.target.z = cam.target.z + (fr.right.z * (-dx * k) + fr.up.z * (dy * k));
}

function bindAttr(gl: WebGLRenderingContext, location: number, buffer: WebGLBuffer | undefined, size: number): void {
  if (location < 0) return;
  if (buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  } else gl.disableVertexAttribArray(location);
}

function drawFlat(r: Renderer, buf: Buf | null, color: Float32Array, mode: number, depth: boolean, bold: boolean): void {
  if (!buf || !buf.count) return;
  const gl = r.gl, loc = r.loc;
  bindAttr(gl, loc.p, buf.p, 3); bindAttr(gl, loc.n, buf.n, 3); bindAttr(gl, loc.f, buf.f, 1);
  if (loc.c >= 0) { gl.disableVertexAttribArray(loc.c); gl.vertexAttrib3fv(loc.c, color); }
  if (loc.f >= 0) gl.vertexAttrib1f(loc.f, -100);
  if (depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  if (!bold || mode !== gl.LINES) { gl.drawArrays(mode, 0, buf.count); return; }
  const sx = 2 * (window.devicePixelRatio || 1) / r.canvas.width, sy = 2 * (window.devicePixelRatio || 1) / r.canvas.height;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    gl.uniform2f(loc.off, i * sx * 0.75, j * sy * 0.75);
    gl.drawArrays(mode, 0, buf.count);
  }
  gl.uniform2f(loc.off, 0, 0);
}

export function draw(r: Renderer): void {
  const gl = r.gl, canvas = r.canvas, loc = r.loc;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.992, 0.992, 0.988, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!r.hasModel) return;
  computeMatrices(r.cam, r.scratch, canvas.width / canvas.height, r.center, r.modelRadius);
  gl.useProgram(r.prog);
  gl.uniformMatrix4fv(loc.mvp, false, r.scratch.mvp);
  gl.uniform3fv(loc.eyeDir, r.scratch.eyeDir);
  gl.uniform1f(loc.selA, r.selA);
  gl.uniform1f(loc.selB, r.selB);
  gl.uniform1f(loc.hov, r.hover);
  gl.uniform3fv(loc.hovCol, r.hoverColor);
  gl.uniform2f(loc.off, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1);
  const b = r.faces;
  if (!b) return;
  bindAttr(gl, loc.p, b.p, 3); bindAttr(gl, loc.n, b.n, 3); bindAttr(gl, loc.c, b.c, 3); bindAttr(gl, loc.f, b.f, 1);
  gl.uniform1f(loc.lit, 1);
  gl.drawArrays(gl.TRIANGLES, 0, b.count);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.uniform1f(loc.lit, 0);
  drawFlat(r, r.edges, r.edgeColor, gl.LINES, true, false);
  for (let i = 0; i < r.overlays.length; i++) {
    const o = r.overlays[i];
    if (o) drawFlat(r, o.buf, o.color, o.mode, false, true);
  }
}
