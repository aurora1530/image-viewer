import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Settings } from '../../src/features/settings/Settings';
import { createApplication } from '../../src/app/createApplication';
import { createAppStore } from '../../src/app/store';
import { renderApplication } from '../helpers/render';
import { createDesktopApi } from '../helpers/desktopApi';
import { requireValue } from '../../src/shared/validation';

afterEach(() => {
  delete window.desktopApi;
});

it('disables cache removal while pending, reports failure and allows retry', async () => {
  let finish: () => void = () => {};
  const clearPersistentCache = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk'))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const cacheStats = vi
    .fn()
    .mockResolvedValue({ bytes: 0, path: '/cache', configPath: '/settings' });
  window.desktopApi = createDesktopApi({ clearPersistentCache, cacheStats });
  const app = createApplication(createAppStore({ configReady: true }));
  vi.spyOn(app, 'start').mockReturnValue(() => {});
  const { container } = renderApplication(createElement(Settings), app);
  const dialog = requireValue(container.querySelector('dialog'));
  Object.defineProperty(dialog, 'showModal', {
    value: () => {
      dialog.open = true;
    },
  });
  const button = (text: string) =>
    requireValue(
      Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent?.trim() === text,
      ),
    );
  flushSync(() => button('設定').click());
  flushSync(() => button('永続キャッシュを削除').click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain('永続キャッシュを削除できませんでした'),
  );
  await vi.waitFor(() => expect(button('永続キャッシュを削除').disabled).toBe(false));
  flushSync(() => button('永続キャッシュを削除').click());
  expect(button('削除中…').disabled).toBe(true);
  expect(button('閉じる').disabled).toBe(true);
  finish();
  await vi.waitFor(() => expect(container.textContent).toContain('永続キャッシュを削除しました。'));
  await vi.waitFor(() => expect(button('永続キャッシュを削除').disabled).toBe(false));
  expect(clearPersistentCache).toHaveBeenCalledTimes(2);
});
