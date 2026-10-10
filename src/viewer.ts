import type {
	DirectoryCacheEntry,
	DirectoryCacheImageItem,
	DirectoryCacheItem
} from './state';
import type { StatusType } from './ui';
import { getMediaSource } from './nativeFs';
import { compareNumericText } from './utils';

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
	createdUrls: Set<string>;
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
		createdUrls,
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

	function isImageItem(item: CacheItem): item is DirectoryCacheImageItem {
		return item.type === 'image';
	}

	async function openViewer(dirHandle: FileSystemDirectoryHandle, startIndex: number, overrideImageList: FileSystemFileHandle[] | null = null) {
		try {
			showStatus('<div class="loader mx-auto"></div><p class="mt-2">画像を読み込んでいます...</p>', 'loading');
			if (Array.isArray(overrideImageList) && overrideImageList.length > 0) {
				setCurrentImageFiles(overrideImageList.slice());
			} else {
				const cacheEntry = await ensureDirectoryCache(dirHandle);
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
			if (getCurrentImageFiles().length === 0) { showStatus('このフォルダには表示できる画像がありません。', 'info'); return; }
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
			showStatus('', 'clear');
		} catch (err) {
			console.error('ビューワー起動エラー:', err);
			showStatus('画像の読み込みに失敗しました。', 'error');
			closeViewer();
		}
	}

	async function openVideoPlayer(videoHandle: FileSystemFileHandle) {
		try {
			viewer.style.display = 'flex';
			viewerPages.style.display = 'none';
			viewerVideoContainer.classList.remove('hidden');
			viewerToolbar.style.display = 'none';
			listToolbar.style.display = 'none';
			document.body.style.overflow = 'hidden';
			const source = await getMediaSource(videoHandle);
			const url = source.url;
			if (source.objectUrl) createdUrls.add(url);
			viewerVideo.loop = true;
			viewerVideo.src = url;
			viewerVideo.play();
		} catch (err) {
			console.error("動画再生エラー:", err);
			showStatus('動画の再生に失敗しました。', 'error');
			closeViewer();
		}
	}

	function closeViewer() {
		viewer.style.display = 'none';
		listToolbar.style.display = '';
		document.body.style.overflow = 'auto';
		const leftUrl = leftPageImg.dataset.url;
		const rightUrl = rightPageImg.dataset.url;
		if (leftUrl?.startsWith('blob:')) URL.revokeObjectURL(leftUrl);
		if (rightUrl?.startsWith('blob:')) URL.revokeObjectURL(rightUrl);
		if (leftUrl) createdUrls.delete(leftUrl);
		if (rightUrl) createdUrls.delete(rightUrl);
		leftPageImg.src = ''; rightPageImg.src = '';
		leftPageImg.dataset.url = ''; rightPageImg.dataset.url = '';
		setCurrentImageFiles([]);
		if (viewerVideo.src) {
			viewerVideo.pause();
			if (viewerVideo.src.startsWith('blob:')) URL.revokeObjectURL(viewerVideo.src);
			createdUrls.delete(viewerVideo.src);
			viewerVideo.src = '';
		}
		if (document.fullscreenElement) document.exitFullscreen();
	}

	async function displayPages() {
		viewerPages.classList.toggle('single-view', getIsSinglePageView());
		const total = getCurrentImageFiles().length;
		if (getIsSinglePageView()) {
			await Promise.all([
				displayImage(rightPageImg, getCurrentImageIndex()),
				displayImage(leftPageImg, -1)
			]);
			pageCounter.textContent = `${getCurrentImageIndex() + 1} / ${total}`;
		} else {
			let baseIndex = getCurrentImageIndex();
			if (baseIndex % 2 !== 0 && baseIndex > 0) baseIndex--;
			const rightPageIndex = baseIndex - getPageOffset();
			const leftPageIndex = baseIndex + 1 - getPageOffset();
			await Promise.all([
				displayImage(rightPageImg, rightPageIndex),
				displayImage(leftPageImg, leftPageIndex)
			]);
			const rightPageNum = rightPageIndex >= 0 && rightPageIndex < total ? rightPageIndex + 1 : '-';
			const leftPageNum = leftPageIndex >= 0 && leftPageIndex < total ? leftPageIndex + 1 : '-';
			pageCounter.textContent = `${leftPageNum} - ${rightPageNum} / ${total}`;
		}
	}

	async function displayImage(imgElement: HTMLImageElement, index: number) {
		if (imgElement.dataset.url) {
			if (imgElement.dataset.url.startsWith('blob:')) URL.revokeObjectURL(imgElement.dataset.url);
			createdUrls.delete(imgElement.dataset.url);
			imgElement.dataset.url = '';
		}
		const files = getCurrentImageFiles();
		if (index >= 0 && index < files.length) {
			try {
				const source = await getMediaSource(files[index]);
				const url = source.url;
				if (source.objectUrl) createdUrls.add(url);
				imgElement.src = url;
				imgElement.dataset.url = url;
				imgElement.style.visibility = 'visible';
			} catch (err) {
				console.error(`画像表示エラー (index: ${index}):`, err);
				imgElement.src = '';
				imgElement.style.visibility = 'hidden';
			}
		} else {
			imgElement.src = '';
			imgElement.style.visibility = 'hidden';
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
