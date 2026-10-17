export const MiB = 1024 * 1024;
export const defaultAppConfig = {
  thumbnailMemoryMiB: 512,
  originalMemoryMiB: 512,
  thumbnailDiskMiB: 3072,
};
export type AppConfig = typeof defaultAppConfig;
export function normalizeAppConfig(value: unknown): AppConfig {
  const result = { ...defaultAppConfig };
  if (!value || typeof value !== 'object') return result;
  for (const key of Object.keys(result) as (keyof AppConfig)[]) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= 1048576)
      result[key] = number;
  }
  return result;
}
