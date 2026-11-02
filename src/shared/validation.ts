export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Required value is missing');
  return value;
}
