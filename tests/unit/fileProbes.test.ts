import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstFile } = createRequire(import.meta.url)('../../electron/file-probes.cjs') as {
  findFirstFile(
    directory: unknown,
    names: unknown,
    requireAllowed: (target: string) => string,
  ): Promise<string | null>;
};
let directory: string;
const requireAllowed = (target: string) => {
  const resolved = path.resolve(target);
  const relative = path.relative(directory, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outside root');
  return resolved;
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'image-viewer-probes-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('desktop candidate file probes', () => {
  it('does not probe lower-priority paths after the first candidate is found', async () => {
    await writeFile(path.join(directory, '__0.jpg'), 'jpeg');
    const allowed = vi.fn(requireAllowed);
    expect(await findFirstFile(directory, ['__0.jpg', '__0.png'], allowed)).toBe('__0.jpg');
    expect(allowed.mock.calls.map(([target]) => target)).toEqual([
      directory,
      path.join(directory, '__0.jpg'),
    ]);
  });

  it('checks only candidate paths, skips directories and preserves extension order', async () => {
    await mkdir(path.join(directory, '__0.jpg'));
    await writeFile(path.join(directory, '__0.png'), 'png');
    await writeFile(path.join(directory, '__0.jpeg'), 'jpeg');
    const allowed = vi.fn(requireAllowed);
    expect(await findFirstFile(directory, ['__0.jpg', '__0.jpeg', '__0.png'], allowed)).toBe(
      '__0.jpeg',
    );
    expect(allowed.mock.calls.map(([target]) => target)).toEqual([
      directory,
      path.join(directory, '__0.jpg'),
      path.join(directory, '__0.jpeg'),
      path.join(directory, '__0.png'),
    ]);
    expect(
      await findFirstFile(directory, ['missing.jpg', 'missing.png'], requireAllowed),
    ).toBeNull();
    expect(await findFirstFile(directory, [], requireAllowed)).toBeNull();
  });

  it('picks the first candidate on case-insensitive Windows file systems', async () => {
    await writeFile(path.join(directory, 'ICON.PNG'), 'png');
    const name = process.platform === 'win32' ? 'icon.png' : 'ICON.PNG';
    expect(await findFirstFile(directory, [name, 'missing.png'], requireAllowed)).toBe(name);
  });

  it.each(
    [
      null,
      ['../cover.png'],
      ['sub/cover.png'],
      ['sub\\cover.png'],
      ['cover.png:stream'],
      [''],
      ['.'],
      ['..'],
      [12],
      Array<string>(8).fill('cover.png'),
    ].map((names) => ({ names })),
  )('rejects invalid candidate inputs ($names)', async ({ names }) => {
    await expect(findFirstFile(directory, names, requireAllowed)).rejects.toThrow('不正な候補');
  });

  it('rejects relative or unapproved directories before probing', async () => {
    await expect(findFirstFile('relative', ['cover.png'], requireAllowed)).rejects.toThrow(
      '不正な候補',
    );
    await expect(
      findFirstFile(path.join(directory, '..', 'outside'), ['cover.png'], requireAllowed),
    ).rejects.toThrow('outside root');
  });
});
