import { CONFIG, state } from './state';
import type {
	DirectoryCacheEntry,
	DirectoryCacheItem,
	DirectoryCacheDirectoryItem,
	DirectoryCacheImageItem
} from './state';
import { isImageFileName } from './utils';
import { getMediaSource } from './nativeFs';
type CacheEntry = DirectoryCacheEntry;
type CacheItem = DirectoryCacheItem;

const isDirectoryHandle = (
	handle: FileSystemDirectoryHandle | FileSystemFileHandle
): handle is FileSystemDirectoryHandle => handle.kind === 'directory';

const isFileHandle = (
	handle: FileSystemDirectoryHandle | FileSystemFileHandle
): handle is FileSystemFileHandle => handle.kind === 'file';

const isImageItem = (item: CacheItem): item is DirectoryCacheImageItem => item.type === 'image';
const isDirectoryItem = (item: CacheItem): item is DirectoryCacheDirectoryItem => item.type === 'directory';

export async function buildDirectoryCache(dirHandle: FileSystemDirectoryHandle): Promise<CacheEntry> {
	const items: CacheItem[] = [];
	let imageCount = 0;
	try {
		for await (const entry of dirHandle.values()) {
			if (isDirectoryHandle(entry)) {
				items.push({ type: 'directory', handle: entry, name: entry.name, nameLower: entry.name.toLowerCase() });
			} else if (isFileHandle(entry)) {
				const lowerName = entry.name.toLowerCase();
				if (isImageFileName(lowerName, CONFIG.IMAGE_EXTENSIONS)) {
					items.push({ type: 'image', handle: entry, name: entry.name, nameLower: lowerName });
					imageCount++;
				} else if (CONFIG.VIDEO_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
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
	{ forceRefresh = false }: { forceRefresh?: boolean } = {}
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

async function findFirstImageHandle(dirHandle: FileSystemDirectoryHandle): Promise<FileSystemFileHandle | null> {
	const preferredBases = ['__0', 'icon', 'thumbnail'];
	const preferredNames = new Set(
		preferredBases.flatMap(base => CONFIG.IMAGE_EXTENSIONS.map(ext => `${base}${ext}`))
	);

	// 1) ダイレクトに名前指定で探す（巨大ディレクトリでも O(候補数) で完了）
	for (const base of preferredBases) {
		for (const ext of CONFIG.IMAGE_EXTENSIONS) {
			const fileName = `${base}${ext}`;
			try {
				const fh = await dirHandle.getFileHandle(fileName);
				if (fh) return fh;
			} catch (_) {
				/* ignore missing */
			}
		}
	}

	// まずキャッシュを優先的に見る（並び替えず O(1) でチェック）
	const cached = state.directoryCache.get(dirHandle);
	if (cached && cached.items) {
		const directPreferred = cached.items.find((i): i is DirectoryCacheImageItem =>
			isImageItem(i) && preferredNames.has(i.nameLower)
		);
		if (directPreferred) return directPreferred.handle;
		const directAny = cached.items.find((i): i is DirectoryCacheImageItem => isImageItem(i));
		if (directAny) return directAny.handle;
		const firstDir = cached.items.find((i): i is DirectoryCacheDirectoryItem => isDirectoryItem(i));
		if (firstDir) {
			return findFirstImageHandle(firstDir.handle);
		}
	}

	// キャッシュが無い or 不足している場合は実際に走査
	let firstSubDir: FileSystemDirectoryHandle | null = null;
	let firstImage: FileSystemFileHandle | null = null;
	try {
		const tLabel = CONFIG.ENABLE_DEBUG_LOGS ? `findFirstImageHandle:${dirHandle.name}-${Date.now()}` : null;
		if (tLabel) console.time(tLabel);
		for await (const entry of dirHandle.values()) {
			if (isFileHandle(entry) && isImageFileName(entry.name, CONFIG.IMAGE_EXTENSIONS)) {
				const lower = entry.name.toLowerCase();
				if (preferredNames.has(lower)) {
					if (tLabel) console.timeEnd(tLabel);
					return entry;
				}
				if (!firstImage) firstImage = entry;
			}
			if (!firstSubDir && isDirectoryHandle(entry)) {
				firstSubDir = entry;
			}
		}
		if (tLabel) console.timeEnd(tLabel);
	} catch (e) {
		console.error(`プレビュー用画像探索エラー (${dirHandle.name}):`, e);
	}

	if (firstImage) return firstImage;
	if (firstSubDir) return findFirstImageHandle(firstSubDir);
	return null;
}

export async function getDirectoryPreviewUrl(dirHandle: FileSystemDirectoryHandle): Promise<string | null> {
	const cached = state.directoryPreviewCache.get(dirHandle);
	if (cached && cached.url) {
		if (CONFIG.ENABLE_DEBUG_LOGS) console.log(`[preview cache hit] ${dirHandle.name}`);
		return cached.url;
	}

	const handle = await findFirstImageHandle(dirHandle);
	if (!handle) return null;
	try {
		const tLabel = CONFIG.ENABLE_DEBUG_LOGS ? `previewGen:${dirHandle.name}-${Date.now()}` : null;
		if (tLabel) console.time(tLabel);
		const source = await getMediaSource(handle);
		const url = source.url;
		state.directoryPreviewCache.set(dirHandle, { url });
		state.previewUrls.add(url);
		if (CONFIG.ENABLE_DEBUG_LOGS) console.log(`[preview set] ${dirHandle.name}`);
		if (tLabel) console.timeEnd(tLabel);
		return url;
	} catch (e) {
		console.error(`プレビューURL生成失敗 (${dirHandle.name}):`, e);
		return null;
	}
}
