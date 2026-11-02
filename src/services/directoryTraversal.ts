import type { DirectoryHandle, FileHandle } from '../shared/fileSystem';
import { CONFIG } from '../shared/model';
import {
  compareBaseNumericText,
  compareNumericText,
  isImageFileName,
  joinRelativePath,
} from '../shared/utils';
import type { SortOrder } from '../shared/model';
import { listDirectoryEntries } from '../platform/nativeFs';

export type RecursiveImageItem = {
  handle: FileHandle;
  name: string;
  parentHandle: DirectoryHandle;
  imageIndex: number;
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

export async function collectImagesRecursively(
  dirHandle: DirectoryHandle,
  list: RecursiveImageItem[] = [],
  basePath = '',
  shouldContinue: () => boolean = () => true,
  onFirstImages?: (images: RecursiveImageItem[]) => void,
  onReadError?: () => void,
): Promise<RecursiveImageItem[]> {
  const maxConcurrentReads = 6;
  let activeReads = 0;
  const waiting: Array<() => void> = [];
  async function visit(directory: DirectoryHandle, path: string): Promise<RecursiveImageItem[]> {
    if (!shouldContinue()) return [];
    if (activeReads >= maxConcurrentReads)
      await new Promise<void>((resolve) => waiting.push(resolve));
    if (!shouldContinue()) {
      waiting.shift()?.();
      return [];
    }
    activeReads++;
    const images: FileHandle[] = [];
    const directories: DirectoryHandle[] = [];
    try {
      for (const entry of await listDirectoryEntries(directory)) {
        if (!shouldContinue()) return [];
        if (entry.kind === 'directory') directories.push(entry);
        else if (isImageFileName(entry.name, CONFIG.IMAGE_EXTENSIONS)) images.push(entry);
      }
    } catch (e) {
      onReadError?.();
      console.error('再帰的な画像取得に失敗', e);
      return [];
    } finally {
      activeReads--;
      waiting.shift()?.();
    }
    images.sort((a, b) => compareBaseNumericText(a.name, b.name));
    const found = images.map((img, idx) => ({
      handle: img,
      name: img.name,
      parentHandle: directory,
      imageIndex: idx,
      parentPath: path,
      path: joinRelativePath(path, img.name),
    }));
    if (found.length && shouldContinue()) onFirstImages?.(found);
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
