import { requireValue } from '../../src/shared/validation';
import { describe, expect, it, vi } from 'vitest';
import {
  collectMediaRecursively,
  getImageFilesFromDirectory,
} from '../../src/services/directoryTraversal';
import { MemoryDirectory } from '../helpers/memoryFs';

describe('image traversal', () => {
  it('collects nested media but previews only images, ignoring unsupported files', async () => {
    const root = new MemoryDirectory('root');
    root.file('1.MP4');
    root.file('2.PDF');
    root.file('notes.txt');
    const child = root.directory('child');
    child.file('3.GIF');
    const preview = vi.fn();
    const result = await collectMediaRecursively(root.asHandle(), [], '', () => true, preview);
    expect(result.map((item) => [item.type, item.path])).toEqual([
      ['video', '1.MP4'],
      ['pdf', '2.PDF'],
      ['image', 'child/3.GIF'],
    ]);
    expect(preview).toHaveBeenCalledOnce();
    expect(preview).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'image', path: 'child/3.GIF' }),
    ]);
  });

  it('ignores non-images and uses numeric filename order in both directions', async () => {
    const root = new MemoryDirectory('root');
    for (const name of ['10.PNG', '2.jpg', 'video.mp4', '1.gif', 'notes.txt']) root.file(name);
    expect((await getImageFilesFromDirectory(root.asHandle())).map((file) => file.name)).toEqual([
      '1.gif',
      '2.jpg',
      '10.PNG',
    ]);
    expect(
      (await getImageFilesFromDirectory(root.asHandle(), 'desc')).map((file) => file.name),
    ).toEqual(['10.PNG', '2.jpg', '1.gif']);
  });

  it('collects nested images with their parent and relative path', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const chapter = root.directory('chapter');
    chapter.file('2.webp');
    const deeper = chapter.directory('deeper');
    deeper.file('1.heic');
    const rootRead = vi.spyOn(root, 'values');
    const childRead = vi.spyOn(chapter, 'values');
    const result = await collectMediaRecursively(root.asHandle());
    expect(rootRead).toHaveBeenCalledOnce();
    expect(childRead).toHaveBeenCalledOnce();
    expect(result.map((item) => [item.path, item.parentPath, item.type])).toEqual([
      ['cover.png', '', 'image'],
      ['chapter/2.webp', 'chapter', 'image'],
      ['chapter/deeper/1.heic', 'chapter/deeper', 'image'],
    ]);
    expect(result[1].parentHandle).toBe(chapter.asHandle());
  });

  it('stops scanning when the view is replaced', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    root.directory('child').file('nested.png');
    let checks = 0;
    const items = await collectMediaRecursively(root.asHandle(), [], '', () => ++checks < 3);
    expect(items).toEqual([]);
  });

  it('reads sibling folders concurrently while preserving their list order', async () => {
    const root = new MemoryDirectory('root');
    const slow = root.directory('slow');
    const fast = root.directory('fast');
    slow.file('one.png');
    fast.file('two.png');
    let releaseSlow: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slowValues = slow.values.bind(slow);
    vi.spyOn(slow, 'values').mockImplementation(async function* () {
      await paused;
      yield* slowValues();
    });
    const fastRead = vi.spyOn(fast, 'values');
    const result = collectMediaRecursively(root.asHandle());
    await vi.waitFor(() => expect(fastRead).toHaveBeenCalledOnce());
    requireValue(releaseSlow)();
    expect((await result).map((item) => item.path)).toEqual(['slow/one.png', 'fast/two.png']);
  });

  it('reports the first image before the complete subtree has been scanned', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    child.file('later.png');
    let releaseChild: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const childValues = child.values.bind(child);
    vi.spyOn(child, 'values').mockImplementation(async function* () {
      await paused;
      yield* childValues();
    });
    const firstImages = vi.fn();
    const result = collectMediaRecursively(root.asHandle(), [], '', () => true, firstImages);
    await vi.waitFor(() =>
      expect(firstImages).toHaveBeenCalledWith([expect.objectContaining({ path: 'cover.png' })]),
    );
    requireValue(releaseChild)();
    expect((await result).map((item) => item.path)).toEqual(['cover.png', 'child/later.png']);
  });

  it('keeps already collected files when a child directory cannot be read', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    vi.spyOn(child, 'values').mockImplementation(async function* () {
      throw new Error('unreadable');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await collectMediaRecursively(root.asHandle())).map((item) => item.path)).toEqual([
      'cover.png',
    ]);
  });
});
