import type { Feature, Fit, Vec3 } from './geom.ts';

export type PickMode = 'face' | 'edge' | 'point';
export type Pick = {
  readonly face: number;
  readonly mode: PickMode;
  readonly fit: Fit;
  readonly feature: Feature;
  readonly hit: Vec3;
};

export type Picks = readonly [] | readonly [Pick] | readonly [Pick, Pick];
export type PicksEvent =
  | { readonly kind: 'pick'; readonly pick: Pick }
  | { readonly kind: 'remove'; readonly index: 0 | 1 }
  | { readonly kind: 'swap' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'load' };

export function nextPicks(state: Picks, event: PicksEvent): Picks {
  switch (event.kind) {
    case 'pick': return state.length === 0 ? [event.pick] : [state[0], event.pick];
    case 'remove': return state.length === 2 ? [state[event.index === 0 ? 1 : 0]] : state.length === 1 && event.index === 0 ? [] : state;
    case 'swap': return state.length === 2 ? [state[1], state[0]] : state;
    case 'clear':
    case 'load': return [];
  }
}

export function parsePickMode(value: string): PickMode {
  if (value === 'face' || value === 'edge' || value === 'point') return value;
  throw new Error('unknown pick mode ' + value);
}
