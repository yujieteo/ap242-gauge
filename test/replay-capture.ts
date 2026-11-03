import { appendFileSync } from 'node:fs';

const captureFile = process.env['AP242_REPLAY_CAPTURE'];

function plain(_key: string, value: unknown): unknown {
  if (value instanceof Float64Array || value instanceof Float32Array || value instanceof Uint32Array || value instanceof Int32Array ||
    value instanceof Uint16Array || value instanceof Int16Array || value instanceof Uint8Array || value instanceof Int8Array) return Array.from(value);
  return value;
}

export function capture(fn: string, input: unknown): void {
  if (captureFile) appendFileSync(captureFile, JSON.stringify({ fn, input }, plain) + '\n');
}
