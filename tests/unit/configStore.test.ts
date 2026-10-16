import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../../src/configStore';

afterEach(() => vi.useRealTimers());

describe('config write coordination', () => {
  it('serializes writes and saves edits arriving during an active write', async () => {
    const releases: Array<() => void> = [];
    const save = vi.fn((_payload: string) => new Promise<void>(resolve => releases.push(resolve)));
    const store = new ConfigStore(async () => ({ entries: [] as string[] }), save);
    await store.update(config => config.entries.push('one'));
    const first = store.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await store.update(config => config.entries.push('two'));
    const second = store.flush();
    expect(save).toHaveBeenCalledTimes(1);
    releases.shift()!();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(JSON.parse(save.mock.calls[0][0]).entries).toEqual(['one']);
    expect(JSON.parse(save.mock.calls[1][0]).entries).toEqual(['one', 'two']);
    releases.shift()!();
    await Promise.all([first, second]);
  });

  it('retains failed saves for retry and reports failure to each waiting caller', async () => {
    const save = vi.fn<(payload: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const store = new ConfigStore(async () => ({ favorite: false }), save);
    await store.update(config => { config.favorite = true; });
    const results = await Promise.allSettled([store.flush(), store.flush()]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    await store.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(save.mock.calls[1][0]).favorite).toBe(true);
  });

  it('batches rapid settings changes and flushes before the timer when requested', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_payload: string) => undefined);
    const onError = vi.fn();
    const store = new ConfigStore(async () => ({ size: 0 }), save);
    for (const size of [1, 2, 3]) {
      await store.update(config => { config.size = size; });
      store.scheduleSave(onError);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(save).not.toHaveBeenCalled();
    await store.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(JSON.parse(save.mock.calls[0][0]).size).toBe(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('orders pending changes around an explicit reload', async () => {
    const load = vi.fn(async () => ({ value: 0 }));
    const save = vi.fn(async (_payload: string) => undefined);
    const store = new ConfigStore(load, save);
    const before = store.update(config => { config.value = 1; });
    const reload = store.reload();
    const after = store.update(config => { config.value = 2; });
    await Promise.all([before, reload, after]);
    await store.flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.map(([payload]) => JSON.parse(payload).value)).toEqual([1, 2]);
  });
});
