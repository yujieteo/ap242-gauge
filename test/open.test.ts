import { expect, test } from 'bun:test';
import { fileOpener } from '../src/open.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(name: string) {
  const { promise, resolve } = deferred<ArrayBuffer>();
  const bytes = new ArrayBuffer(1);
  return { file: { name, arrayBuffer: () => promise }, finish: () => resolve(bytes), bytes };
}

function harness() {
  const dispatched: Array<{ name: string; bytes: ArrayBuffer; result: ReturnType<typeof deferred<string>> }> = [];
  const displayed: string[] = [];
  const errors: unknown[] = [];
  let cancelled = 0;
  const reader = {
    background: true,
    read(name: string, bytes: ArrayBuffer) {
      const result = deferred<string>();
      dispatched.push({ name, bytes, result });
      return result.promise;
    },
    cancel() { cancelled++; },
  };
  const opener = fileOpener(Promise.resolve(reader), {
    busy() {},
    parsing() {},
    success(name, unit) { displayed.push(name + ':' + unit); },
    failure(error) { errors.push(error); },
    cancelled() {},
  });
  return { opener, dispatched, displayed, errors, get cancelled() { return cancelled; } };
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('only the newest file is sent to the reader when file buffering overlaps', async () => {
  for (const order of ['old-first', 'new-first']) {
    const h = harness();
    const a = fixture('old.step'), b = fixture('new.step');
    const first = h.opener.open(a.file);
    await turn();
    const latest = h.opener.open(b.file);
    await first;
    if (order === 'old-first') { a.finish(); b.finish(); }
    else { b.finish(); a.finish(); }
    await turn();
    expect(h.dispatched.map((job) => job.name)).toEqual(['new.step']);
    expect(h.dispatched[0]?.bytes).toBe(b.bytes);
    h.dispatched[0]?.result.resolve('inch');
    await latest;
    expect(h.displayed).toEqual(['new.step:inch']);
    expect(h.errors).toEqual([]);
  }
});

test('Cancel settles a buffered open and leaves the displayed model unchanged', async () => {
  const h = harness();
  const before = fixture('before.step');
  const initial = h.opener.open(before.file);
  before.finish();
  await turn();
  h.dispatched[0]?.result.resolve('mm');
  await initial;

  const b = fixture('cancelled.step');
  const attempt = h.opener.open(b.file);
  await turn();
  h.opener.cancel();
  await attempt;
  b.finish();
  await turn();
  expect(h.dispatched.map((job) => job.name)).toEqual(['before.step']);
  expect(h.displayed).toEqual(['before.step:mm']);
  expect(h.errors).toEqual([]);
});

test('a late result for a superseded parse cannot alter the model', async () => {
  const h = harness();
  const a = fixture('old.step'), b = fixture('new.step');
  const first = h.opener.open(a.file);
  a.finish();
  await turn();
  const latest = h.opener.open(b.file);
  await first;
  b.finish();
  await turn();
  expect(h.cancelled).toBe(1);
  h.dispatched[1]?.result.resolve('inch');
  await latest;
  h.dispatched[0]?.result.resolve('mm');
  await turn();
  expect(h.displayed).toEqual(['new.step:inch']);
});
