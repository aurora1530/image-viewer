export const MiB = 1024 * 1024;
export const defaultAppConfig = {
  thumbnailMemoryMiB: 512,
  originalMemoryMiB: 512,
  thumbnailDiskMiB: 3072,
  directoryThumbnailNames: ['__0', 'icon', 'thumbnail'],
};
export type AppConfig = typeof defaultAppConfig;
export type CapacityConfigKey = Exclude<keyof AppConfig, 'directoryThumbnailNames'>;
export function isDirectoryThumbnailName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim() !== '.' &&
    value.trim() !== '..' &&
    !/[\\/:*?"<>|]/.test(value) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  );
}
export function normalizeAppConfig(value: unknown): AppConfig {
  const result = {
    ...defaultAppConfig,
    directoryThumbnailNames: [...defaultAppConfig.directoryThumbnailNames],
  };
  if (!value || typeof value !== 'object') return result;
  for (const key of ['thumbnailMemoryMiB', 'originalMemoryMiB', 'thumbnailDiskMiB'] as const) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= 1048576)
      result[key] = number;
  }
  const names = (value as Record<string, unknown>).directoryThumbnailNames;
  if (Array.isArray(names) && names.every(isDirectoryThumbnailName))
    result.directoryThumbnailNames = [...new Set(names.map((name) => name.trim()))];
  return result;
}
