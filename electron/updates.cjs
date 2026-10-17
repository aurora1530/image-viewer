// Keep updater state and Electron wiring separate so failure/close behavior is testable.
function createUpdates({ updater, enabled, broadcast, requestInstall }) {
  let state = { status: enabled ? 'idle' : 'manual', version: null };
  let checking = null;
  let installing = false;
  let timer;
  const publish = (patch) => {
    state = { ...state, ...patch };
    broadcast(state);
  };
  if (enabled) {
    updater.autoDownload = true;
    // Never let the updater bypass the application's pending-config flush on quit.
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => publish({ status: 'checking', version: null }));
    updater.on('update-available', (info) =>
      publish({ status: 'downloading', version: info.version }),
    );
    updater.on('update-not-available', () => publish({ status: 'current', version: null }));
    updater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version }));
    updater.on('error', () => {
      // A failed background check must not throw or prevent ordinary app use.
      if (state.status !== 'ready' || installing) {
        installing = false;
        publish({ status: 'error', version: null });
      }
    });
  }
  const check = () => {
    if (!enabled || ['downloading', 'ready'].includes(state.status)) return Promise.resolve(state);
    if (checking) return checking;
    checking = Promise.resolve()
      .then(() => updater.checkForUpdates())
      .then((result) => {
        // checkForUpdates returns before autoDownload finishes. Handle its separate
        // rejection as well; the error event above provides the visible state.
        void result?.downloadPromise?.catch(() => {});
      })
      .catch(() => {
        publish({ status: 'error', version: null });
      })
      .then(() => state)
      .finally(() => {
        checking = null;
      });
    return checking;
  };
  return {
    getState: () => state,
    check,
    start() {
      if (!enabled || timer) return;
      void check();
      timer = setInterval(
        () => {
          void check();
        },
        4 * 60 * 60 * 1000,
      );
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    install() {
      if (!enabled || state.status !== 'ready' || installing) return false;
      installing = true;
      if (!requestInstall()) {
        installing = false;
        return false;
      }
      return true;
    },
    cancelInstall() {
      installing = false;
    },
    finishInstall() {
      if (!installing || state.status !== 'ready') return false;
      updater.quitAndInstall(false, true);
      return installing && state.status === 'ready';
    },
  };
}
module.exports = { createUpdates };
