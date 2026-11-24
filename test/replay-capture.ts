import { appendFileSync } from 'node:fs';

const captureFile = process.env['AP242_REPLAY_CAPTURE'];

const isTypedArray = (value: unknown): value is ArrayLike<number> => ArrayBuffer.isView(value) && !(value instanceof DataView);

function plain(_key: string, value: unknown): unknown {
  if (isTypedArray(value)) return Array.from(value);
  return value;
}

export function capture(fn: string, input: unknown): void {
  if (captureFile) appendFileSync(captureFile, JSON.stringify({ fn, input }, plain) + '\n');
}
