import { must } from './util.ts';
import type { Buf, Locations, Renderer } from './render.hot.ts';

const VS = `attribute vec3 p; attribute vec3 n; attribute vec3 c; attribute float f;
    uniform mat4 mvp; uniform float selA, selB, hov; uniform vec3 hovCol; uniform vec2 off; varying vec3 vn; varying vec3 vc;
    void main(){ gl_Position = mvp*vec4(p,1.0); gl_Position.xy += off*gl_Position.w; vn = n;
      vc = abs(f-selA)<0.5 ? vec3(0.91,0.45,0.05) : abs(f-selB)<0.5 ? vec3(0.12,0.44,0.82) : abs(f-hov)<0.5 ? mix(c, hovCol, 0.45) : c;
      gl_PointSize = 9.0; }`;
const FS = `precision mediump float; varying vec3 vn; varying vec3 vc; uniform vec3 eyeDir; uniform float lit;
    void main(){ float d = abs(dot(normalize(vn), eyeDir));
      gl_FragColor = vec4(lit > 0.5 ? vc*(0.35+0.65*d) : vc, 1.0); }`;

export const NO_SELECTION = -10;

function shader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = must(gl.createShader(type), 'WebGL shader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
  return s;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = must(canvas.getContext('webgl', { antialias: true }), 'WebGL context');
  const prog = must(gl.createProgram(), 'WebGL program');
  gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  const loc: Locations = {
    p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'),
    c: gl.getAttribLocation(prog, 'c'), f: gl.getAttribLocation(prog, 'f'),
    mvp: gl.getUniformLocation(prog, 'mvp'), selA: gl.getUniformLocation(prog, 'selA'),
    selB: gl.getUniformLocation(prog, 'selB'), eyeDir: gl.getUniformLocation(prog, 'eyeDir'),
    lit: gl.getUniformLocation(prog, 'lit'), hov: gl.getUniformLocation(prog, 'hov'), hovCol: gl.getUniformLocation(prog, 'hovCol'), off: gl.getUniformLocation(prog, 'off'),
  };
  const vec = (): { x: number; y: number; z: number } => ({ x: 0, y: 0, z: 0 });
  return {
    gl, canvas, prog, loc,
    cam: { target: vec(), dist: 10, yaw: -0.8, pitch: 0.5, fov: 35 * Math.PI / 180 },
    scratch: {
      frame: { eye: vec(), fwd: vec(), right: vec(), up: vec() },
      view: new Float64Array(16), proj: new Float64Array(16), mvp: new Float32Array(16), eyeDir: new Float32Array(3),
    },
    edgeColor: new Float32Array([0.13, 0.125, 0.11]), hoverColor: new Float32Array([0.91, 0.45, 0.05]), center: vec(),
    faces: null, edges: null, overlays: [], hasModel: false, modelRadius: 1, selA: NO_SELECTION, selB: NO_SELECTION, hover: NO_SELECTION,
  };
}

export type Arrays = { p: Float32Array; n?: Float32Array; c?: Float32Array; f?: Float32Array };

function upload(gl: WebGLRenderingContext, data: Float32Array): WebGLBuffer {
  const b = must(gl.createBuffer(), 'WebGL buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return b;
}

export function makeBuf(gl: WebGLRenderingContext, arrays: Arrays, count: number): Buf {
  const out: Buf = { count, p: upload(gl, arrays.p) };
  if (arrays.n) out.n = upload(gl, arrays.n);
  if (arrays.c) out.c = upload(gl, arrays.c);
  if (arrays.f) out.f = upload(gl, arrays.f);
  return out;
}

export function freeBuf(gl: WebGLRenderingContext, b: Buf | null): void {
  if (!b) return;
  for (const buffer of [b.p, b.n, b.c, b.f]) if (buffer) gl.deleteBuffer(buffer);
}
