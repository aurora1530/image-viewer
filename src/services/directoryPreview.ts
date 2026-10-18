import { CONFIG } from '../shared/model';
import { isImageFileName } from '../shared/utils';
import { iterateDirectoryEntries } from '../platform/nativeFs';
import { readDirectoryThumbnail, saveDirectoryThumbnail } from './storage';
import type { DirectoryConfigLocation } from './storage';
import { thumbnailCache } from './thumbnailCache';
import { createThumbnailQueue } from './thumbnailQueue';
import type { ThumbnailRequest } from './thumbnailQueue';
import { originalImageCache } from './originalImageCache';

// Enumeration is expensive with browser handles. Keep it separate from encoding
// so a slow image cannot hold up another folder's file selection.
const previewSearches = createThumbnailQueue(4);

export function clearThumbnailCaches(): void {
  previewSearches.clear();
  thumbnailCache.clear();
  originalImageCache.clear();
}

export type DirectoryPreviewFile = { handle: FileSystemFileHandle; path: string[] };

async function findPreferredFile(
  dirHandle: FileSystemDirectoryHandle,
  shouldContinue: () => boolean,
): Promise<DirectoryPreviewFile | null> {
  for (const base of ['__0', 'icon', 'thumbnail']) {
    for (const extension of CONFIG.IMAGE_EXTENSIONS) {
      if (!shouldContinue()) return null;
      try {
        const handle = await dirHandle.getFileHandle(`${base}${extension}`);
        return shouldContinue() ? { handle, path: [handle.name] } : null;
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
        )
          continue;
        throw error;
      }
    }
  }
  return null;
}

async function readSavedPreviewFile(
  dirHandle: FileSystemDirectoryHandle,
  location: DirectoryConfigLocation,
  shouldContinue: () => boolean,
): Promise<DirectoryPreviewFile | null> {
  const previous = await readDirectoryThumbnail(location);
  if (!previous || !shouldContinue()) return null;
  try {
    const path = previous.path;
    const name = path[path.length - 1];
    if (!isImageFileName(name, CONFIG.IMAGE_EXTENSIONS) && !/\.pdf$/i.test(name)) return null;
    let parent = dirHandle;
    for (const segment of path.slice(0, -1)) {
      if (!shouldContinue()) return null;
      parent = await parent.getDirectoryHandle(segment);
    }
    const handle = await parent.getFileHandle(name);
    return shouldContinue() ? { handle, path } : null;
  } catch {
    // A removed or renamed source falls back to the normal search.
    return null;
  }
}

export async function selectDirectoryPreviewFile(
  dirHandle: FileSystemDirectoryHandle,
  location?: DirectoryConfigLocation,
  shouldContinue: () => boolean = () => true,
): Promise<DirectoryPreviewFile | null> {
  if (!shouldContinue()) return null;
  // Probe known paths before reading any unrelated entries. Gallery listings
  // remain independent from representative-image selection.
  try {
    const preferred = await findPreferredFile(dirHandle, shouldContinue);
    if (!shouldContinue()) return null;
    if (preferred) return rememberPreferred(preferred, location);
    if (location) {
      const previous = await readSavedPreviewFile(dirHandle, location, shouldContinue);
      if (!shouldContinue()) return null;
      if (previous) return previous;
    }
  } catch (error) {
    console.error(`代表画像の取得に失敗 (${dirHandle.name}):`, error);
    return null;
  }

  // Enumerate only when neither a preferred file nor a valid saved path exists.
  let direct: FileSystemFileHandle | undefined;
  let child: FileSystemDirectoryHandle | undefined;
  try {
    for await (const entry of iterateDirectoryEntries(dirHandle, shouldContinue)) {
      if (entry.kind === 'directory') {
        child ??= entry;
        continue;
      }
      if (isImageFileName(entry.name, CONFIG.IMAGE_EXTENSIONS) || /\.pdf$/i.test(entry.name)) {
        direct = entry;
        break;
      }
    }
  } catch (error) {
    console.error(`代表画像の探索に失敗 (${dirHandle.name}):`, error);
    return null;
  }
  if (!shouldContinue()) return null;
  // Keep the existing fallback: direct media, then only the first subdirectory.
  let result: DirectoryPreviewFile | null = null;
  if (direct) {
    result = { handle: direct, path: [direct.name] };
  } else if (child) {
    const selected = await selectDirectoryPreviewFile(
      child,
      location ? { ...location, path: [...location.path, child.name] } : undefined,
      shouldContinue,
    );
    if (selected) result = { handle: selected.handle, path: [child.name, ...selected.path] };
  }
  if (!shouldContinue()) return null;
  if (location) await saveDirectoryThumbnail(location, result?.path ?? null);
  return result;
}

async function rememberPreferred(
  selected: DirectoryPreviewFile,
  location?: DirectoryConfigLocation,
): Promise<DirectoryPreviewFile> {
  if (location) {
    const previous = await readDirectoryThumbnail(location);
    if (previous?.path.length !== 1 || previous.path[0] !== selected.path[0])
      await saveDirectoryThumbnail(location, selected.path);
  }
  return selected;
}

export async function getDirectoryPreview(
  dirHandle: FileSystemDirectoryHandle,
  request: ThumbnailRequest = {},
  location?: DirectoryConfigLocation,
): Promise<{ url: string; objectUrl: boolean } | null> {
  if (request.shouldContinue?.() === false) return null;
  const selected = await previewSearches.enqueue(
    () => selectDirectoryPreviewFile(dirHandle, location, request.shouldContinue),
    request,
  );
  if (!selected || request.shouldContinue?.() === false) return null;
  try {
    const source = await thumbnailCache.get(
      selected.handle,
      request.shouldContinue,
      request.getPriority,
    );
    if (request.shouldContinue?.() === false) {
      if (source?.objectUrl) URL.revokeObjectURL(source.url);
      return null;
    }
    return source;
  } catch (e) {
    console.error(`プレビュー生成失敗 (${dirHandle.name}):`, e);
    return null;
  }
}
