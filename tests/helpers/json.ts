import { isRecord } from '../../src/shared/validation';
import { ensureConfigNode } from '../../src/services/storage';
export function parseRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error('Expected JSON object');
  return value;
}
export function parseConfig(text: string) {
  return ensureConfigNode(parseRecord(text));
}
