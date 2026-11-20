import { expect, test } from 'bun:test';
import { CANCELLED, startReader } from '../src/reader.ts';

const fakeWorker = `
self.onmessage = (e) => {
  const m = e.data;
  if (m.kind === 'init') { self.postMessage({ kind: 'ready' }); return; }
  const wait = m.name === 'first.stp' ? 60 : 5;
  setTimeout(() => self.postMessage({ kind: 'done', data: { from: m.name } }), wait);
};
`;

function fakeSources(): Parameters<typeof startReader>[0] {
  return { occt: '', worker: fakeWorker, wasm: new Uint8Array(4) };
}

test('a second read cancels the first and gets its own data', async () => {
  const reader = await startReader(fakeSources());
  expect(reader.background).toBe(true);
  const first = reader.read('first.stp', new ArrayBuffer(8), () => undefined);
  const second = reader.read('second.stp', new ArrayBuffer(8), () => undefined);
  await expect(first).rejects.toThrow(CANCELLED);
  expect(Reflect.get(await second, 'from')).toBe('second.stp');
});
