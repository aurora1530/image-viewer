import { requireValue } from '../../src/shared/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseNativeDirectory,
  findFirstFileHandle,
  getMediaSource,
  isDesktopApp,
  openNativeDirectory,
} from '../../src/platform/nativeFs';
import { MemoryDirectory } from '../helpers/memoryFs';

function createDesktopApi(
  overrides: Partial<NonNullable<Window['desktopApi']>> = {},
): NonNullable<Window['desktopApi']> {
  return {
    getUpdateState: async () => ({ status: 'manual', version: null }),
    checkForUpdates: async () => ({ status: 'manual', version: null }),
    installUpdate: async () => false,
    onUpdateState: () => () => undefined,
    readAppConfig: async () => ({}),
    writeAppConfig: async () => {},
    clearPersistentCache: async () => {},
    confirmRemoval: async () => true,
    cacheStats: async () => ({ bytes: 0, path: '', configPath: '' }),
    onBeforeClose: () => () => undefined,
    onNavigate: () => () => undefined,
    readThumbnail: async () => ({ version: 'test', bytes: null }),
    writeThumbnail: async () => true,
    chooseDirectory: async () => 'C:\\photos',
    confirmListMode: async () => true,
    openRoot: async (path) => path,
    openDirectoryExternally: async () => {},
    getLibrary: async () => [],
    toggleFavoriteRoot: async () => true,
    removeRecent: async () => undefined,
    listDirectory: async () => [{ name: 'ONE.PNG', kind: 'file' }],
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    exists: async () => true,
    findFirstFile: async (_directory, names) => names[0] ?? null,
    ...overrides,
  };
}

afterEach(() => {
  delete window.desktopApi;
});

describe('desktop and browser file access', () => {
  it('uses one desktop batch request and creates the selected native handle without another lookup', async () => {
    const findFirstFile = vi.fn(async () => '__0.png');
    const exists = vi.fn();
    window.desktopApi = createDesktopApi({ findFirstFile, exists });
    const directory = await chooseNativeDirectory();
    if (!directory) throw new Error('Expected selected directory');
    const names = ['__0.jpg', '__0.jpeg', '__0.png'];
    const result = await findFirstFileHandle(directory, names);
    expect(result?.name).toBe('__0.png');
    expect(result?.nativePath?.replace(/\\/g, '/')).toBe('C:/photos/__0.png');
    expect(findFirstFile).toHaveBeenCalledExactlyOnceWith(directory.nativePath, names);
    expect(exists).not.toHaveBeenCalled();
  });

  it('ignores a desktop batch result when the request is canceled', async () => {
    let active = true;
    window.desktopApi = createDesktopApi({
      findFirstFile: async () => {
        active = false;
        return '__0.png';
      },
    });
    const directory = await chooseNativeDirectory();
    if (!directory) throw new Error('Expected selected directory');
    expect(await findFirstFileHandle(directory, ['__0.png'], () => active)).toBeNull();
  });

  it('keeps first-candidate browser hits to a single lookup', async () => {
    const root = new MemoryDirectory('root');
    const cover = root.file('__0.jpg');
    const lookup = vi.spyOn(root, 'getFileHandle');
    expect(await findFirstFileHandle(root.asHandle(), [])).toBeNull();
    expect(await findFirstFileHandle(root.asHandle(), ['__0.jpg'], () => false)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(await findFirstFileHandle(root.asHandle(), ['__0.jpg', '__0.png'])).toBe(
      cover.asHandle(),
    );
    expect(lookup).toHaveBeenCalledExactlyOnceWith('__0.jpg');
  });

  it('awaits the bounded browser batch and keeps extension priority despite completion order', async () => {
    const root = new MemoryDirectory('root');
    const first = root.file('__0.jpeg');
    const later = root.file('__0.png');
    const getFile = root.getFileHandle.bind(root);
    let release: (() => void) | undefined;
    const lookup = vi.spyOn(root, 'getFileHandle').mockImplementation(async (name) => {
      if (name === first.name) await new Promise<void>((resolve) => (release = resolve));
      if (name === later.name) throw new DOMException('denied', 'NotAllowedError');
      return getFile(name);
    });
    let complete = false;
    const pending = findFirstFileHandle(root.asHandle(), ['__0.jpg', first.name, later.name]).then(
      (result) => {
        complete = true;
        return result;
      },
    );
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(3));
    expect(complete).toBe(false);
    requireValue(release)();
    expect(await pending).toBe(first.asHandle());
  });

  it('does not choose a lower-priority browser file when an earlier probe fails with a real error', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const getFile = root.getFileHandle.bind(root);
    const error = new DOMException('denied', 'NotAllowedError');
    vi.spyOn(root, 'getFileHandle').mockImplementation(async (name) => {
      if (name === 'cover.jpeg') throw error;
      return getFile(name);
    });
    await expect(
      findFirstFileHandle(root.asHandle(), ['cover.jpg', 'cover.jpeg', 'cover.png']),
    ).rejects.toBe(error);
  });

  it('opens a selected desktop root and reads children through the IPC adapter', async () => {
    const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    window.desktopApi = createDesktopApi({ readFile });
    expect(isDesktopApp()).toBe(true);
    const root = await chooseNativeDirectory();
    expect(root?.name).toBe('photos');
    const entries = [];
    if (!root) throw new Error('Expected selected directory');
    for await (const entry of root.values()) entries.push(entry);
    expect(entries.map((entry) => entry.name)).toEqual(['ONE.PNG']);
    const file = entries[0];
    if (file?.kind !== 'file') throw new Error('Expected a file entry');
    const source = await getMediaSource(file);
    expect(source).toMatchObject({ objectUrl: false });
    const nativePath = file.nativePath;
    if (!nativePath) throw new Error('Expected a native file path');
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
    window.desktopApi = createDesktopApi({ chooseDirectory: async () => null });
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
