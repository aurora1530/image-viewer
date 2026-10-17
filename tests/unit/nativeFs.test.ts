import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseNativeDirectory,
  getMediaSource,
  isDesktopApp,
  openNativeDirectory,
} from '../../src/nativeFs';
import { MemoryDirectory } from '../helpers/memoryFs';

afterEach(() => {
  delete window.desktopApi;
});

describe('desktop and browser file access', () => {
  it('opens a selected desktop root and reads children through the IPC adapter', async () => {
    const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    window.desktopApi = {
      onBeforeClose: () => () => undefined,
      onNavigate: () => () => undefined,
      readThumbnail: async () => ({ version: 'test', bytes: null }),
      writeThumbnail: async () => true,
      chooseDirectory: async () => 'C:\\photos',
      openRoot: async (path) => path,
      getLibrary: async () => [],
      toggleFavoriteRoot: async () => true,
      removeRecent: async () => undefined,
      listDirectory: async () => [{ name: 'ONE.PNG', kind: 'file' }],
      readFile,
      writeFile: async () => undefined,
      exists: async () => true,
    };
    expect(isDesktopApp()).toBe(true);
    const root = await chooseNativeDirectory();
    expect(root?.name).toBe('photos');
    const entries = [];
    for await (const entry of root!.values()) entries.push(entry);
    expect(entries.map((entry) => entry.name)).toEqual(['ONE.PNG']);
    const source = await getMediaSource(entries[0] as FileSystemFileHandle);
    expect(source).toMatchObject({ objectUrl: false });
    const nativePath = (entries[0] as FileSystemFileHandle).nativePath!;
    const encodedPath = btoa(
      Array.from(new TextEncoder().encode(nativePath), (byte) => String.fromCharCode(byte)).join(
        '',
      ),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(source.url).toBe(`local-media://file/${encodedPath}`);
    expect(readFile).not.toHaveBeenCalled();
    expect((await openNativeDirectory('C:\\photos')).name).toBe('photos');
  });

  it('returns null when desktop folder selection is canceled', async () => {
    window.desktopApi = { chooseDirectory: async () => null } as Window['desktopApi'];
    expect(await chooseNativeDirectory()).toBeNull();
  });

  it('creates an object URL for a browser file handle', async () => {
    const root = new MemoryDirectory('root');
    const file = root.file('cover.png');
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
    expect(isDesktopApp()).toBe(false);
    expect(await getMediaSource(file.asHandle())).toEqual({ url: 'blob:cover', objectUrl: true });
    expect(create).toHaveBeenCalledOnce();
  });
});
