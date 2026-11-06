import type { DirectoryHandle, FileHandle } from '../shared/fileSystem';
import { state } from './directoryResources';
import type { DirectoryCacheEntry, DirectoryCacheItem } from '../shared/model';
import { getMediaType } from '../shared/utils';
import { listDirectoryEntries } from '../platform/nativeFs';
type CacheEntry = DirectoryCacheEntry;
type CacheItem = DirectoryCacheItem;

const isDirectoryHandle = (handle: DirectoryHandle | FileHandle): handle is DirectoryHandle =>
  handle.kind === 'directory';

const isFileHandle = (handle: DirectoryHandle | FileHandle): handle is FileHandle =>
  handle.kind === 'file';

export async function buildDirectoryCache(dirHandle: DirectoryHandle): Promise<CacheEntry> {
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
        const type = getMediaType(lowerName);
        if (type) {
          items.push({ type, handle: entry, name: entry.name, nameLower: lowerName });
          if (type === 'image') imageCount++;
        }
      }
    }
  } catch (e) {
    console.error(`ディレクトリ取得エラー (${dirHandle.name}):`, e);
  }
  return { items, imageCount, sorted: {} };
}

export async function ensureDirectoryCache(
  dirHandle: DirectoryHandle,
  { forceRefresh = false }: { forceRefresh?: boolean } = {},
): Promise<CacheEntry> {
  let entry = state.directoryCache.get(dirHandle);
  if (!entry || forceRefresh) {
    entry = await buildDirectoryCache(dirHandle);
    state.directoryCache.set(dirHandle, entry);
  }
  return entry;
}

export function invalidateDirectoryCache(dirHandle: DirectoryHandle): void {
  state.directoryCache.delete(dirHandle);
}
