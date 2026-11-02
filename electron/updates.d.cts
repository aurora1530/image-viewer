import type { EventEmitter } from 'node:events';
import type { UpdateState } from '../src/shared/release';
type UpdaterPort = EventEmitter & {
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(): unknown;
  autoInstallOnAppQuit?: boolean;
};
declare const api: {
  createUpdates(options: {
    enabled: boolean;
    updater: UpdaterPort;
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
export = api;
