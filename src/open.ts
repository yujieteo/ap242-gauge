type OpenReader<T> = {
  readonly background: boolean;
  read(name: string, file: ArrayBuffer, stage: (text: string) => void): Promise<T>;
  cancel(): void;
};

export type OpenStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting'; readonly id: number; readonly name: string; readonly since: number }
  | { readonly kind: 'reading'; readonly id: number; readonly name: string; readonly since: number; readonly stage: string; readonly canCancel: boolean }
  | { readonly kind: 'opened'; readonly name: string; readonly ms: number }
  | { readonly kind: 'failed'; readonly name: string; readonly message: string }
  | { readonly kind: 'cancelled'; readonly name: string };

export type OpenEvent =
  | { readonly kind: 'open'; readonly id: number; readonly name: string; readonly at: number }
  | { readonly kind: 'reader'; readonly id: number }
  | { readonly kind: 'bytes'; readonly id: number; readonly canCancel: boolean }
  | { readonly kind: 'stage'; readonly id: number; readonly text: string }
  | { readonly kind: 'done'; readonly id: number; readonly at: number }
  | { readonly kind: 'error'; readonly id: number; readonly message: string }
  | { readonly kind: 'cancel' };

export type OpenOutcome = 'opened' | 'failed' | 'cancelled' | 'replaced';

export const isOpening = (s: OpenStatus): s is Extract<OpenStatus, { id: number }> => s.kind === 'waiting' || s.kind === 'reading';

export function nextOpen(state: OpenStatus, event: OpenEvent): OpenStatus {
  if (event.kind === 'open') return { kind: 'waiting', id: event.id, name: event.name, since: event.at };
  if (!isOpening(state)) return state;
  if (event.kind === 'cancel') return { kind: 'cancelled', name: state.name };
  if (event.id !== state.id) return state;
  const { id, name, since } = state;
  switch (event.kind) {
    case 'reader': return state.kind === 'waiting' ? { kind: 'reading', id, name, since, stage: 'Reading ' + name, canCancel: true } : state;
    case 'bytes': return state.kind === 'reading' ? { ...state, canCancel: event.canCancel } : state;
    case 'stage': return state.kind === 'reading' ? { ...state, stage: event.text } : state;
    case 'done': return { kind: 'opened', name, ms: event.at - since };
    case 'error': return { kind: 'failed', name, message: event.message };
  }
}

type OpenView<T> = {
  show(status: OpenStatus): void;
  opened(name: string, data: T): void;
};

export function fileOpener<T>(readerReady: Promise<OpenReader<T>>, view: OpenView<T>, now: () => number = () => performance.now()) {
  let status: OpenStatus = { kind: 'idle' };
  let lastId = 0;
  let stopActive: ((outcome: 'cancelled' | 'replaced') => void) | null = null;

  const send = (event: OpenEvent): boolean => {
    const next = nextOpen(status, event);
    if (next === status) return false;
    status = next;
    view.show(next);
    return true;
  };

  async function open(file: Pick<File, 'name' | 'arrayBuffer'>): Promise<OpenOutcome> {
    stopActive?.('replaced');
    const id = ++lastId;
    let reader: OpenReader<T> | undefined;
    let stopped: (outcome: 'cancelled' | 'replaced') => void = () => undefined;
    const stoppedEarly = new Promise<OpenOutcome>((resolve) => { stopped = resolve; });
    const stop = (outcome: 'cancelled' | 'replaced'): void => {
      stopActive = null;
      stopped(outcome);
      reader?.cancel();
    };
    stopActive = stop;
    send({ kind: 'open', id, name: file.name, at: now() });

    async function load(): Promise<OpenOutcome> {
      try {
        reader = await readerReady;
        if (!send({ kind: 'reader', id })) return 'replaced';
        const bytes = await file.arrayBuffer();
        if (!send({ kind: 'bytes', id, canCancel: reader.background })) return 'replaced';
        const data = await reader.read(file.name, bytes, (text) => { send({ kind: 'stage', id, text }); });
        if (!isOpening(status) || status.id !== id) return 'replaced';
        view.opened(file.name, data);
        send({ kind: 'done', id, at: now() });
        return 'opened';
      } catch (error) {
        return send({ kind: 'error', id, message: error instanceof Error ? error.message : String(error) }) ? 'failed' : 'replaced';
      } finally {
        if (stopActive === stop) stopActive = null;
      }
    }

    return Promise.race([load(), stoppedEarly]);
  }

  return {
    open,
    cancel(): void {
      if (!stopActive) return;
      stopActive('cancelled');
      send({ kind: 'cancel' });
    },
    get status(): OpenStatus { return status; },
  };
}
