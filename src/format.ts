import { len, sub } from './geom.ts';
import type { Fit, LengthUnit, Measurement, Vec3 } from './geom.ts';
import { measure } from './geom.ts';
import type { Picks } from './picks.ts';

const fmtLen = (unit: LengthUnit, x: number): string => x.toFixed(unit.label === 'in' ? 5 : 4) + ' ' + unit.label;
const fmtVec = (v: Vec3): string => '(' + v.map((x) => x.toFixed(4)).join(', ') + ')';

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => HTML_ESCAPES[c] ?? c);

export function describe(face: number, f: Fit, unit: LengthUnit): string[] {
  const rms = f.rms === null ? '' : ', fit rms ' + fmtLen(unit, f.rms);
  switch (f.type) {
    case 'plane': return ['Plane (face ' + face + rms + ')', 'normal ' + fmtVec(f.normal)];
    case 'cylinder': return ['Cylinder (face ' + face + rms + ')', 'diameter ' + fmtLen(unit, 2 * f.radius) +
      ', radius ' + fmtLen(unit, f.radius), 'axis ' + fmtVec(f.dir)];
    case 'line': return ['Line edge (face ' + face + ')', 'length ' + fmtLen(unit, f.length), 'direction ' + fmtVec(f.dir)];
    case 'circle': return ['Circle edge (face ' + face + rms + ')', 'diameter ' + fmtLen(unit, 2 * f.radius) +
      ', radius ' + fmtLen(unit, f.radius), 'centre ' + fmtVec(f.point)];
    case 'vertex': return ['Point', fmtVec(f.point)];
    case 'polyline': return ['Curved edge (no line or circle fit): its mid point is used', fmtVec(f.point)];
    case 'surface': return ['Surface (face ' + face + ': not a plane or a cylinder): its centroid is used', fmtVec(f.point)];
  }
}

function measurementText(m: Measurement, unit: LengthUnit): string {
  return m.type === 'angle' ? m.value.toFixed(4) + ' °' : fmtLen(unit, m.value);
}

export function measureRows(picks: Picks, unit: LengthUnit): [string, string][] {
  const rows: [string, string][] = [];
  if (picks.length === 2) {
    const [a, b] = picks;
    for (const m of measure(a.feature, b.feature)) rows.push([m.label, measurementText(m, unit)]);
    const d = sub(b.hit, a.hit);
    rows.push(['point to point (pick points)', fmtLen(unit, len(d))]);
    rows.push(['dx, dy, dz', d.map((x) => x.toFixed(4)).join(', ')]);
  } else if (picks.length === 1) {
    const f = picks[0].fit;
    if (f.type === 'cylinder' || f.type === 'circle') rows.push(['diameter', fmtLen(unit, 2 * f.radius)], ['radius', fmtLen(unit, f.radius)]);
    rows.push(['', 'Pick feature B to measure from A.']);
  }
  return rows;
}
