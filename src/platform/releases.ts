import { appVersion, isNewerVersion, type UpdateState } from '../shared/release';

export function createReleaseClient() {
  let state: UpdateState = { status: 'idle', version: null };
  const listeners = new Set<() => void>();
  let generation = 0;
  let pending: Promise<void> | undefined;
  let active = false;
  let revision = 0;
  const publish = (next: UpdateState) => {
    revision++;
    state = next;
    for (const listener of listeners) listener();
  };
  const check = async () => {
    if (pending) return pending;
    const token = generation;
    const run = async () => {
      try {
        if (window.desktopApi) {
          const next = await window.desktopApi.checkForUpdates();
          if (token === generation) publish(next);
        } else if (!import.meta.env.DEV) {
          publish({ status: 'checking', version: null });
          const response = await fetch(new URL('version.json', document.baseURI), {
            cache: 'no-store',
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw new Error('Version check failed');
          const data = (await response.json()) as { version?: unknown };
          if (typeof data.version !== 'string') throw new Error('Invalid version');
          if (token === generation)
            publish({
              status: isNewerVersion(data.version, appVersion) ? 'available' : 'current',
              version: data.version,
            });
        }
      } catch {
        if (token === generation) publish({ status: 'error', version: null });
      }
    };
    pending = run().finally(() => {
      if (token === generation) pending = undefined;
    });
    return pending;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
    async install() {
      return window.desktopApi?.installUpdate() ?? false;
    },
    start() {
      if (active) return () => {};
      active = true;
      const token = ++generation;
      const initialRevision = revision;
      const detach = window.desktopApi?.onUpdateState((next) => {
        if (token === generation) publish(next);
      });
      if (window.desktopApi) {
        void window.desktopApi
          .getUpdateState()
          .then((next) => {
            if (token === generation && revision === initialRevision) publish(next);
          })
          .catch(() => {
            if (token === generation && revision === initialRevision)
              publish({ status: 'error', version: null });
          });
      } else if (!import.meta.env.DEV) void check();
      const timer =
        window.desktopApi || import.meta.env.DEV
          ? undefined
          : setInterval(
              () => {
                void check();
              },
              10 * 60 * 1000,
            );
      return () => {
        if (token !== generation) return;
        active = false;
        generation++;
        pending = undefined;
        clearInterval(timer);
        detach?.();
      };
    },
  };
}
