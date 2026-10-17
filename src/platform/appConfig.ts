import { normalizeAppConfig, type AppConfig } from '../shared/appConfig';

const key = 'image-viewer-config';
export async function readAppConfig() {
  if (window.desktopApi) return normalizeAppConfig(await window.desktopApi.readAppConfig());
  const stored = localStorage.getItem(key);
  try {
    return normalizeAppConfig(stored ? JSON.parse(stored) : null);
  } catch {
    return normalizeAppConfig(null);
  }
}
export async function writeAppConfig(config: AppConfig) {
  if (window.desktopApi) await window.desktopApi.writeAppConfig(config);
  else localStorage.setItem(key, JSON.stringify(config));
}
