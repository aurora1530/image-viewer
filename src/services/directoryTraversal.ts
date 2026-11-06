import type { DirectoryHandle, FileHandle } from '../shared/fileSystem';
import { CONFIG } from '../shared/model';
import {
  compareBaseNumericText,
  compareNumericText,
  isImageFileName,
  getMediaType,
  joinRelativePath,
} from '../shared/utils';
import type { SortOrder } from '../shared/model';
import { listDirectoryEntries } from '../platform/nativeFs';

export type RecursiveMediaItem = {
  type: 'image' | 'video' | 'pdf';
  handle: FileHandle;
  name: string;
  parentHandle: DirectoryHandle;
  parentPath: string;
  path: string;
  isFavorite?: boolean;
  isHidden?: boolean;
  displayIndex?: number;
  nameLower?: string;
};

export async function getImageFilesFromDirectory(
  dirHandle: DirectoryHandle,
  order: SortOrder = 'asc',
): Promise<FileHandle[]> {
  const imageFiles: FileHandle[] = [];
  try {
    for (const entry of await listDirectoryEntries(dirHandle)) {
      if (entry.kind === 'file' && isImageFileName(entry.name, CONFIG.IMAGE_EXTENSIONS)) {
        imageFiles.push(entry);
      }
    }
    imageFiles.sort((a, b) => {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();
      if (order === 'asc') {
        return compareNumericText(nameA, nameB);
      } else {
        return compareNumericText(nameB, nameA);
      }
    });
  } catch (e) {
    console.error(`ディレクトリ内の画像取得エラー (${dirHandle.name}):`, e);
  }
  return imageFiles;
}

export async function collectMediaRecursively(
  dirHandle: DirectoryHandle,
  list: RecursiveMediaItem[] = [],
  basePath = '',
  shouldContinue: () => boolean = () => true,
  onFirstImages?: (images: RecursiveMediaItem[]) => void,
  onReadError?: () => void,
): Promise<RecursiveMediaItem[]> {
  const maxConcurrentReads = 6;
  let activeReads = 0;
  const waiting: Array<() => void> = [];
  async function visit(directory: DirectoryHandle, path: string): Promise<RecursiveMediaItem[]> {
    if (!shouldContinue()) return [];
    if (activeReads >= maxConcurrentReads)
      await new Promise<void>((resolve) => waiting.push(resolve));
    if (!shouldContinue()) {
      waiting.shift()?.();
      return [];
    }
    activeReads++;
    const files: FileHandle[] = [];
    const directories: DirectoryHandle[] = [];
    try {
      for (const entry of await listDirectoryEntries(directory)) {
        if (!shouldContinue()) return [];
        if (entry.kind === 'directory') directories.push(entry);
        else if (getMediaType(entry.name)) files.push(entry);
      }
    } catch (e) {
      onReadError?.();
      console.error('再帰的なメディア取得に失敗', e);
      return [];
    } finally {
      activeReads--;
      waiting.shift()?.();
    }
    files.sort((a, b) => compareBaseNumericText(a.name, b.name));
    const found = files.flatMap((img): RecursiveMediaItem[] => {
      const type = getMediaType(img.name);
      return type
        ? [
            {
              type,
              handle: img,
              name: img.name,
              parentHandle: directory,
              parentPath: path,
              path: joinRelativePath(path, img.name),
            },
          ]
        : [];
    });
    const firstImages = found.filter((item) => item.type === 'image');
    if (firstImages.length && shouldContinue()) onFirstImages?.(firstImages);
    const children = await Promise.all(
      directories.map((entry) => visit(entry, joinRelativePath(path, entry.name))),
    );
    for (const child of children) {
      for (const item of child) found.push(item);
    }
    return found;
  }
  for (const item of await visit(dirHandle, basePath)) list.push(item);
  return list;
}
