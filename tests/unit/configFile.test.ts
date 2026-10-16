import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs/promises') as typeof import('node:fs/promises');
const { writeConfigFile } = require('../../electron/config-file.cjs') as {
  writeConfigFile(file: string, data: string): Promise<void>;
};
let directory: string;
let file: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'image-viewer-config-'));
  file = path.join(directory, '.image-viewer.json');
  await writeFile(file, '{"favorites":["old.png"]}');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('desktop config replacement', () => {
  it('replaces existing files and cleans up temporary files', async () => {
    await writeConfigFile(file, '{"favorites":["new.png"]}');
    expect(JSON.parse(await readFile(file, 'utf8')).favorites).toEqual(['new.png']);
    expect(await readdir(directory)).toEqual(['.image-viewer.json']);
  });

  it('preserves the original when a partial write fails', async () => {
    const originalWrite = fs.writeFile;
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (target, _data, options) => {
      await originalWrite(target, '{partial', options);
      throw new Error('disk full');
    });
    await expect(writeConfigFile(file, '{"favorites":[]}')).rejects.toThrow('disk full');
    expect(JSON.parse(await readFile(file, 'utf8')).favorites).toEqual(['old.png']);
    expect(await readdir(directory)).toEqual(['.image-viewer.json']);
  });

  it('preserves the original when replacement is denied', async () => {
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('access denied'));
    await expect(writeConfigFile(file, '{"favorites":[]}')).rejects.toThrow('access denied');
    expect(JSON.parse(await readFile(file, 'utf8')).favorites).toEqual(['old.png']);
    expect(await readdir(directory)).toEqual(['.image-viewer.json']);
  });
});
