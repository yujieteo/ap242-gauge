import { expect, test } from 'bun:test';
import { describe, measureRows } from '../src/format.ts';
import type { Pick } from '../src/picks.ts';
import type { Face } from '../src/geom.ts';
import { vertexAt } from '../src/geom.ts';
import { load, MODEL_INCH, MODEL_MM } from './models.ts';
import { faceEdge, featureFrom, fitFace } from './subject.ts';

const FACES_PER_MODEL = 40;

function pickOf(face: Face, mode: 'face' | 'edge'): Pick | null {
  const hit = vertexAt(face.tri, 0);
  const fit = mode === 'face' ? fitFace(face) : faceEdge(face, hit);
  return fit ? { face: face.id, mode, fit, feature: featureFrom(fit), hit } : null;
}

async function panelText(file: string): Promise<string> {
  const { unit, faces } = await load(file);
  const lines: string[] = ['unit ' + unit.label];
  const picks: Pick[] = [];
  for (const face of faces.slice(0, FACES_PER_MODEL)) {
    for (const mode of ['face', 'edge'] as const) {
      const pick = pickOf(face, mode);
      if (!pick) continue;
      picks.push(pick);
      lines.push(describe(pick.face, pick.fit, unit).join(' | '));
      for (const [label, text] of measureRows([pick], unit)) lines.push('  ' + label + ': ' + text);
    }
  }
  for (let i = 0; i + 1 < picks.length; i += 2) {
    const a = picks[i], b = picks[i + 1];
    if (!a || !b) continue;
    lines.push('A=' + a.face + ':' + a.mode + ' B=' + b.face + ':' + b.mode);
    for (const [label, text] of measureRows([a, b], unit)) lines.push('  ' + label + ': ' + text);
  }
  return lines.join('\n') + '\n';
}

test('panel text of the first faces of the NIST CTC 01 model (mm)', async () => {
  expect(await panelText(MODEL_MM)).toMatchSnapshot();
});

test('panel text of the first faces of the NIST CTC 05 model (inch)', async () => {
  expect(await panelText(MODEL_INCH)).toMatchSnapshot();
});
