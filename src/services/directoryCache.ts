import { CONFIG } from '../shared/model';
import { state } from './directoryResources';
import type { DirectoryCacheEntry, DirectoryCacheItem } from '../shared/model';
import { isImageFileName } from '../shared/utils';
import { listDirectoryEntries } from '../platform/nativeFs';
type CacheEntry = DirectoryCacheEntry;
type CacheItem = DirectoryCacheItem;

const isDirectoryHandle = (
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemDirectoryHandle => handle.kind === 'directory';

const isFileHandle = (
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
): handle is FileSystemFileHandle => handle.kind === 'file';

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
