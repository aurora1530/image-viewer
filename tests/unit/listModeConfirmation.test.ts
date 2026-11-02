import { createDesktopApi } from '../helpers/desktopApi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmListMode } from '../../src/platform/listModeConfirmation';

afterEach(() => {
  delete window.desktopApi;
  vi.restoreAllMocks();
});

describe('list mode confirmation', () => {
  it.each(['recursive', 'favorites'] as const)('uses the desktop dialog for %s', async (mode) => {
    const confirm = vi.spyOn(window, 'confirm');
    const nativeConfirm = vi.fn().mockResolvedValue(false);
    window.desktopApi = createDesktopApi({ confirmListMode: nativeConfirm });
    expect(await confirmListMode(mode)).toBe(false);
    expect(nativeConfirm).toHaveBeenCalledExactlyOnceWith(mode);
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(['recursive', 'favorites'] as const)(
    'keeps browser confirmation for %s',
    async (mode) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      expect(await confirmListMode(mode)).toBe(true);
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('続行しますか？'));
    },
  );
});
