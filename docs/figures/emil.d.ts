export type Pt = readonly [number, number];
export type Panel = { readonly panel: unique symbol };
export type Gray = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200;
export type Hue = 'blue' | 'sky' | 'grass' | 'amber' | 'orange' | 'tomato' | 'violet';
export type Shade = 3 | 7 | 9 | 11;
export type Stroke = { readonly stroke?: string; readonly width?: number; readonly dash?: string; readonly join?: 'round' };
export type Shape = Stroke & { readonly fill?: string };
export type ArrowStyle = { readonly stroke: string; readonly width: number; readonly head: number; readonly headWidth: number };
export type TextStyle = {
  readonly size: number;
  readonly color: string;
  readonly weight?: number;
  readonly anchor?: 'start' | 'middle' | 'end';
  readonly lineGap?: number;
};
export interface Layout {
  text(p: Panel, x: number, y: number, s: string, style: TextStyle): void;
  polygon(p: Panel, pts: readonly Pt[], style: Shape): void;
  circle(p: Panel, cx: number, cy: number, r: number, style: Shape): void;
  line(p: Panel, a: Pt, b: Pt, style: Stroke): void;
  arrow(p: Panel, a: Pt, b: Pt, style: ArrowStyle): void;
}
export interface Figure {
  panel(label: string, box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): Panel;
}
export const gray: Readonly<Record<Gray, string>>;
export const hue: Readonly<Record<Hue, Readonly<Record<Shade, string>>>>;
export const weight: { readonly name: number; readonly text: number; readonly title: number };
export function useEmil(F: Figure, L: Layout, venue: 'web'): {
  readonly line: Readonly<Record<'hair' | 'thin' | 'normal' | 'bold', number>>;
  readonly text: Readonly<Record<'label' | 'title', number>>;
};
export function emilTheme(F: Figure): void;
