import { CONFIG } from '../shared/model';
import { isImageFileName } from '../shared/utils';
import { listDirectoryEntries } from '../platform/nativeFs';
import { readDirectoryThumbnail, saveDirectoryThumbnail } from './storage';
import type { DirectoryConfigLocation } from './storage';
import { thumbnailCache } from './thumbnailCache';
import type { ThumbnailRequest } from './thumbnailQueue';
import { originalImageCache } from './originalImageCache';

export function clearThumbnailCaches(): void {
  thumbnailCache.clear();
  originalImageCache.clear();
}

export type DirectoryPreviewFile = { handle: FileSystemFileHandle; path: string[] };

export async function selectDirectoryPreviewFile(
  dirHandle: FileSystemDirectoryHandle,
  location?: DirectoryConfigLocation,
): Promise<DirectoryPreviewFile | null> {
  const preferredBases = ['__0', 'icon', 'thumbnail'];
  const preferredNames = preferredBases.flatMap((base) =>
    CONFIG.IMAGE_EXTENSIONS.map((ext) => `${base}${ext}`),
  );
  // File selection reads the filesystem directly, independently of gallery/view data.
  let entries: Awaited<ReturnType<typeof listDirectoryEntries>>;
  try {
    entries = await listDirectoryEntries(dirHandle);
  } catch (error) {
    console.error(`代表画像の探索に失敗 (${dirHandle.name}):`, error);
    return null;
  }
  const preferred = preferredNames
    .map((name) =>
      entries.find(
        (entry): entry is FileSystemFileHandle =>
          entry.kind === 'file' && entry.name.toLowerCase() === name,
      ),
    )
    .find((entry) => entry !== undefined);
  if (preferred) return rememberPreferred({ handle: preferred, path: [preferred.name] }, location);

  if (location) {
    const previous = await readDirectoryThumbnail(location);
    if (previous) {
      try {
        const path = previous.path;
        const name = path[path.length - 1];
        if (isImageFileName(name, CONFIG.IMAGE_EXTENSIONS) || /\.pdf$/i.test(name)) {
          let parent = dirHandle;
          for (const segment of path.slice(0, -1))
            parent = await parent.getDirectoryHandle(segment);
          const handle = await parent.getFileHandle(name);
          return { handle, path };
        }
      } catch {
        // A removed or renamed source falls back to the normal search.
      }
    }
  }

  // Keep the existing fallback: direct media, then only the first subdirectory.
  const direct = entries.find(
    (entry): entry is FileSystemFileHandle =>
      entry.kind === 'file' &&
      (isImageFileName(entry.name, CONFIG.IMAGE_EXTENSIONS) || /\.pdf$/i.test(entry.name)),
  );
  let result: DirectoryPreviewFile | null = null;
  if (direct) {
    result = { handle: direct, path: [direct.name] };
  } else {
    const child = entries.find(
      (entry): entry is FileSystemDirectoryHandle => entry.kind === 'directory',
    );
    if (child) {
      const selected = await selectDirectoryPreviewFile(
        child,
        location ? { ...location, path: [...location.path, child.name] } : undefined,
      );
      if (selected) result = { handle: selected.handle, path: [child.name, ...selected.path] };
    }
  }
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
  const selected = await selectDirectoryPreviewFile(dirHandle, location);
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
