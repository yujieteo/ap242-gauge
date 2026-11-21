import { add, scale } from './geom.ts';
import type { Vec3 } from './geom.ts';
import { at } from './util.ts';

export type Hit = { readonly tri: number; readonly face: number; readonly point: Vec3 };
export type Ray = { readonly o: Vec3; readonly d: Vec3 };

export function raycast(T: Float32Array, triFace: Int32Array, ray: Ray): Hit | null {
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
  return { tri: bestT, face: at(triFace, bestT), point: add(ray.o, scale(ray.d, best)) };
}
