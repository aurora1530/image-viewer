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
  state.directoryPreviewCache = new WeakMap();
  for (const url of state.previewUrls) URL.revokeObjectURL(url);
  state.previewUrls.clear();
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
    // プレビューキャッシュも無効化
    const prev = state.directoryPreviewCache.get(dirHandle);
    if (prev && prev.url) {
      URL.revokeObjectURL(prev.url);
      state.previewUrls.delete(prev.url);
    }
    state.directoryPreviewCache.delete(dirHandle);
  }
  return entry;
}

export function invalidateDirectoryCache(dirHandle: FileSystemDirectoryHandle): void {
  const entry = state.directoryPreviewCache.get(dirHandle);
  if (entry && entry.url) {
    URL.revokeObjectURL(entry.url);
    state.previewUrls.delete(entry.url);
  }
  state.directoryCache.delete(dirHandle);
  state.directoryPreviewCache.delete(dirHandle);
}

type ImageSelection = { handle: FileSystemFileHandle; path: string[] };

async function findFirstImageHandle(
  dirHandle: FileSystemDirectoryHandle,
  location?: DirectoryConfigLocation,
): Promise<ImageSelection | null> {
  const preferredBases = ['__0', 'icon', 'thumbnail'];
  const preferredNames = new Set(
    preferredBases.flatMap((base) => CONFIG.IMAGE_EXTENSIONS.map((ext) => `${base}${ext}`)),
  );
  const cached = state.directoryCache.get(dirHandle);
  // Browser handles can find an explicit cover without listing a large directory.
  // Desktop handles use one listing instead of an IPC request for every candidate.
  if (!cached && !dirHandle.nativePath) {
    for (const base of preferredBases) {
      for (const ext of CONFIG.IMAGE_EXTENSIONS) {
        try {
          const handle = await dirHandle.getFileHandle(`${base}${ext}`);
          return { handle, path: [handle.name] };
        } catch {
          // Missing preferred names are expected.
        }
      }
    }
  }
  const items = cached?.items ?? (await buildDirectoryCache(dirHandle)).items;
  const preferred = items.find(
    (item): item is DirectoryCacheImageItem =>
      isImageItem(item) && preferredNames.has(item.nameLower),
  );
  if (preferred) return { handle: preferred.handle, path: [preferred.name] };

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
  const direct = cached
    ? (items.find(isImageItem) ?? items.find((item) => item.type === 'pdf'))
    : items.find((item) => item.type === 'image' || item.type === 'pdf');
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

export async function getDirectoryPreviewUrl(
  dirHandle: FileSystemDirectoryHandle,
  request: ThumbnailRequest = {},
  location?: DirectoryConfigLocation,
): Promise<string | null> {
  const previewCache = state.directoryPreviewCache;
  const cached = previewCache.get(dirHandle);
  if (cached && cached.url) {
    if (CONFIG.ENABLE_DEBUG_LOGS) console.log(`[preview cache hit] ${dirHandle.name}`);
    return cached.url;
  }

  if (request.shouldContinue?.() === false) return null;
  const selected = await findFirstImageHandle(dirHandle, location);
  const handle = selected?.handle;
  if (!handle || request.shouldContinue?.() === false) return null;
  try {
    const tLabel = CONFIG.ENABLE_DEBUG_LOGS ? `previewGen:${dirHandle.name}-${Date.now()}` : null;
    if (tLabel) console.time(tLabel);
    const source = await thumbnailCache.get(handle, request.shouldContinue, request.getPriority);
    if (!source) return null;
    const url = source.url;
    if (previewCache !== state.directoryPreviewCache) {
      if (source.objectUrl) URL.revokeObjectURL(url);
      return null;
    }
    previewCache.set(dirHandle, { url });
    state.previewUrls.add(url);
    if (CONFIG.ENABLE_DEBUG_LOGS) console.log(`[preview set] ${dirHandle.name}`);
    if (tLabel) console.timeEnd(tLabel);
    return url;
  } catch (e) {
    console.error(`プレビューURL生成失敗 (${dirHandle.name}):`, e);
    return null;
  }
}
