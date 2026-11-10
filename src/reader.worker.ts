import { readModel, transferables } from './model.ts';
import { startOcct } from './occt.ts';
import type { OcctReader } from './occt.ts';
import type { FromWorker, ToWorker } from './reader.ts';

const scope = {
  postMessage(message: FromWorker, transfer: Transferable[] = []): void { Reflect.apply(Reflect.get(self, 'postMessage'), self, [message, transfer]); },
};
let reader: Promise<OcctReader> | null = null;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.kind === 'init') {
    reader = startOcct(Reflect.get(self, 'occtimportjs'), [{ wasmBinary: new Uint8Array(m.wasm) }]);
    reader.then(() => scope.postMessage({ kind: 'ready' }), (x: unknown) => scope.postMessage({ kind: 'error', message: String(x) }));
    return;
  }
  if (!reader) { scope.postMessage({ kind: 'error', message: 'the STEP reader did not start' }); return; }
  reader.then((occt) => {
    const out = readModel(occt, new Uint8Array(m.file), m.name, (text) => scope.postMessage({ kind: 'stage', text }));
    if (out.ok) scope.postMessage({ kind: 'done', data: out.data }, transferables(out.data));
    else scope.postMessage({ kind: 'error', message: out.message });
  }).catch((x: unknown) => scope.postMessage({ kind: 'error', message: String(x) }));
};
