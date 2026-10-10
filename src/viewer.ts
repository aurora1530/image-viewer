import type {
	DirectoryCacheEntry,
	DirectoryCacheImageItem,
	DirectoryCacheItem
} from './state';
import type { StatusType } from './ui';
import { getMediaSource } from './nativeFs';
import { compareNumericText } from './utils';
import { createImagePageCache } from './imagePageCache';

type CacheItem = DirectoryCacheItem;
type CacheEntry = DirectoryCacheEntry;

type ViewerDeps = {
	viewer: HTMLElement;
	viewerPages: HTMLElement;
	viewerVideoContainer: HTMLElement;
	viewerToolbar: HTMLElement;
	listToolbar: HTMLElement;
	leftPageImg: HTMLImageElement;
	rightPageImg: HTMLImageElement;
	viewerVideo: HTMLVideoElement;
	pageCounter: HTMLElement;
	getCurrentImageFiles: () => FileSystemFileHandle[];
	setCurrentImageFiles: (files: FileSystemFileHandle[]) => void;
	getCurrentImageIndex: () => number;
	setCurrentImageIndex: (index: number) => void;
	getPageOffset: () => number;
	setPageOffset: (offset: number) => void;
	getSortOrder: () => 'asc' | 'desc';
	getIsSinglePageView: () => boolean;
	setIsSinglePageView: (value: boolean) => void;
	updateViewModeUI: () => void;
	showStatus: (message: string, type: StatusType) => void;
	ensureDirectoryCache: (dirHandle: FileSystemDirectoryHandle) => Promise<CacheEntry>;
};

export function createViewer(deps: ViewerDeps) {
	const {
		viewer,
		viewerPages,
		viewerVideoContainer,
		viewerToolbar,
		listToolbar,
		leftPageImg,
		rightPageImg,
		viewerVideo,
		pageCounter,
		getCurrentImageFiles,
		setCurrentImageFiles,
		getCurrentImageIndex,
		setCurrentImageIndex,
		getPageOffset,
		setPageOffset,
		getSortOrder,
		getIsSinglePageView,
		setIsSinglePageView,
		updateViewModeUI,
		showStatus,
		ensureDirectoryCache
	} = deps;

	const imageCache = createImagePageCache();
	let viewerSession = 0;
	let displayToken = 0;
	let mediaMode: 'closed' | 'image' | 'video' = 'closed';
	let videoSource: { url: string; objectUrl: boolean } | null = null;

	function resetMedia() {
		viewerSession++;
		displayToken++;
		mediaMode = 'closed';
		leftPageImg.removeAttribute('src');
		rightPageImg.removeAttribute('src');
		leftPageImg.dataset.url = '';
		rightPageImg.dataset.url = '';
		imageCache.clear();
		setCurrentImageFiles([]);
		pageCounter.textContent = '';
		if (videoSource || viewerVideo.hasAttribute('src')) {
			viewerVideo.pause();
			viewerVideo.removeAttribute('src');
			viewerVideo.load();
		}
		if (videoSource?.objectUrl) URL.revokeObjectURL(videoSource.url);
		videoSource = null;
		return viewerSession;
	}

	function isImageItem(item: CacheItem): item is DirectoryCacheImageItem {
		return item.type === 'image';
	}

	async function openViewer(dirHandle: FileSystemDirectoryHandle, startIndex: number, overrideImageList: FileSystemFileHandle[] | null = null) {
		const session = resetMedia();
		mediaMode = 'image';
		try {
			showStatus('<div class="loader mx-auto"></div><p class="mt-2">画像を読み込んでいます...</p>', 'loading');
			if (Array.isArray(overrideImageList) && overrideImageList.length > 0) {
				setCurrentImageFiles(overrideImageList.slice());
			} else {
				const cacheEntry = await ensureDirectoryCache(dirHandle);
				if (session !== viewerSession) return;
				const sortKey = getSortOrder();
				if (!cacheEntry.sorted[sortKey]) {
					const sorted = [...cacheEntry.items].sort((a, b) => {
						const nameA = (a.nameLower || a.name.toLowerCase());
						const nameB = (b.nameLower || b.name.toLowerCase());
						return sortKey === 'asc'
							? compareNumericText(nameA, nameB)
							: compareNumericText(nameB, nameA);
					});
					cacheEntry.sorted[sortKey] = sorted;
				}
				const sortedItems = cacheEntry.sorted[sortKey] ?? [];
				setCurrentImageFiles(
					sortedItems
						.filter(isImageItem)
						.map((i) => i.handle)
				);
			}
			if (getCurrentImageFiles().length === 0) {
				closeViewer();
				showStatus('このフォルダには表示できる画像がありません。', 'info');
				return;
			}
			setCurrentImageIndex(startIndex);
			setPageOffset(0);
			setIsSinglePageView(localStorage.getItem('isSinglePageView') === '1');
			viewer.style.display = 'flex';
			viewerPages.style.display = 'flex';
			viewerVideoContainer.classList.add('hidden');
			viewerToolbar.style.display = 'flex';
			listToolbar.style.display = 'none';
			document.body.style.overflow = 'hidden';
			updateViewModeUI();
			await displayPages();
			if (session === viewerSession) showStatus('', 'clear');
		} catch (err) {
			if (session !== viewerSession) return;
			console.error('ビューワー起動エラー:', err);
			showStatus('画像の読み込みに失敗しました。', 'error');
			closeViewer();
		}
	}

	async function openVideoPlayer(videoHandle: FileSystemFileHandle) {
		const session = resetMedia();
		mediaMode = 'video';
		try {
			viewer.style.display = 'flex';
			viewerPages.style.display = 'none';
			viewerVideoContainer.classList.remove('hidden');
			viewerToolbar.style.display = 'none';
			listToolbar.style.display = 'none';
			document.body.style.overflow = 'hidden';
			const source = await getMediaSource(videoHandle);
			if (session !== viewerSession) {
				if (source.objectUrl) URL.revokeObjectURL(source.url);
				return;
			}
			const url = source.url;
			videoSource = source;
			viewerVideo.loop = true;
			viewerVideo.src = url;
			void viewerVideo.play().catch(error => {
				if (session === viewerSession) console.error('動画の再生を開始できませんでした:', error);
			});
		} catch (err) {
			if (session !== viewerSession) return;
			console.error("動画再生エラー:", err);
			showStatus('動画の再生に失敗しました。', 'error');
			closeViewer();
		}
	}

	function closeViewer() {
		resetMedia();
		viewer.style.display = 'none';
		listToolbar.style.display = '';
		document.body.style.overflow = 'auto';
		if (document.fullscreenElement) document.exitFullscreen();
	}

	async function displayPages() {
		if (mediaMode !== 'image') return;
		const session = viewerSession;
		const token = ++displayToken;
		const files = getCurrentImageFiles();
		const total = files.length;
		if (!total) return;
		const single = getIsSinglePageView();
		const index = getCurrentImageIndex();
		let baseIndex = index;
		if (baseIndex % 2 !== 0 && baseIndex > 0) baseIndex--;
		const rightIndex = single ? index : baseIndex - getPageOffset();
		const leftIndex = single ? -1 : baseIndex + 1 - getPageOffset();
		const visible = [rightIndex, leftIndex].filter(i => i >= 0 && i < total);
		const neighbors: FileSystemFileHandle[] = [];
		if (visible.length) {
			// 表示中の最大2枚と、前後各2枚を保持する。端では先頭・末尾につなぐ。
			const first = Math.min(...visible);
			const last = Math.max(...visible);
			for (const i of [last + 1, last + 2, first - 1, first - 2]) {
				const handle = files[(i + total) % total];
				if (!visible.some(v => files[v] === handle) && !neighbors.includes(handle)) neighbors.push(handle);
			}
		}
		imageCache.retain([...visible.map(i => files[i]), ...neighbors]);
		const load = async (i: number) => {
			if (i < 0 || i >= total) return null;
			try {
				return await imageCache.get(files[i]);
			} catch (err) {
				if (session === viewerSession && token === displayToken) console.error(`画像表示エラー (index: ${i}):`, err);
				return null;
			}
		};
		const [right, left] = await Promise.all([load(rightIndex), load(leftIndex)]);
		if (session !== viewerSession || token !== displayToken) return;
		viewerPages.classList.toggle('single-view', single);
		for (const [element, page] of [[rightPageImg, right], [leftPageImg, left]] as const) {
			if (page) {
				if (element.dataset.url !== page.url) element.src = page.url;
				element.dataset.url = page.url;
				element.style.visibility = 'visible';
			} else {
				element.removeAttribute('src');
				element.dataset.url = '';
				element.style.visibility = 'hidden';
			}
		}
		const pageNumber = (i: number) => i >= 0 && i < total ? i + 1 : '-';
		pageCounter.textContent = single ? `${index + 1} / ${total}` : `${pageNumber(leftIndex)} - ${pageNumber(rightIndex)} / ${total}`;
		void preloadNeighbors(neighbors, session, token);
	}

	async function preloadNeighbors(handles: FileSystemFileHandle[], session: number, token: number) {
		// 表示対象のデコード完了後に1枚ずつ読み、現在ページの処理を優先する。
		for (const handle of handles) {
			if (session !== viewerSession || token !== displayToken) return;
			try { await imageCache.get(handle); } catch { /* 表示時に再試行する */ }
		}
	}

	function navigatePages(direction: number) {
		const total = getCurrentImageFiles().length;
		if (total <= 1) return;

		let newIndex = getCurrentImageIndex() + direction;

		if (newIndex >= total) {
			newIndex = 0;
		} else if (newIndex < 0) {
			if (getIsSinglePageView()) {
				newIndex = total - 1;
			} else {
				let lastSpreadIndex = (total % 2 === 0) ? total - 2 : total - 1;
				newIndex = lastSpreadIndex < 0 ? 0 : lastSpreadIndex;
			}
		}

		if (newIndex !== getCurrentImageIndex()) {
			setCurrentImageIndex(newIndex);
			displayPages();
		}
	}

	return {
		openViewer,
		openVideoPlayer,
		closeViewer,
		displayPages,
		navigatePages
	};
}
