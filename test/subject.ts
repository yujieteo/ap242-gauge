import * as geom from '../src/geom.ts';
import type { Face, Feature, MeshGeometry, Vec3 } from '../src/geom.ts';
import { capture } from './replay-capture.ts';

export const parseStepLengthUnit = (text: string): geom.LengthUnit => {
  capture('parseStepLengthUnit', text);
  return geom.parseStepLengthUnit(text);
};
export const extractFaces = (meshes: readonly MeshGeometry[]): Face[] => {
  capture('extractFaces', meshes);
  return geom.extractFaces(meshes);
};
export const fitFace = (face: Face): geom.FaceFit => {
  capture('fitFace', face);
  return geom.fitFace(face);
};
export const faceEdge = (face: Face, hit: Vec3): geom.EdgeFit | null => {
  capture('faceEdge', { face, hit });
  return geom.faceEdge(face, hit);
};
export const measure = (a: Feature, b: Feature): geom.Measurement[] => {
  capture('measure', { a, b });
  return geom.measure(a, b);
};
export const featureFrom = geom.featureFrom;
