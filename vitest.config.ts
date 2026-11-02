import { isRecord } from './src/shared/validation';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const metadata: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
if (!isRecord(metadata) || typeof metadata.version !== 'string')
  throw new Error('Invalid package version');
const { version } = metadata;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/types.d.ts'],
    },
  },
});
