import type { AppStore } from './store';
import { MiB, normalizeAppConfig, type AppConfig } from '../shared/appConfig';
import { readAppConfig, writeAppConfig } from '../platform/appConfig';
import { thumbnailCache } from '../services/thumbnailCache';
import { originalImageCache } from '../services/originalImageCache';

export function createConfig(store: AppStore) {
  function apply(config: AppConfig) {
    thumbnailCache.setMaxBytes(config.thumbnailMemoryMiB * MiB);
    originalImageCache.setMaxBytes(config.originalMemoryMiB * MiB);
    store.setState({ config, configReady: true });
  }
  let loading: Promise<void> | undefined;
  let saving = false;
  return {
    load() {
      return (loading ??= readAppConfig()
        .then(apply)
        .catch(() => {
          store.setState({ configError: '設定を読み込めませんでした。' });
        }));
    },
    actions: {
      async saveConfig(value: AppConfig) {
        if (saving || !store.getState().configReady) return false;
        saving = true;
        store.setState({ configError: '' });
        try {
          const config = normalizeAppConfig(value);
          await writeAppConfig(config);
          apply(config);
          return true;
        } catch {
          store.setState({ configError: '設定を保存できませんでした。' });
          return false;
        } finally {
          saving = false;
        }
      },
      async refreshCacheUsage() {
        try {
          const disk = await window.desktopApi?.cacheStats();
          store.setState({
            cacheUsage: {
              thumbnail: thumbnailCache.stats().retainedBytes,
              original: originalImageCache.stats().retainedBytes,
              disk: disk?.bytes ?? 0,
              path: disk?.path ?? '',
              configPath: disk?.configPath ?? 'ブラウザーの localStorage（image-viewer-config）',
            },
          });
        } catch {
          store.setState({ configError: 'キャッシュ使用量を取得できませんでした。' });
        }
      },
    },
  };
}
