import './style.css';
import { CONFIG, DOM, state } from './state';
import type { FilterType } from './state';
import { createGallery } from './gallery';
import { createViewer } from './viewer';
import { createToolbar } from './toolbar';
import {
	buildFavoriteKey,
	normalizeDirPathSegments,
	sortByFavorite
} from './utils';
import {
	ensureConfigNode,
	getConfigNode,
	getFavoriteKeyForItem,
	makeFavoriteSet,
	readRootConfig,
	toggleFavoriteEntry,
	writeRootConfig
} from './storage';
import type { ConfigNode } from './storage';
import {
	ensureDirectoryCache,
	getDirectoryPreviewUrl,
	invalidateDirectoryCache
} from './directoryCache';
import { collectImagesRecursively } from './directoryTraversal';
import {
	populateSizeSelect,
	showStatus,
	toggleFullscreen,
	updateThumbnailSize,
	updateViewModeUI
} from './ui';

const isFilterType = (value: string): value is FilterType =>
	value === 'all' || value === 'directory' || value === 'image' || value === 'gif' || value === 'video';

function clearTransientUrls() {
	for (const url of state.createdUrls) {
		URL.revokeObjectURL(url);
	}
	state.createdUrls.clear();
}

function resetSearchQuery() {
	if (state.searchQuery) {
		state.searchQuery = '';
		DOM.searchInput.value = '';
	}
}

function getRootDirHandle() {
	return state.directoryHistory.length > 0 ? state.directoryHistory[0] : null;
}

function getCurrentDirPathSegments() {
	if (state.directoryHistory.length <= 1) return [];
	return state.directoryHistory.slice(1).map(handle => handle.name);
}

function getCurrentSettingsSnapshot() {
	return {
		thumbnailSizeIndex: state.thumbnailSizeIndex,
		sortOrder: state.sortOrder,
		filterType: state.filterType,
		favoriteFirst: state.favoriteFirst,
		favoriteOnly: state.favoriteOnly
	};
}

function applySettingsFromConfig(config: ConfigNode | null) {
	if (!config || !config.settings) return;
	const settings = config.settings;
	const nextSize = settings.thumbnailSizeIndex;
	if (typeof nextSize === 'number' && Number.isInteger(nextSize)) {
		state.thumbnailSizeIndex = nextSize;
	}
	if (settings.sortOrder === 'asc' || settings.sortOrder === 'desc') {
		state.sortOrder = settings.sortOrder;
	}
	const configFilter = settings.filterType;
	if (typeof configFilter === 'string' && isFilterType(configFilter)) {
		state.filterType = configFilter;
	}
	if (typeof settings.favoriteFirst === 'boolean') {
		state.favoriteFirst = settings.favoriteFirst;
	}
	if (typeof settings.favoriteOnly === 'boolean') {
		state.favoriteOnly = settings.favoriteOnly;
	}
	updateThumbnailSize();
	DOM.filterSelect.value = Array.from(DOM.filterSelect.options).some(opt => opt.value === state.filterType)
		? state.filterType
		: 'all';
	const selectedFilter = DOM.filterSelect.value;
	state.filterType = isFilterType(selectedFilter) ? selectedFilter : 'all';
	toolbar.updateSortButtonUI();
	toolbar.updateFavoriteControlsUI();
}

function scheduleSaveCurrentDirectoryConfig() {
	if (state.configWriteTimer) clearTimeout(state.configWriteTimer);
	state.configWriteTimer = setTimeout(async () => {
		if (!state.currentDirHandle) return;
		const rootHandle = getRootDirHandle();
		if (!rootHandle) return;
		const rootConfig = await readRootConfig(rootHandle);
		const dirPathSegments = getCurrentDirPathSegments();
		const config = getConfigNode(rootConfig, dirPathSegments, { create: true });
		if (!config) return;
		config.settings = { ...config.settings, ...getCurrentSettingsSnapshot() };
		await writeRootConfig(rootHandle, rootConfig, (message) => showStatus(message, 'error'));
	}, 250);
}


// --- イベントリスナー ---

DOM.selectDirBtn.addEventListener('click', async () => {
	if (!window.showDirectoryPicker) {
		showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
		return;
	}
	try {
		const dirHandle = await window.showDirectoryPicker();
		state.directoryHistory = [dirHandle];
		resetSearchQuery();
		await processDirectory(dirHandle);
		await scrollToVisitedChild(dirHandle);
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		console.error('ディレクトリ選択エラー:', err);
	}
});

DOM.upDirBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length > 1) {
		const current = state.directoryHistory.pop();
		const parentDirHandle = state.directoryHistory[state.directoryHistory.length - 1];
		if (current) {
			rememberVisitedChild(parentDirHandle, current.name);
		}
		resetSearchQuery();
		await processDirectory(parentDirHandle);
		await scrollToVisitedChild(parentDirHandle);
	}
});

DOM.copyPathBtn.addEventListener('click', () => {
	if (state.directoryHistory.length > 0) {
		const path = state.directoryHistory.map(handle => handle.name).join('/');
		navigator.clipboard.writeText(path)
			.then(() => {
				showStatus('パスをクリップボードにコピーしました。', 'info');
				setTimeout(() => showStatus('', 'clear'), 2000);
			})
			.catch(err => {
				console.error('パスのコピーに失敗:', err);
				showStatus('パスのコピーに失敗しました。', 'error');
			});
	}
});

DOM.copyImagePathBtn.addEventListener('click', () => {
	if (state.currentImageFiles.length > 0) {
		const dirPath = state.directoryHistory.map(handle => handle.name).join('/');
		const fileName = state.currentImageFiles[state.currentImageIndex].name;
		const fullPath = `${dirPath}/${fileName}`;
		navigator.clipboard.writeText(fullPath)
			.then(() => {
				showStatus('フルパスをクリップボードにコピーしました。', 'info');
				setTimeout(() => showStatus('', 'clear'), 2000);
			})
			.catch(err => {
				console.error('フルパスのコピーに失敗:', err);
				showStatus('フルパスのコピーに失敗しました。', 'error');
			});
	}
});

DOM.sizeSelect.addEventListener('change', () => {
	state.thumbnailSizeIndex = parseInt(DOM.sizeSelect.value, 10);
	localStorage.setItem('thumbnailSizeIndex', state.thumbnailSizeIndex.toString());
	updateThumbnailSize();
	scheduleSaveCurrentDirectoryConfig();
});

DOM.filterSelect.addEventListener('change', async () => {
	const nextFilter = DOM.filterSelect.value;
	state.filterType = isFilterType(nextFilter) ? nextFilter : 'all';
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

DOM.searchInput.addEventListener('input', () => {
	state.searchQuery = DOM.searchInput.value.toLowerCase();
	scheduleProcessForCurrentDir(180);
});

DOM.toggleSortBtn.addEventListener('click', async () => {
	state.sortOrder = (state.sortOrder === 'asc') ? 'desc' : 'asc';
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

DOM.reloadBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length > 0) {
		const currentDir = state.directoryHistory[state.directoryHistory.length - 1];
		if (state.isRecursiveMode) {
			await processDirectoryRecursive(currentDir);
		} else {
			invalidateDirectoryCache(currentDir);
			await processDirectory(currentDir, { forceRefresh: true, useConfig: false });
			await scrollToVisitedChild(currentDir);
		}
	}
});

DOM.recursiveBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length === 0) return;
	const currentDir = state.directoryHistory[state.directoryHistory.length - 1];
	if (state.isRecursiveMode) {
		state.isRecursiveMode = false;
		DOM.recursiveBtn.textContent = '全画像一覧';
		await processDirectory(currentDir);
		await scrollToVisitedChild(currentDir);
	} else {
		const confirmLoad = confirm('このフォルダ配下のすべての画像を読み込みます。続行しますか？');
		if (!confirmLoad) return;
		state.isRecursiveMode = true;
		DOM.recursiveBtn.textContent = '戻る';
		await processDirectoryRecursive(currentDir);
	}
});

DOM.favoriteFirstBtn.addEventListener('click', () => {
	state.favoriteFirst = !state.favoriteFirst;
	toolbar.updateFavoriteControlsUI();
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

DOM.favoriteOnlyBtn.addEventListener('click', () => {
	state.favoriteOnly = !state.favoriteOnly;
	toolbar.updateFavoriteControlsUI();
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

DOM.closeViewerBtn.addEventListener('click', () => viewerController.closeViewer());
DOM.toggleViewBtn.addEventListener('click', () => {
	state.isSinglePageView = !state.isSinglePageView;
	localStorage.setItem('isSinglePageView', state.isSinglePageView ? '1' : '0');
	updateViewModeUI();
	viewerController.displayPages();
});
DOM.adjustSpreadBtn.addEventListener('click', () => {
	state.pageOffset = 1 - state.pageOffset;
	viewerController.displayPages();
});

// ★変更点: ページ送りボタンの方向をR-to-Lに戻す
DOM.nextBtn.addEventListener('click', () => {
	const step = state.isSinglePageView ? 1 : 2;
	viewerController.navigatePages(-step);
});
DOM.prevBtn.addEventListener('click', () => {
	const step = state.isSinglePageView ? 1 : 2;
	viewerController.navigatePages(step);
});

DOM.fullscreenBtn.addEventListener('click', toggleFullscreen);

document.addEventListener('keydown', (e) => {
	if (e.altKey && e.key === 'ArrowLeft') {
		e.preventDefault();
		if (DOM.viewer.style.display !== 'none') {
			viewerController.closeViewer();
		} else if (state.directoryHistory.length > 1) {
			DOM.upDirBtn.click();
		}
		return;
	}

	if (DOM.viewer.style.display === 'none') return;
	if (e.key === 'Escape') {
		e.preventDefault();
		viewerController.closeViewer();
		return;
	}
	if (!DOM.viewerVideoContainer.classList.contains('hidden')) return;

	// 右から左へ読み進める操作は意図されたもの (右矢印: 前のページ, 左矢印: 次のページ)
	const step = state.isSinglePageView ? 1 : 2;
	switch (e.key) {
		case 'ArrowLeft': viewerController.navigatePages(step); break; // 次へ
		case 'ArrowRight': viewerController.navigatePages(-step); break; // 前へ
	}
});

document.addEventListener('fullscreenchange', () => {
	if (document.fullscreenElement) {
		DOM.viewer.addEventListener('mousemove', toolbar.resetToolbarTimer);
		toolbar.resetToolbarTimer();
	} else {
		DOM.viewer.removeEventListener('mousemove', toolbar.resetToolbarTimer);
		if (state.toolbarHideTimer) {
			clearTimeout(state.toolbarHideTimer);
		}
		DOM.viewerToolbar.classList.remove('hidden');
	}
});

// --- メインロジック ---

async function processDirectory(
	dirHandle: FileSystemDirectoryHandle,
	{ forceRefresh = false, useConfig = true }: { forceRefresh?: boolean; useConfig?: boolean } = {}
) {
	const label = `processDirectory:${dirHandle.name}-${Date.now()}`;
	if (CONFIG.ENABLE_DEBUG_LOGS) {
		console.log(`[start] ${label}`);
		console.time(label);
	}
	clearTransientUrls();
	if (state.lazyLoadObserver) {
		state.lazyLoadObserver.disconnect();
		state.lazyLoadObserver = null;
	}

	showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
	updateThumbnailSize();
	DOM.itemList.innerHTML = '';
	toolbar.updateNavigationUI();

	try {
		state.currentDirHandle = dirHandle;
		const cacheEntry = await ensureDirectoryCache(dirHandle, { forceRefresh });
		const rootHandle = getRootDirHandle();
		const rootConfig = await readRootConfig(rootHandle);
		const dirPathSegments = getCurrentDirPathSegments();
		const config = getConfigNode(rootConfig, dirPathSegments, { create: false }) || ensureConfigNode({});
		if (useConfig) {
			applySettingsFromConfig(config);
		}
		const favoriteSet = makeFavoriteSet(config);
		if (!cacheEntry.sorted[state.sortOrder]) {
			const sorted = [...cacheEntry.items].sort((a, b) => {
				const nameA = (a.nameLower || a.name.toLowerCase());
				const nameB = (b.nameLower || b.name.toLowerCase());
				return state.sortOrder === 'asc'
					? nameA.localeCompare(nameB, undefined, { numeric: true })
					: nameB.localeCompare(nameA, undefined, { numeric: true });
			});
			cacheEntry.sorted[state.sortOrder] = sorted;
		}

		const sortedItems = cacheEntry.sorted[state.sortOrder] ?? [];
		const items = sortedItems.map(i => ({ ...i }));

		let imgIdx = 0;
		items.forEach(item => {
			item.imageIndex = item.type === 'image' ? imgIdx++ : -1;
			const key = getFavoriteKeyForItem(item);
			item.isFavorite = key ? favoriteSet.has(key) : false;
		});

		let filteredItems = items;
		if (state.filterType === 'directory') {
			filteredItems = items.filter(i => i.type === 'directory');
		} else if (state.filterType === 'image') {
			filteredItems = items.filter(i => i.type === 'image');
		} else if (state.filterType === 'gif') {
			filteredItems = items.filter(i => i.type === 'image' && i.name.toLowerCase().endsWith('.gif'));
		} else if (state.filterType === 'video') {
			filteredItems = items.filter(i => i.type === 'video');
		}

		if (state.searchQuery) {
			filteredItems = filteredItems.filter(i => (i.nameLower || i.name.toLowerCase()).includes(state.searchQuery));
		}

		if (state.favoriteOnly) {
			filteredItems = filteredItems.filter(i => i.isFavorite);
		}

		if (state.favoriteFirst) {
			filteredItems = sortByFavorite(filteredItems);
		}

		state.currentDisplayImageList = filteredItems
			.filter(i => i.type === 'image')
			.map(i => i.handle);

		const displayIndexMap = new WeakMap();
		state.currentDisplayImageList.forEach((handle, index) => {
			displayIndexMap.set(handle, index);
		});
		filteredItems.forEach(item => {
			if (item.type === 'image') {
				item.displayIndex = displayIndexMap.get(item.handle);
			}
		});

		if (filteredItems.length === 0) {
			showStatus('表示できるアイテムがありません。', 'info');
			return;
		}

		showStatus('', 'clear');

		const useLazy = state.directoryHistory.length > 1 && cacheEntry.imageCount >= CONFIG.LAZY_LOAD_THRESHOLD;
		const dirPath = dirPathSegments.join('/');
		await gallery.renderItemsInBatches(filteredItems, dirHandle, useLazy, dirPath);

	} catch (err) {
		console.error('ディレクトリ処理エラー:', err);
		showStatus('フォルダの読み込み中にエラーが発生しました。', 'error');
	} finally {
		if (CONFIG.ENABLE_DEBUG_LOGS) {
			console.timeEnd(label);
			console.log(`[end] ${label}`);
		}
	}
}


async function enterDirectory(dirHandle: FileSystemDirectoryHandle) {
	const current = state.directoryHistory[state.directoryHistory.length - 1];
	rememberVisitedChild(current, dirHandle.name);
	state.directoryHistory.push(dirHandle);
	resetSearchQuery();
	await processDirectory(dirHandle);
	await scrollToVisitedChild(dirHandle);
}

// ディレクトリ探索はdirectoryTraversal.tsへ移動

async function processDirectoryRecursive(dirHandle: FileSystemDirectoryHandle) {
	const label = `processDirectoryRecursive:${dirHandle.name}-${Date.now()}`;
	if (CONFIG.ENABLE_DEBUG_LOGS) {
		console.log(`[start] ${label}`);
		console.time(label);
	}
	clearTransientUrls();
	if (state.lazyLoadObserver) {
		state.lazyLoadObserver.disconnect();
		state.lazyLoadObserver = null;
	}

	showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
	updateThumbnailSize();
	DOM.itemList.innerHTML = '';
	toolbar.updateNavigationUI();
	state.currentDisplayImageList = [];

	const currentBasePath = getCurrentDirPathSegments().join('/');
	let items = await collectImagesRecursively(dirHandle, [], currentBasePath);
	const rootHandle = getRootDirHandle();
	const rootConfig = await readRootConfig(rootHandle);
	const uniquePaths = new Set(items.map(item => item.parentPath));
	const favoriteMap = new Map();
	uniquePaths.forEach(path => {
		const config = getConfigNode(rootConfig, path, { create: false }) || ensureConfigNode({});
		favoriteMap.set(path, makeFavoriteSet(config));
	});
	items.forEach(item => {
		const set = favoriteMap.get(item.parentPath);
		const key = buildFavoriteKey('file', item.name);
		item.isFavorite = set ? set.has(key) : false;
	});
	items.sort((a, b) => {
		const pathA = a.path.toLowerCase();
		const pathB = b.path.toLowerCase();
		if (state.sortOrder === 'asc') {
			return pathA.localeCompare(pathB, undefined, { numeric: true });
		} else {
			return pathB.localeCompare(pathA, undefined, { numeric: true });
		}
	});

	if (state.filterType === 'gif') {
		items = items.filter(i => i.name.toLowerCase().endsWith('.gif'));
	} else if (state.filterType === 'image') {
		// no change, show all images
	} else if (state.filterType === 'directory' || state.filterType === 'video') {
		items = [];
	}

	if (state.searchQuery) {
		items = items.filter(i => i.name.toLowerCase().includes(state.searchQuery));
	}

	if (state.favoriteOnly) {
		items = items.filter(i => i.isFavorite);
	}

	if (state.favoriteFirst) {
		items = sortByFavorite(items);
	}

	if (items.length === 0) {
		showStatus('表示できる画像がありません。', 'info');
		return;
	}

	showStatus('', 'clear');
	const useLazy = state.directoryHistory.length > 1 && items.length >= CONFIG.LAZY_LOAD_THRESHOLD;
	await gallery.renderRecursiveItemsInBatches(items, useLazy);
	if (CONFIG.ENABLE_DEBUG_LOGS) {
		console.timeEnd(label);
		console.log(`[end] ${label}`);
	}
}

// UIユーティリティはui.tsへ移動

function ensureLazyLoadObserver() {
	if (!state.lazyLoadObserver) {
		state.lazyLoadObserver = new IntersectionObserver(entries => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					if (!(entry.target instanceof HTMLDivElement)) return;
					if (entry.target._loadThumb) entry.target._loadThumb();
					state.lazyLoadObserver?.unobserve(entry.target);
					delete entry.target._loadThumb;
				}
			});
		}, { rootMargin: '200px' });
	}
}

const toolbar = createToolbar({
	upDirBtn: DOM.upDirBtn,
	copyPathBtn: DOM.copyPathBtn,
	listToolbar: DOM.listToolbar,
	currentDirName: DOM.currentDirName,
	recursiveBtn: DOM.recursiveBtn,
	toggleSortBtn: DOM.toggleSortBtn,
	favoriteFirstBtn: DOM.favoriteFirstBtn,
	favoriteOnlyBtn: DOM.favoriteOnlyBtn,
	viewerToolbar: DOM.viewerToolbar,
	getDirectoryHistoryLength: () => state.directoryHistory.length,
	getCurrentDirName: () => state.directoryHistory.length > 0 ? state.directoryHistory[state.directoryHistory.length - 1].name : '',
	getIsRecursiveMode: () => state.isRecursiveMode,
	setIsRecursiveMode: (value) => { state.isRecursiveMode = value; },
	getSortOrder: () => state.sortOrder,
	getFavoriteFirst: () => state.favoriteFirst,
	getFavoriteOnly: () => state.favoriteOnly,
	setToolbarHideTimer: (id) => { state.toolbarHideTimer = id; },
	getToolbarHideTimer: () => state.toolbarHideTimer
});

populateSizeSelect();
updateThumbnailSize();
toolbar.updateSortButtonUI();
toolbar.updateFavoriteControlsUI();
DOM.filterSelect.value = state.filterType;

const viewerController = createViewer({
	viewer: DOM.viewer,
	viewerPages: DOM.viewerPages,
	viewerVideoContainer: DOM.viewerVideoContainer,
	viewerToolbar: DOM.viewerToolbar,
	listToolbar: DOM.listToolbar,
	leftPageImg: DOM.leftPageImg,
	rightPageImg: DOM.rightPageImg,
	viewerVideo: DOM.viewerVideo,
	pageCounter: DOM.pageCounter,
	createdUrls: state.createdUrls,
	getCurrentImageFiles: () => state.currentImageFiles,
	setCurrentImageFiles: (files) => { state.currentImageFiles = files; },
	getCurrentImageIndex: () => state.currentImageIndex,
	setCurrentImageIndex: (index) => { state.currentImageIndex = index; },
	getPageOffset: () => state.pageOffset,
	setPageOffset: (offset) => { state.pageOffset = offset; },
	getSortOrder: () => state.sortOrder,
	getIsSinglePageView: () => state.isSinglePageView,
	setIsSinglePageView: (value) => { state.isSinglePageView = value; },
	updateViewModeUI,
	showStatus,
	ensureDirectoryCache
});

const gallery = createGallery({
	itemList: DOM.itemList,
	createdUrls: state.createdUrls,
	RIC: state.RIC,
	enableDebugLogs: CONFIG.ENABLE_DEBUG_LOGS,
	ensureLazyLoadObserver,
	getLazyLoadObserver: () => state.lazyLoadObserver,
	getCurrentDisplayImageList: () => state.currentDisplayImageList,
	openViewer: viewerController.openViewer,
	openVideoPlayer: viewerController.openVideoPlayer,
	enterDirectory,
	getDirectoryPreviewUrl,
	setFavoriteButtonState: toolbar.setFavoriteButtonState,
	toggleFavoriteEntry,
	getRootDirHandle,
	normalizeDirPathSegments,
	scheduleProcessForCurrentDir,
	getFavoriteFirst: () => state.favoriteFirst,
	getFavoriteOnly: () => state.favoriteOnly,
	showStatus
});

function rememberVisitedChild(parentHandle: FileSystemDirectoryHandle | null, childName: string) {
	if (parentHandle && childName) {
		state.lastVisitedChild.set(parentHandle, childName);
	}
}

async function scrollToVisitedChild(handle: FileSystemDirectoryHandle | null) {
	const childName = handle ? state.lastVisitedChild.get(handle) : null;
	if (!childName) return;
	let tries = 0;
	const maxTries = 20; // 約1秒 (20 * 50ms)
	while (tries < maxTries) {
		const target = Array.from(DOM.itemList.querySelectorAll<HTMLElement>('.directory-card'))
			.find(card => card.dataset.dirName === childName);
		if (target) {
			// レイアウトが安定する前にスクロールしてズレるのを防ぐため、2段階スクロール
			target.scrollIntoView({ block: 'center' });
			await new Promise(r => setTimeout(r, 300));
			target.scrollIntoView({ block: 'center' });
			return;
		}
		await new Promise(r => setTimeout(r, 50));
		tries++;
	}
}

// Clean up created Object URLs when leaving the page
window.addEventListener('beforeunload', () => {
	for (const url of state.createdUrls) {
		URL.revokeObjectURL(url);
	}
	state.createdUrls.clear();
	for (const url of state.previewUrls) {
		URL.revokeObjectURL(url);
	}
	state.previewUrls.clear();
});

function scheduleProcessForCurrentDir(debounceMs = 150) {
	if (state.searchDebounceTimer) {
		clearTimeout(state.searchDebounceTimer);
	}
	state.searchDebounceTimer = setTimeout(async () => {
		if (state.directoryHistory.length === 0) return;
		const currentDir = state.directoryHistory[state.directoryHistory.length - 1];
		if (state.isRecursiveMode) {
			await processDirectoryRecursive(currentDir);
		} else {
			await processDirectory(currentDir, { useConfig: false });
		}
	}, debounceMs);
}
