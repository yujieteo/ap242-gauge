import { readModel } from './model.ts';
import type { ModelData } from './model.ts';
import { startOcct } from './occt.ts';

export type ToWorker =
  | { readonly kind: 'init'; readonly wasm: ArrayBuffer }
  | { readonly kind: 'read'; readonly name: string; readonly file: ArrayBuffer };
export type FromWorker =
  | { readonly kind: 'ready' }
  | { readonly kind: 'stage'; readonly text: string }
  | { readonly kind: 'done'; readonly data: ModelData }
  | { readonly kind: 'error'; readonly message: string };

export type Sources = { readonly occt: string; readonly worker: string; readonly wasm: Uint8Array };
export type Reader = {
  readonly ready: Promise<void>;
  readonly background: boolean;
  read(name: string, file: ArrayBuffer, stage: (text: string) => void): Promise<ModelData>;
  cancel(): void;
};

type Job = { readonly stage: (text: string) => void; readonly resolve: (d: ModelData) => void; readonly reject: (e: Error) => void };

export const CANCELLED = 'cancelled';

function workerReader(src: Sources): Reader {
  const url = URL.createObjectURL(new Blob([src.occt, '\n', src.worker], { type: 'text/javascript' }));
  let worker: Worker, ready: Promise<void>, job: Job | null = null;
  const start = (): void => {
    worker = new Worker(url);
    const w = worker;
    ready = new Promise((resolve, reject) => {
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.kind === 'ready') resolve();
        else if (m.kind === 'stage') job?.stage(m.text);
        else if (m.kind === 'done') { job?.resolve(m.data); job = null; }
        else { reject(new Error(m.message)); job?.reject(new Error(m.message)); job = null; }
      };
      w.onerror = (e) => { const x = new Error(e.message || 'the reader worker failed'); reject(x); job?.reject(x); job = null; };
    });
    ready.catch(() => undefined);
    const wasm = src.wasm.slice().buffer;
    const init: ToWorker = { kind: 'init', wasm };
    w.postMessage(init, [wasm]);
  };
  start();
  return {
    get ready() { return ready; },
    background: true,
    async read(name, file, stage) {
      await ready;
      return new Promise<ModelData>((resolve, reject) => {
        job = { stage, resolve, reject };
        const message: ToWorker = { kind: 'read', name, file };
        worker.postMessage(message, [file]);
      });
    },
    cancel() {
      if (!job) return;
      worker.terminate();
      job.reject(new Error(CANCELLED));
      job = null;
      start();
    },
  };
}

function pageReader(src: Sources): Reader {
  const script = document.createElement('script');
  script.text = src.occt;
  document.head.append(script);
  const occt = startOcct(Reflect.get(window, 'occtimportjs'), [{ wasmBinary: src.wasm }]);
  return {
    ready: occt.then(() => undefined),
    background: false,
    async read(name, file, stage) {
      const reader = await occt;
      stage('Reading ' + name);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const out = readModel(reader, new Uint8Array(file), name, () => undefined);
      if (!out.ok) throw new Error(out.message);
      return out.data;
    },
    cancel() { return; },
  };
}

export async function startReader(src: Sources): Promise<Reader> {
  try {
    const reader = workerReader(src);
    await reader.ready;
    return reader;
  } catch {
    const reader = pageReader(src);
    await reader.ready;
    return reader;
  }
}
