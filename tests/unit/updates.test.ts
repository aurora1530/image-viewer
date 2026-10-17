import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../src/shared/release';

type FakeUpdater = EventEmitter & {
  checkForUpdates: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  autoInstallOnAppQuit?: boolean;
};
const require = createRequire(import.meta.url);
const { createUpdates } = require('../../electron/updates.cjs') as {
  createUpdates(options: {
    enabled: boolean;
    updater: FakeUpdater;
    broadcast(state: UpdateState): void;
    requestInstall(): boolean;
  }): {
    getState(): UpdateState;
    check(): Promise<UpdateState>;
    start(): void;
    stop(): void;
    install(): boolean;
    cancelInstall(): void;
    finishInstall(): boolean;
  };
};

function setup(enabled = true) {
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async (): Promise<{ downloadPromise: Promise<unknown> | null }> => ({
      downloadPromise: null,
    })),
    quitAndInstall: vi.fn(),
  });
  const broadcast = vi.fn();
  const requestInstall = vi.fn(() => true);
  return {
    updater,
    broadcast,
    requestInstall,
    updates: createUpdates({ enabled, updater, broadcast, requestInstall }),
  };
}
afterEach(() => vi.useRealTimers());

describe('desktop updates', () => {
  it('never checks or installs for manual-update builds', async () => {
    const { updates, updater } = setup(false);
    updates.start();
    await updates.check();
    expect(updates.getState().status).toBe('manual');
    expect(updates.install()).toBe(false);
    updates.finishInstall();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('waits for the close/save acknowledgment and permits retry after failed saving', () => {
    const { updates, updater, requestInstall } = setup();
    expect(updates.install()).toBe(false);
    updater.emit('update-downloaded', { version: '1.2.0' });
    expect(updates.install()).toBe(true);
    expect(updates.install()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updates.cancelInstall();
    updates.finishInstall();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updates.install()).toBe(true);
    updates.finishInstall();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(requestInstall).toHaveBeenCalledTimes(2);
    expect((updater as FakeUpdater).autoInstallOnAppQuit).toBe(false);
  });

  it('coalesces checks and recovers from network and download errors', async () => {
    const { updates, updater } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await Promise.all([updates.check(), updates.check()]);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updates.getState().status).toBe('error');
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-not-available');
      return { downloadPromise: null };
    });
    await updates.check();
    expect(updates.getState().status).toBe('current');
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-available', { version: '1.2.0' });
      return { downloadPromise: Promise.reject(new Error('download failed')) };
    });
    await updates.check();
    updater.emit('error', new Error('download failed'));
    expect(updates.getState().status).toBe('error');
  });

  it('does not recheck while downloading or discard a downloaded update', async () => {
    const { updates, updater } = setup();
    updater.emit('update-available', { version: '1.2.0' });
    await updates.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '1.2.0' });
    updater.emit('error', new Error('background error'));
    expect(updates.getState()).toEqual({ status: 'ready', version: '1.2.0' });
  });

  it('reports an installer failure without authorizing the app to quit', () => {
    const { updates, updater } = setup();
    updater.emit('update-downloaded', { version: '1.2.0' });
    updates.install();
    updater.quitAndInstall.mockImplementationOnce(() =>
      updater.emit('error', new Error('installer missing')),
    );
    expect(updates.finishInstall()).toBe(false);
    expect(updates.getState().status).toBe('error');
  });

  it('checks periodically and stops its timer', async () => {
    vi.useFakeTimers();
    const { updates, updater } = setup();
    updates.start();
    updates.start();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    updates.stop();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
