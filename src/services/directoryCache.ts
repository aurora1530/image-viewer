import { CONFIG } from '../shared/model';
import { state } from './directoryResources';
import type {
  DirectoryCacheEntry,
  DirectoryCacheItem,
  DirectoryCacheDirectoryItem,
  DirectoryCacheImageItem,
} from '../shared/model';
import { isImageFileName } from '../shared/utils';
import { listDirectoryEntries } from '../platform/nativeFs';
import { thumbnailCache } from './thumbnailCache';
import type { ThumbnailRequest } from './thumbnailQueue';
import { originalImageCache } from './originalImageCache';
import { readDirectoryThumbnail, saveDirectoryThumbnail } from './storage';
import type { DirectoryConfigLocation } from './storage';
type CacheEntry = DirectoryCacheEntry;
type CacheItem = DirectoryCacheItem;

const isDirectoryHandle = (
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemDirectoryHandle => handle.kind === 'directory';

const isFileHandle = (
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemFileHandle => handle.kind === 'file';

const isImageItem = (item: CacheItem): item is DirectoryCacheImageItem => item.type === 'image';
const isDirectoryItem = (item: CacheItem): item is DirectoryCacheDirectoryItem =>
  item.type === 'directory';

export function clearThumbnailCaches(): void {
  thumbnailCache.clear();
  originalImageCache.clear();
}

export async function buildDirectoryCache(
  dirHandle: FileSystemDirectoryHandle,
): Promise<CacheEntry> {
  const items: CacheItem[] = [];
  let imageCount = 0;
  try {
    for (const entry of await listDirectoryEntries(dirHandle)) {
      if (isDirectoryHandle(entry)) {
        items.push({
          type: 'directory',
          handle: entry,
          name: entry.name,
          nameLower: entry.name.toLowerCase(),
        });
      } else if (isFileHandle(entry)) {
        const lowerName = entry.name.toLowerCase();
        if (isImageFileName(lowerName, CONFIG.IMAGE_EXTENSIONS)) {
          items.push({ type: 'image', handle: entry, name: entry.name, nameLower: lowerName });
          imageCount++;
        } else if (lowerName.endsWith('.pdf')) {
          items.push({ type: 'pdf', handle: entry, name: entry.name, nameLower: lowerName });
        } else if (CONFIG.VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
          items.push({ type: 'video', handle: entry, name: entry.name, nameLower: lowerName });
        }
      }
    }
  } catch (e) {
    console.error(`ディレクトリ取得エラー (${dirHandle.name}):`, e);
  }
  return { items, imageCount, sorted: {} };
}

export async function ensureDirectoryCache(
  dirHandle: FileSystemDirectoryHandle,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<CacheEntry> {
  let entry = state.directoryCache.get(dirHandle);
  if (!entry || forceRefresh) {
    entry = await buildDirectoryCache(dirHandle);
    state.directoryCache.set(dirHandle, entry);
  }
  return entry;
}

export function invalidateDirectoryCache(dirHandle: FileSystemDirectoryHandle): void {
  state.directoryCache.delete(dirHandle);
}

type ImageSelection = { handle: FileSystemFileHandle; path: string[] };

async function findFirstImageHandle(
  dirHandle: FileSystemDirectoryHandle,
  location?: DirectoryConfigLocation,
): Promise<ImageSelection | null> {
  const preferredBases = ['__0', 'icon', 'thumbnail'];
  const preferredNames = preferredBases.flatMap((base) =>
    CONFIG.IMAGE_EXTENSIONS.map((ext) => `${base}${ext}`),
  );
  // Selection must see newly added covers, even when the gallery listing is cached.
  const items = (await buildDirectoryCache(dirHandle)).items;
  const preferred = preferredNames
    .map((name) =>
      items.find(
        (item): item is DirectoryCacheImageItem => isImageItem(item) && item.nameLower === name,
      ),
    )
    .find((item) => item !== undefined);
  if (preferred)
    return rememberPreferred({ handle: preferred.handle, path: [preferred.name] }, location);

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
  const direct = items.find((item) => item.type === 'image' || item.type === 'pdf');
  let result: ImageSelection | null = null;
  if (direct) {
    result = { handle: direct.handle, path: [direct.name] };
  } else {
    const child = items.find(isDirectoryItem);
    if (child) {
      const selected = await findFirstImageHandle(
        child.handle,
        location ? { ...location, path: [...location.path, child.name] } : undefined,
      );
      if (selected) result = { handle: selected.handle, path: [child.name, ...selected.path] };
    }
  }
  if (location) await saveDirectoryThumbnail(location, result?.path ?? null);
  return result;
}

async function rememberPreferred(
  selected: ImageSelection,
  location?: DirectoryConfigLocation,
): Promise<ImageSelection> {
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
  const selected = await findFirstImageHandle(dirHandle, location);
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
