type OpenReader<T> = {
  readonly background: boolean;
  read(name: string, file: ArrayBuffer, stage: (text: string) => void): Promise<T>;
  cancel(): void;
};

type OpenView<T> = {
  busy(label: () => string): void;
  parsing(canCancel: boolean): void;
  success(name: string, data: T): void;
  failure(error: unknown): void;
  cancelled(): void;
};

export function fileOpener<T>(readerReady: Promise<OpenReader<T>>, view: OpenView<T>) {
  let active: { stop(): void } | null = null;

  async function open(file: Pick<File, 'name' | 'arrayBuffer'>): Promise<void> {
    active?.stop();
    let stopWaiting: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { stopWaiting = resolve; });
    let reader: OpenReader<T> | undefined;
    const request = {
      stop() {
        active = null;
        stopWaiting();
        reader?.cancel();
      },
    };
    active = request;

    async function load(): Promise<void> {
      try {
        reader = await readerReady;
        if (active !== request) return;
        let stage = 'Reading ' + file.name;
        view.busy(() => stage);
        const bytes = await file.arrayBuffer();
        if (active !== request) return;
        view.parsing(reader.background);
        const data = await reader.read(file.name, bytes, (text) => { stage = text; });
        if (active === request) view.success(file.name, data);
      } catch (error) {
        if (active === request) view.failure(error);
      } finally {
        if (active === request) active = null;
      }
    }

    await Promise.race([load(), stopped]);
  }

  return {
    open,
    cancel() {
      if (!active) return;
      active.stop();
      view.cancelled();
    },
  };
}
