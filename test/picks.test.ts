import { expect, test } from 'bun:test';
import { nextPicks, parsePickMode } from '../src/picks.ts';
import type { Pick, Picks, PicksEvent } from '../src/picks.ts';

const pick = (face: number): Pick => ({ face, mode: 'face', fit: { type: 'vertex', point: [0, 0, 0], rms: null }, feature: { kind: 'point', point: [0, 0, 0] }, hit: [0, 0, 0] });
const [p1, p2, p3] = [pick(1), pick(2), pick(3)];

const STATES: readonly { name: string; state: Picks }[] = [
  { name: 'none', state: [] },
  { name: 'one', state: [p1] },
  { name: 'two', state: [p1, p2] },
];

const EVENTS: readonly { name: string; event: PicksEvent; after: Record<string, Picks> }[] = [
  { name: 'pick', event: { kind: 'pick', pick: p3 }, after: { none: [p3], one: [p1, p3], two: [p3] } },
  { name: 'clear', event: { kind: 'clear' }, after: { none: [], one: [], two: [] } },
  { name: 'load', event: { kind: 'load' }, after: { none: [], one: [], two: [] } },
];

for (const { name: stateName, state } of STATES) {
  for (const { name: eventName, event, after } of EVENTS) {
    test('picks: ' + eventName + ' in state ' + stateName, () => {
      expect(nextPicks(state, event)).toEqual(after[stateName] ?? []);
    });
  }
}

test('picks: a third click starts again with the new pick', () => {
  expect(nextPicks(nextPicks(nextPicks([], { kind: 'pick', pick: p1 }), { kind: 'pick', pick: p2 }), { kind: 'pick', pick: p3 })).toEqual([p3]);
});

test('pick mode parser rejects unknown values', () => {
  expect(parsePickMode('edge')).toBe('edge');
  expect(() => parsePickMode('vertex')).toThrow();
});
