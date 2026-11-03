export function abortError() {
  return new DOMException('読み込みを中断しました。', 'AbortError');
}

// Cancel one consumer without changing the shared operation's lifetime.
export function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(abortError());
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(
          error instanceof Error ? error : new Error('読み込みに失敗しました。', { cause: error }),
        );
      },
    );
  });
}
