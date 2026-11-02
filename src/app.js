// ap242-gauge browser app: load STEP, show it with WebGL, pick features, show measurements.
(function () {
  'use strict';
  const { sub, add, scale, dot, cross, len, norm } = Geom.vec;
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const setStatus = (t) => { statusEl.textContent = t; };

  // ---------- occt-import-js from the inlined, gzip-compressed wasm ----------
  async function loadOcct() {
    const bin = atob(window.OCCT_WASM_GZ_B64);
    const gz = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
    const wasmBinary = new Uint8Array(await new Response(stream).arrayBuffer());
    return occtimportjs({ wasmBinary });
  }
  const occtReady = loadOcct().then((o) => { setStatus('Ready. Open a STEP file.'); return o; },
    (e) => { setStatus('Cannot start the STEP reader: ' + e); throw e; });

  // ---------- model state ----------
  let model = null; // { name, unit, faces, fits[], triFace (Int32Array), tri (Float32Array), center, radius }
  let picks = [];   // up to 2: { face, mode, fit, feature, hit, label }

  async function openFile(file) {
    setStatus('Reading ' + file.name + '...');
    const occt = await occtReady;
    const buf = new Uint8Array(await file.arrayBuffer());
    const unit = Geom.parseStepLengthUnit(new TextDecoder('latin1').decode(buf));
    await new Promise((r) => setTimeout(r, 30)); // let the status text paint
    const t0 = performance.now();
    const result = occt.ReadStepFile(buf, { linearUnit: unit.occt });
    if (!result.success || !result.meshes.length) { setStatus('occt-import-js could not read ' + file.name); return; }
    const faces = Geom.extractFaces(result);
    setModel(file.name, unit, faces, result.meshes);
    setStatus(file.name + ': ' + result.meshes.length + ' part mesh(es), ' + faces.length + ' faces, unit ' +
      unit.label + ' (' + Math.round(performance.now() - t0) + ' ms)');
  }

  function setModel(name, unit, faces, meshes) {
    let nt = 0;
    for (const f of faces) nt += f.tri.length / 9;
    const tri = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9), col = new Float32Array(nt * 9);
    const fid = new Float32Array(nt * 3), triFace = new Int32Array(nt);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let t = 0;
    for (const f of faces) {
      const c = (meshes[f.mesh] && meshes[f.mesh].color) || [0.72, 0.75, 0.8];
      for (let k = 0; k < f.tri.length / 9; k++, t++) {
        const a = [f.tri[k * 9], f.tri[k * 9 + 1], f.tri[k * 9 + 2]];
        const n = norm(cross(sub([f.tri[k * 9 + 3], f.tri[k * 9 + 4], f.tri[k * 9 + 5]], a),
          sub([f.tri[k * 9 + 6], f.tri[k * 9 + 7], f.tri[k * 9 + 8]], a)));
        for (let j = 0; j < 9; j++) {
          tri[t * 9 + j] = f.tri[k * 9 + j];
          nrm[t * 9 + j] = n[j % 3];
          col[t * 9 + j] = c[j % 3];
          lo[j % 3] = Math.min(lo[j % 3], f.tri[k * 9 + j]);
          hi[j % 3] = Math.max(hi[j % 3], f.tri[k * 9 + j]);
        }
        fid[t * 3] = fid[t * 3 + 1] = fid[t * 3 + 2] = f.id;
        triFace[t] = f.id;
      }
    }
    model = { name, unit, faces, fits: [], tri, triFace,
      center: scale(add(lo, hi), 0.5), radius: Math.max(len(sub(hi, lo)) / 2, 1e-9) };
    picks = [];
    $('drop').classList.add('hidden');
    $('unit').textContent = 'Length unit from file: ' + unit.label;
    uploadModel(tri, nrm, col, fid, faces);
    fitView();
    showPicks();
  }

  const fitOf = (id) => model.fits[id] || (model.fits[id] = Geom.fitFace(model.faces[id]));

  // ---------- WebGL ----------
  const canvas = $('gl');
  const gl = canvas.getContext('webgl', { antialias: true });
  const VS = `attribute vec3 p; attribute vec3 n; attribute vec3 c; attribute float f;
    uniform mat4 mvp; uniform float selA, selB; varying vec3 vn; varying vec3 vc;
    void main(){ gl_Position = mvp*vec4(p,1.0); vn = n;
      vc = abs(f-selA)<0.5 ? vec3(0.91,0.45,0.05) : abs(f-selB)<0.5 ? vec3(0.12,0.44,0.82) : c; gl_PointSize = 9.0; }`;
  const FS = `precision mediump float; varying vec3 vn; varying vec3 vc; uniform vec3 eyeDir; uniform float lit;
    void main(){ float d = abs(dot(normalize(vn), eyeDir));
      gl_FragColor = vec4(lit > 0.5 ? vc*(0.35+0.65*d) : vc, 1.0); }`;
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  const loc = {};
  for (const a of ['p', 'n', 'c', 'f']) loc[a] = gl.getAttribLocation(prog, a);
  for (const u of ['mvp', 'selA', 'selB', 'eyeDir', 'lit']) loc[u] = gl.getUniformLocation(prog, u);
  const buffers = { faces: null, edges: null, overlay: null };

  function makeBuf(arrays, count) {
    const out = { count };
    for (const k in arrays) {
      out[k] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, out[k]);
      gl.bufferData(gl.ARRAY_BUFFER, arrays[k], gl.STATIC_DRAW);
    }
    return out;
  }
  function freeBuf(b) { if (b) for (const k of ['p', 'n', 'c', 'f']) if (b[k]) gl.deleteBuffer(b[k]); }

  function uploadModel(tri, nrm, col, fid, faces) {
    freeBuf(buffers.faces); freeBuf(buffers.edges);
    buffers.faces = makeBuf({ p: tri, n: nrm, c: col, f: fid }, tri.length / 3);
    // Feature edges: the boundary segments of each face.
    const seg = [];
    for (const f of faces) {
      const count = new Map(), key = (i) => [f.tri[i * 3], f.tri[i * 3 + 1], f.tri[i * 3 + 2]].map((x) => x.toFixed(6)).join(',');
      for (let t = 0; t < f.tri.length / 9; t++) {
        for (let k = 0; k < 3; k++) {
          const a = t * 3 + k, b = t * 3 + (k + 1) % 3, ka = key(a), kb = key(b);
          if (ka === kb) continue;
          const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          const e = count.get(ek);
          if (e) e.n++; else count.set(ek, { n: 1, a, b });
        }
      }
      for (const e of count.values()) if (e.n === 1) {
        for (const i of [e.a, e.b]) seg.push(f.tri[i * 3], f.tri[i * 3 + 1], f.tri[i * 3 + 2]);
      }
    }
    buffers.edges = makeBuf({ p: new Float32Array(seg) }, seg.length / 3);
  }

  // Camera: Z up, orbit around target.
  const cam = { target: [0, 0, 0], dist: 10, yaw: -0.8, pitch: 0.5, fov: 35 * Math.PI / 180 };
  function fitView() {
    if (!model) return;
    cam.target = model.center.slice();
    cam.dist = model.radius / Math.sin(cam.fov / 2) * 1.1;
    draw();
  }
  function camFrame() {
    const cp = Math.cos(cam.pitch);
    const back = [cp * Math.cos(cam.yaw), cp * Math.sin(cam.yaw), Math.sin(cam.pitch)];
    const eye = add(cam.target, scale(back, cam.dist));
    const fwd = scale(back, -1);
    const right = norm(cross(fwd, [0, 0, 1]));
    const up = cross(right, fwd);
    return { eye, fwd, right, up };
  }
  function matrices() {
    const { eye, fwd, right, up } = camFrame();
    const aspect = canvas.width / canvas.height;
    const R = model ? model.radius : 1;
    const near = Math.max(cam.dist - 2 * R, cam.dist * 1e-3), far = cam.dist + 2 * R;
    const f = 1 / Math.tan(cam.fov / 2);
    // view (column-major)
    const v = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0,
      -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1];
    const p = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    const m = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += p[k * 4 + r] * v[c * 4 + k]; m[c * 4 + r] = s;
    }
    return { mvp: m, fwd };
  }

  function bindAttr(b, name, size) {
    if (loc[name] < 0) return;
    if (b[name]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b[name]);
      gl.enableVertexAttribArray(loc[name]);
      gl.vertexAttribPointer(loc[name], size, gl.FLOAT, false, 0, 0);
    } else gl.disableVertexAttribArray(loc[name]);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.957, 0.961, 0.969, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!model) return;
    const { mvp, fwd } = matrices();
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.mvp, false, mvp);
    gl.uniform3fv(loc.eyeDir, fwd);
    const selFace = (i) => (picks[i] && picks[i].mode === 'face' ? picks[i].face : -10);
    gl.uniform1f(loc.selA, selFace(0));
    gl.uniform1f(loc.selB, selFace(1));
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    const b = buffers.faces;
    bindAttr(b, 'p', 3); bindAttr(b, 'n', 3); bindAttr(b, 'c', 3); bindAttr(b, 'f', 1);
    gl.uniform1f(loc.lit, 1);
    gl.drawArrays(gl.TRIANGLES, 0, b.count);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // Edges and overlays use constant attributes for normal, colour and face id.
    gl.uniform1f(loc.lit, 0);
    const flat = (buf, color, mode, depth) => {
      if (!buf || !buf.count) return;
      bindAttr(buf, 'p', 3); bindAttr(buf, 'n', 3); bindAttr(buf, 'f', 1);
      if (loc.c >= 0) { gl.disableVertexAttribArray(loc.c); gl.vertexAttrib3fv(loc.c, color); }
      if (loc.f >= 0) gl.vertexAttrib1f(loc.f, -100);
      if (depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(mode, 0, buf.count);
    };
    flat(buffers.edges, [0.15, 0.17, 0.2], gl.LINES, true);
    for (const o of overlays) flat(o.buf, o.color, o.mode, false);
  }
  let overlays = [];
  let drawQueued = false;
  const requestDraw = () => { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); } };
  window.addEventListener('resize', requestDraw);

  // ---------- mouse ----------
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pan: e.button === 2 || e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !model) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const { right, up } = camFrame();
      const k = 2 * cam.dist * Math.tan(cam.fov / 2) / canvas.clientHeight;
      cam.target = add(cam.target, add(scale(right, -dx * k), scale(up, dy * k)));
    } else {
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.008));
    }
    requestDraw();
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (d && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4 && e.button === 0 && !e.shiftKey) pickAt(e);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist *= Math.exp(e.deltaY * 0.001);
    requestDraw();
  }, { passive: false });

  // ---------- picking ----------
  function rayAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1, y = 1 - ((clientY - r.top) / r.height) * 2;
    const { eye, fwd, right, up } = camFrame();
    const t = Math.tan(cam.fov / 2), aspect = r.width / r.height;
    return { o: eye, d: norm(add(fwd, add(scale(right, x * t * aspect), scale(up, y * t)))) };
  }
  // Nearest triangle hit (Moller-Trumbore) over the whole model.
  function raycast(ray) {
    const T = model.tri; let best = Infinity, bestT = -1;
    const [ox, oy, oz] = ray.o, [dx, dy, dz] = ray.d;
    for (let t = 0, n = T.length / 9; t < n; t++) {
      const i = t * 9;
      const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2];
      const e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-20) continue;
      const inv = 1 / det, sx = ox - T[i], sy = oy - T[i + 1], sz = oz - T[i + 2];
      const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
      const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (d > 0 && d < best) { best = d; bestT = t; }
    }
    if (bestT < 0) return null;
    return { tri: bestT, face: model.triFace[bestT], point: add(ray.o, scale(ray.d, best)) };
  }

  const mode = () => document.querySelector('input[name=mode]:checked').value;

  function pickAt(e) {
    if (!model) return;
    const hit = raycast(rayAt(e.clientX, e.clientY));
    if (!hit) return;
    const m = mode();
    let fit, feature, hitPoint = hit.point;
    if (m === 'face') {
      fit = fitOf(hit.face);
      feature = Geom.featureFrom(fit);
    } else if (m === 'edge') {
      fit = Geom.faceEdge(model.faces[hit.face], hit.point);
      if (!fit) { setStatus('This face has no boundary edge near the click.'); return; }
      feature = Geom.featureFrom(fit);
    } else {
      // Snap to the nearest vertex of the hit triangle.
      const T = model.tri, i = hit.tri * 9;
      let best = null, bd = Infinity;
      for (let k = 0; k < 3; k++) {
        const p = [T[i + k * 3], T[i + k * 3 + 1], T[i + k * 3 + 2]], d = len(sub(p, hit.point));
        if (d < bd) { bd = d; best = p; }
      }
      // Use the double-precision vertex of the face, not the Float32 copy.
      const f = model.faces[hit.face];
      let bestD = Infinity, bestP = best;
      for (let j = 0; j < f.tri.length; j += 3) {
        const p = [f.tri[j], f.tri[j + 1], f.tri[j + 2]], d = len(sub(p, best));
        if (d < bestD) { bestD = d; bestP = p; }
      }
      fit = { type: 'vertex', point: bestP, rms: null };
      feature = { kind: 'point', point: bestP };
      hitPoint = bestP;
    }
    if (picks.length >= 2) picks = [];
    picks.push({ face: hit.face, mode: m, fit, feature, hit: hitPoint });
    showPicks();
  }

  // ---------- overlays and panel ----------
  function overlayFor(p, color) {
    const seg = [], pts = [];
    const f = p.fit, size = model.radius * 0.6;
    if (p.feature.kind === 'axis') {
      const L = f.type === 'line' ? f.length / 2 + size * 0.1 : Math.max(size * 0.5, (f.size || 0) * 0.6);
      seg.push(...add(f.point, scale(p.feature.dir, -L)), ...add(f.point, scale(p.feature.dir, L)));
    }
    if (f.type === 'circle') {
      const d = p.feature.dir, t = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = norm(cross(d, t)), v = cross(d, u);
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
    const out = [];
    if (seg.length) out.push({ buf: makeBuf({ p: new Float32Array(seg) }, seg.length / 3), color, mode: gl.LINES });
    out.push({ buf: makeBuf({ p: new Float32Array(pts) }, pts.length / 3), color, mode: gl.POINTS });
    return out;
  }

  const fmtLen = (x) => x.toFixed(model.unit.label === 'in' ? 5 : 4) + ' ' + model.unit.label;
  const fmtVec = (v) => '(' + v.map((x) => x.toFixed(4)).join(', ') + ')';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  function describe(p) {
    const f = p.fit, lines = [];
    const rms = f.rms == null ? '' : ', fit rms ' + fmtLen(f.rms);
    switch (f.type) {
      case 'plane': lines.push('Plane (face ' + p.face + rms + ')', 'normal ' + fmtVec(f.normal)); break;
      case 'cylinder': lines.push('Cylinder (face ' + p.face + rms + ')', 'diameter ' + fmtLen(2 * f.radius) +
        ', radius ' + fmtLen(f.radius), 'axis ' + fmtVec(f.dir)); break;
      case 'line': lines.push('Line edge (face ' + p.face + ')', 'length ' + fmtLen(f.length), 'direction ' + fmtVec(f.dir)); break;
      case 'circle': lines.push('Circle edge (face ' + p.face + rms + ')', 'diameter ' + fmtLen(2 * f.radius) +
        ', radius ' + fmtLen(f.radius), 'centre ' + fmtVec(f.point)); break;
      case 'vertex': lines.push('Point', fmtVec(f.point)); break;
      case 'polyline': lines.push('Curved edge (no line or circle fit): its mid point is used', fmtVec(f.point)); break;
      default: lines.push('Surface (face ' + p.face + ': not a plane or a cylinder): its centroid is used', fmtVec(f.point));
    }
    return lines;
  }

  function showPicks() {
    for (const o of overlays) freeBuf(o.buf);
    overlays = [];
    const feats = $('feats'), meas = $('meas');
    feats.innerHTML = ''; meas.innerHTML = '';
    picks.forEach((p, i) => {
      overlays.push(...overlayFor(p, i === 0 ? [0.91, 0.45, 0.05] : [0.12, 0.44, 0.82]));
      const lines = describe(p);
      feats.insertAdjacentHTML('beforeend', '<div class="feat ' + (i ? 'b' : 'a') + '"><b>' + (i ? 'B: ' : 'A (reference): ') +
        esc(lines[0]) + '</b>' + lines.slice(1).map(esc).join('<br>') + '</div>');
    });
    const rows = [];
    if (picks.length === 2) {
      for (const m of Geom.measure(picks[0].feature, picks[1].feature)) {
        rows.push([m.label, m.type === 'angle' ? m.value.toFixed(4) + ' °' : fmtLen(m.value)]);
      }
      const d = sub(picks[1].hit, picks[0].hit);
      rows.push(['point to point (pick points)', fmtLen(len(d))]);
      rows.push(['dx, dy, dz', d.map((x) => x.toFixed(4)).join(', ')]);
    } else if (picks.length === 1) {
      const f = picks[0].fit;
      if (f.radius) rows.push(['diameter', fmtLen(2 * f.radius)], ['radius', fmtLen(f.radius)]);
      rows.push(['', 'Pick feature B to measure from A.']);
    }
    meas.innerHTML = rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="v">' + esc(r[1]) + '</td></tr>').join('');
    requestDraw();
  }

  // ---------- UI wiring ----------
  $('file').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]).catch((x) => setStatus(String(x))); });
  $('fit').addEventListener('click', fitView);
  $('clear').addEventListener('click', () => { picks = []; showPicks(); });
  $('lic').addEventListener('click', () => { const l = $('licences'); l.style.display = l.style.display === 'block' ? 'none' : 'block'; });
  const drop = $('drop');
  window.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  window.addEventListener('dragleave', () => drop.classList.remove('over'));
  window.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) openFile(f).catch((x) => setStatus(String(x)));
  });
  draw();

  // Hooks for automated browser checks.
  window.ap242gauge = {
    openFile, pickAt: (x, y) => pickAt({ clientX: x, clientY: y }),
    setView(yaw, pitch) { cam.yaw = yaw; cam.pitch = pitch; fitView(); },
    project(p) { // model point -> client coordinates
      const { mvp } = matrices(), r = canvas.getBoundingClientRect();
      const c = [0, 1, 2, 3].map((i) => mvp[i] * p[0] + mvp[4 + i] * p[1] + mvp[8 + i] * p[2] + mvp[12 + i]);
      return [r.left + (c[0] / c[3] + 1) / 2 * r.width, r.top + (1 - c[1] / c[3]) / 2 * r.height];
    },
    get picks() { return picks; },
    get model() { return model; },
    measurements: () => [...$('meas').querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent)),
  };
})();
