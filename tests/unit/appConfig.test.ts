import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfig } from '../../src/app/createConfig';
import { createAppStore } from '../../src/app/store';
import { defaultAppConfig, normalizeAppConfig } from '../../src/shared/appConfig';
import { originalImageCache } from '../../src/services/originalImageCache';
import { thumbnailCache } from '../../src/services/thumbnailCache';

afterEach(() => {
  delete window.desktopApi;
});

describe('central app configuration', () => {
  it('falls back per field for malformed settings, preserving zero', () => {
    expect(
      normalizeAppConfig({ thumbnailMemoryMiB: 0, originalMemoryMiB: -1, thumbnailDiskMiB: '10' }),
    ).toEqual({ ...defaultAppConfig, thumbnailMemoryMiB: 0 });
    expect(normalizeAppConfig(null)).toEqual(defaultAppConfig);
  });

  it('loads and persists browser settings and applies runtime limits', async () => {
    localStorage.setItem('image-viewer-config', JSON.stringify({ thumbnailMemoryMiB: 24 }));
    const store = createAppStore();
    const config = createConfig(store);
    const thumbnail = vi.spyOn(thumbnailCache, 'setMaxBytes');
    const original = vi.spyOn(originalImageCache, 'setMaxBytes');
    await config.load();
    expect(store.getState().config.thumbnailMemoryMiB).toBe(24);
    expect(await config.actions.saveConfig({ ...defaultAppConfig, originalMemoryMiB: 0 })).toBe(
      true,
    );
    expect(original).toHaveBeenLastCalledWith(0);
    expect(thumbnail).toHaveBeenLastCalledWith(512 * 1024 * 1024);
    const restored = createConfig(createAppStore());
    await restored.load();
    expect(JSON.parse(localStorage.getItem('image-viewer-config')!)).toMatchObject({
      originalMemoryMiB: 0,
    });
  });

  it('preserves active configuration when persistence fails', async () => {
    const store = createAppStore();
    const config = createConfig(store);
    await config.load();
    const before = store.getState().config;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(await config.actions.saveConfig({ ...defaultAppConfig, thumbnailMemoryMiB: 0 })).toBe(
      false,
    );
    expect(store.getState().config).toBe(before);
    expect(store.getState().configError).toContain('保存できません');
  });
});
