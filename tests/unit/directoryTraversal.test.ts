import { describe, expect, it, vi } from 'vitest';
import { collectImagesRecursively, getImageFilesFromDirectory } from '../../src/directoryTraversal';
import { MemoryDirectory } from '../helpers/memoryFs';

describe('image traversal', () => {
  it('ignores non-images and uses numeric filename order in both directions', async () => {
    const root = new MemoryDirectory('root');
    for (const name of ['10.PNG', '2.jpg', 'video.mp4', '1.gif', 'notes.txt']) root.file(name);
    expect((await getImageFilesFromDirectory(root.asHandle())).map(file => file.name)).toEqual(['1.gif', '2.jpg', '10.PNG']);
    expect((await getImageFilesFromDirectory(root.asHandle(), 'desc')).map(file => file.name)).toEqual(['10.PNG', '2.jpg', '1.gif']);
  });

  it('collects nested images with their parent and relative path', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const chapter = root.directory('chapter');
    chapter.file('2.webp');
    const deeper = chapter.directory('deeper');
    deeper.file('1.heic');
    const result = await collectImagesRecursively(root.asHandle());
    expect(result.map(item => [item.path, item.parentPath, item.imageIndex])).toEqual([
      ['cover.png', '', 0], ['chapter/2.webp', 'chapter', 0],
      ['chapter/deeper/1.heic', 'chapter/deeper', 0]
    ]);
    expect(result[1].parentHandle).toBe(chapter.asHandle());
  });

  it('keeps already collected files when a child directory cannot be read', async () => {
    const root = new MemoryDirectory('root');
    root.file('cover.png');
    const child = root.directory('child');
    vi.spyOn(child, 'values').mockImplementation(async function* () { throw new Error('unreadable'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await collectImagesRecursively(root.asHandle())).map(item => item.path)).toEqual(['cover.png']);
  });
});
