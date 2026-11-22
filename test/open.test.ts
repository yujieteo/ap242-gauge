import { expect, test } from 'bun:test';
import { fileOpener, nextOpen } from '../src/open.ts';
import type { OpenEvent, OpenStatus } from '../src/open.ts';

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
    show(status) { if (status.kind === 'failed') errors.push(status.message); },
    opened(name, unit) { displayed.push(name + ':' + unit); },
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

const waiting: OpenStatus = { kind: 'waiting', id: 1, name: 'a.step', since: 10 };
const reading: OpenStatus = { kind: 'reading', id: 1, name: 'a.step', since: 10, stage: 'Reading a.step', canCancel: true };
const idle: OpenStatus = { kind: 'idle' };
const opened: OpenStatus = { kind: 'opened', name: 'a.step', ms: 5 };
const failed: OpenStatus = { kind: 'failed', name: 'a.step', message: 'bad' };
const cancelled: OpenStatus = { kind: 'cancelled', name: 'a.step' };

const STATES: Readonly<Record<string, OpenStatus>> = { idle, waiting, reading, opened, failed, cancelled };
const settled = { idle, opened, failed, cancelled };
const next: OpenStatus = { kind: 'waiting', id: 2, name: 'b.step', since: 20 };

const EVENTS: readonly { name: string; event: OpenEvent; after: Record<string, OpenStatus> }[] = [
  { name: 'open', event: { kind: 'open', id: 2, name: 'b.step', at: 20 },
    after: { idle: next, waiting: next, reading: next, opened: next, failed: next, cancelled: next } },
  { name: 'reader', event: { kind: 'reader', id: 1 }, after: { ...settled, waiting: reading, reading } },
  { name: 'bytes', event: { kind: 'bytes', id: 1, canCancel: false }, after: { ...settled, waiting, reading: { ...reading, canCancel: false } } },
  { name: 'stage', event: { kind: 'stage', id: 1, text: 'Preparing a.step' }, after: { ...settled, waiting, reading: { ...reading, stage: 'Preparing a.step' } } },
  { name: 'done', event: { kind: 'done', id: 1, at: 15 }, after: { ...settled, waiting: opened, reading: opened } },
  { name: 'error', event: { kind: 'error', id: 1, message: 'bad' }, after: { ...settled, waiting: failed, reading: failed } },
  { name: 'cancel', event: { kind: 'cancel' }, after: { ...settled, waiting: cancelled, reading: cancelled } },
  { name: 'stale done', event: { kind: 'done', id: 0, at: 15 }, after: { ...settled, waiting, reading } },
  { name: 'stale error', event: { kind: 'error', id: 0, message: 'old' }, after: { ...settled, waiting, reading } },
];

for (const [stateName, state] of Object.entries(STATES)) {
  for (const { name: eventName, event, after } of EVENTS) {
    test('open: ' + eventName + ' in state ' + stateName, () => {
      expect(nextOpen(state, event)).toEqual(after[stateName] ?? idle);
    });
  }
}

test('open resolves with its outcome, and Cancel works while the reader starts', async () => {
  type FakeReader = { background: boolean; read: () => Promise<string>; cancel: () => void };
  let ready: (reader: FakeReader) => void = () => undefined;
  const shown: string[] = [];
  const opener = fileOpener(new Promise<FakeReader>((resolve) => { ready = resolve; }), {
    show(status) { shown.push(status.kind); },
    opened() {},
  });
  const first = opener.open(fixture('a.step').file);
  expect(opener.status.kind).toBe('waiting');
  opener.cancel();
  expect(await first).toBe('cancelled');
  const b = fixture('b.step');
  const second = opener.open(b.file);
  ready({ background: true, read: () => Promise.reject(new Error('b.step is bad')), cancel() {} });
  await turn();
  b.finish();
  expect(await second).toBe('failed');
  expect(opener.status).toEqual({ kind: 'failed', name: 'b.step', message: 'b.step is bad' });
  expect(shown).toEqual(['waiting', 'cancelled', 'waiting', 'reading', 'reading', 'failed']);
});
