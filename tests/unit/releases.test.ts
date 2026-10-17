import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewerVersion, appVersion } from '../../src/shared/release';
import { createReleaseClient } from '../../src/platform/releases';
import type { UpdateState } from '../../src/shared/release';

afterEach(() => {
  delete window.desktopApi;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('release version checks', () => {
  it('keeps a newer desktop event when the initial snapshot arrives late', async () => {
    let complete!: (state: UpdateState) => void;
    let notify!: (state: UpdateState) => void;
    const detach = vi.fn();
    window.desktopApi = {
      getUpdateState: () =>
        new Promise<UpdateState>((resolve) => {
          complete = resolve;
        }),
      onUpdateState: (callback: (state: UpdateState) => void) => {
        notify = callback;
        return detach;
      },
    } as unknown as Window['desktopApi'];
    const client = createReleaseClient();
    const stop = client.start();
    notify({ status: 'ready', version: '2.0.0' });
    complete({ status: 'idle', version: null });
    await Promise.resolve();
    expect(client.getSnapshot()).toEqual({ status: 'ready', version: '2.0.0' });
    stop();
    expect(detach).toHaveBeenCalledOnce();
    notify({ status: 'error', version: null });
    expect(client.getSnapshot().status).toBe('ready');
  });
  it('compares numeric stable versions and rejects prereleases or invalid values', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
    for (const candidate of [
      '1.0.0',
      '0.9.9',
      'v2.0.0',
      '2.0.0-beta.1',
      '02.0.0',
      '9007199254740992.0.0',
    ])
      expect(isNewerVersion(candidate, '1.0.0')).toBe(false);
  });

  it('checks deployed version.json without using main or the GitHub API', async () => {
    vi.stubEnv('DEV', false);
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ version: '999.0.0' }) }));
    vi.stubGlobal('fetch', fetcher);
    const client = createReleaseClient();
    await client.check();
    expect(client.getSnapshot()).toEqual({ status: 'available', version: '999.0.0' });
    expect(fetcher.mock.calls[0]).toEqual([
      new URL('version.json', document.baseURI),
      expect.objectContaining({ cache: 'no-store' }),
    ]);
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ version: appVersion }) });
    await client.check();
    expect(client.getSnapshot().status).toBe('current');
  });

  it('ignores a pending result after shutdown and can start again', async () => {
    vi.stubEnv('DEV', false);
    let complete!: (value: { ok: boolean; json(): Promise<{ version: string }> }) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
    );
    const client = createReleaseClient();
    const stop = client.start();
    stop();
    complete({ ok: true, json: async () => ({ version: '999.0.0' }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getSnapshot().status).not.toBe('available');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const stopAgain = client.start();
    await client.check();
    expect(client.getSnapshot().status).toBe('error');
    stopAgain();
  });
});
