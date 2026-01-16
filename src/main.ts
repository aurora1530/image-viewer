// @ts-nocheck
import './style.css';
import { CONFIG, DOM, state } from './state';
import { createGallery } from './gallery';
import { createViewer } from './viewer';
import { createToolbar } from './toolbar';
import {
	buildFavoriteKey,
	isImageFileName,
	joinRelativePath,
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

// DOM要素の取得
const {
	selectDirBtn,
	itemList,
	statusArea,
	viewer,
	leftPageImg,
	rightPageImg,
	closeViewerBtn,
	adjustSpreadBtn,
	prevBtn,
	nextBtn,
	fullscreenBtn,
	copyImagePathBtn,
	pageCounter,
	toggleViewBtn,
	viewerToolbar,
	upDirBtn,
	currentDirName,
	copyPathBtn,
	sizeSelect,
	filterSelect,
	searchInput,
	listToolbar,
	toggleSortBtn,
	reloadBtn,
	recursiveBtn,
	viewerPages,
	viewerVideoContainer,
	viewerVideo,
	favoriteFirstBtn,
	favoriteOnlyBtn
} = DOM;

// グローバル変数
let directoryHistory = state.directoryHistory;
let currentImageFiles = state.currentImageFiles;
let currentImageIndex = state.currentImageIndex;
let pageOffset = state.pageOffset;
let isSinglePageView = state.isSinglePageView;
let toolbarHideTimer = state.toolbarHideTimer;
const imageExtensions = CONFIG.IMAGE_EXTENSIONS;
const videoExtensions = CONFIG.VIDEO_EXTENSIONS;
const CONFIG_FILENAME = CONFIG.CONFIG_FILENAME;
const LAZY_LOAD_THRESHOLD = CONFIG.LAZY_LOAD_THRESHOLD; // threshold for enabling lazy loading
let lazyLoadObserver = state.lazyLoadObserver;
let createdUrls = state.createdUrls;
const ENABLE_DEBUG_LOGS = CONFIG.ENABLE_DEBUG_LOGS; // デバッグ用ログ出力をまとめて制御
let thumbnailSizeIndex = state.thumbnailSizeIndex;
let sortOrder = state.sortOrder;
let filterType = state.filterType;
let searchQuery = state.searchQuery;
let isRecursiveMode = state.isRecursiveMode;
let favoriteFirst = state.favoriteFirst;
let favoriteOnly = state.favoriteOnly;
let currentDisplayImageList = state.currentDisplayImageList;
let configWriteTimer = state.configWriteTimer;
const lastVisitedChild = state.lastVisitedChild;
const directoryCache = state.directoryCache; // ディレクトリごとの項目キャッシュ
const directoryPreviewCache = state.directoryPreviewCache; // ディレクトリのプレビュー画像キャッシュ
const previewUrls = state.previewUrls; // キャッシュ用 Object URL
let currentDirHandle = state.currentDirHandle;
let searchDebounceTimer = state.searchDebounceTimer;
const RIC = state.RIC;
const CIC = state.CIC;

function clearTransientUrls() {
	for (const url of createdUrls) {
		URL.revokeObjectURL(url);
	}
	createdUrls.clear();
}

function resetSearchQuery() {
	if (searchQuery) {
		searchQuery = '';
		searchInput.value = '';
	}
}

function getRootDirHandle() {
	return directoryHistory.length > 0 ? directoryHistory[0] : null;
}

function getCurrentDirPathSegments() {
	if (directoryHistory.length <= 1) return [];
	return directoryHistory.slice(1).map(handle => handle.name);
}

function getCurrentSettingsSnapshot() {
	return {
		thumbnailSizeIndex,
		sortOrder,
		filterType,
		favoriteFirst,
		favoriteOnly
	};
}

function applySettingsFromConfig(config) {
	if (!config || !config.settings) return;
	const settings = config.settings;
	if (Number.isInteger(settings.thumbnailSizeIndex)) {
		thumbnailSizeIndex = settings.thumbnailSizeIndex;
	}
	if (settings.sortOrder === 'asc' || settings.sortOrder === 'desc') {
		sortOrder = settings.sortOrder;
	}
	if (typeof settings.filterType === 'string') {
		filterType = settings.filterType;
	}
	if (typeof settings.favoriteFirst === 'boolean') {
		favoriteFirst = settings.favoriteFirst;
	}
	if (typeof settings.favoriteOnly === 'boolean') {
		favoriteOnly = settings.favoriteOnly;
	}
	updateThumbnailSize();
	filterSelect.value = Array.from(filterSelect.options).some(opt => opt.value === filterType)
		? filterType
		: 'all';
	filterType = filterSelect.value;
	toolbar.updateSortButtonUI();
	toolbar.updateFavoriteControlsUI();
}

function scheduleSaveCurrentDirectoryConfig() {
	if (configWriteTimer) clearTimeout(configWriteTimer);
	configWriteTimer = setTimeout(async () => {
		if (!currentDirHandle) return;
		const rootHandle = getRootDirHandle();
		if (!rootHandle) return;
		const rootConfig = await readRootConfig(rootHandle);
		const dirPathSegments = getCurrentDirPathSegments();
		const config = getConfigNode(rootConfig, dirPathSegments, { create: true });
		config.settings = { ...config.settings, ...getCurrentSettingsSnapshot() };
		await writeRootConfig(rootHandle, rootConfig, (message) => showStatus(message, 'error'));
	}, 250);
}

async function buildDirectoryCache(dirHandle) {
	const items = [];
	let imageCount = 0;
	try {
		for await (const entry of dirHandle.values()) {
			if (entry.kind === 'directory') {
				items.push({ type: 'directory', handle: entry, name: entry.name, nameLower: entry.name.toLowerCase() });
			} else if (entry.kind === 'file') {
				const lowerName = entry.name.toLowerCase();
				if (isImageFileName(lowerName, imageExtensions)) {
					items.push({ type: 'image', handle: entry, name: entry.name, nameLower: lowerName });
					imageCount++;
				} else if (videoExtensions.some(ext => lowerName.endsWith(ext))) {
					items.push({ type: 'video', handle: entry, name: entry.name, nameLower: lowerName });
				}
			}
		}
	} catch (e) {
		console.error(`ディレクトリ取得エラー (${dirHandle.name}):`, e);
	}
	return { items, imageCount, sorted: {} };
}

async function ensureDirectoryCache(dirHandle, { forceRefresh = false } = {}) {
	let entry = directoryCache.get(dirHandle);
	if (!entry || forceRefresh) {
		entry = await buildDirectoryCache(dirHandle);
		directoryCache.set(dirHandle, entry);
		// プレビューキャッシュも無効化
		const prev = directoryPreviewCache.get(dirHandle);
		if (prev && prev.url) {
			URL.revokeObjectURL(prev.url);
			previewUrls.delete(prev.url);
		}
		directoryPreviewCache.delete(dirHandle);
	}
	return entry;
}

function invalidateDirectoryCache(dirHandle) {
	const entry = directoryPreviewCache.get(dirHandle);
	if (entry && entry.url) {
		URL.revokeObjectURL(entry.url);
		previewUrls.delete(entry.url);
	}
	directoryCache.delete(dirHandle);
	directoryPreviewCache.delete(dirHandle);
}

async function findFirstImageHandle(dirHandle) {
	const preferredBases = ['__0', 'icon', 'thumbnail'];
	const preferredNames = new Set(
		preferredBases.flatMap(base => imageExtensions.map(ext => `${base}${ext}`))
	);

	// 1) ダイレクトに名前指定で探す（巨大ディレクトリでも O(候補数) で完了）
	for (const base of preferredBases) {
		for (const ext of imageExtensions) {
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
	const cached = directoryCache.get(dirHandle);
	if (cached && cached.items) {
		const directPreferred = cached.items.find(i => i.type === 'image' && preferredNames.has(i.nameLower));
		if (directPreferred) return directPreferred.handle;
		const directAny = cached.items.find(i => i.type === 'image');
		if (directAny) return directAny.handle;
		const firstDir = cached.items.find(i => i.type === 'directory');
		if (firstDir) return findFirstImageHandle(firstDir.handle);
	}

	// キャッシュが無い or 不足している場合は実際に走査
	let firstSubDir = null;
	let firstImage = null;
	try {
		const tLabel = ENABLE_DEBUG_LOGS ? `findFirstImageHandle:${dirHandle.name}-${Date.now()}` : null;
		if (tLabel) console.time(tLabel);
		for await (const entry of dirHandle.values()) {
			if (entry.kind === 'file' && isImageFileName(entry.name, imageExtensions)) {
				const lower = entry.name.toLowerCase();
				if (preferredNames.has(lower)) {
					if (tLabel) console.timeEnd(tLabel);
					return entry; // 最優先候補が見つかったら即返す
				}
				if (!firstImage) firstImage = entry;
			}
			if (!firstSubDir && entry.kind === 'directory') {
				firstSubDir = entry;
			}
		}
		if (tLabel) console.timeEnd(tLabel);
	} catch (e) { console.error(`プレビュー用画像探索エラー (${dirHandle.name}):`, e); }

	if (firstImage) return firstImage;
	if (firstSubDir) return findFirstImageHandle(firstSubDir);
	return null;
}

async function getDirectoryPreviewUrl(dirHandle) {
	const cached = directoryPreviewCache.get(dirHandle);
	if (cached && cached.url) {
		if (ENABLE_DEBUG_LOGS) console.log(`[preview cache hit] ${dirHandle.name}`);
		return cached.url;
	}

	const handle = await findFirstImageHandle(dirHandle);
	if (!handle) return null;
	try {
		const tLabel = ENABLE_DEBUG_LOGS ? `previewGen:${dirHandle.name}-${Date.now()}` : null;
		if (tLabel) console.time(tLabel);
		const file = await handle.getFile();
		const url = URL.createObjectURL(file);
		directoryPreviewCache.set(dirHandle, { url });
		previewUrls.add(url);
		if (ENABLE_DEBUG_LOGS) console.log(`[preview set] ${dirHandle.name}`);
		if (tLabel) console.timeEnd(tLabel);
		return url;
	} catch (e) {
		console.error(`プレビューURL生成失敗 (${dirHandle.name}):`, e);
		return null;
	}
}
const sizeOptions = [
	{ name: '小', classes: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-2', originalAspect: false },
	{ name: '中', classes: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2 md:gap-3', originalAspect: false },
	{ name: '大', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4', originalAspect: false },
	{ name: '元サイズ 小', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4', originalAspect: true },
	{ name: '元サイズ 中', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4', originalAspect: true },
	{ name: '元サイズ 大', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-3 md:gap-4', originalAspect: true },
];

function populateSizeSelect() {
	sizeSelect.innerHTML = '';
	sizeOptions.forEach((opt, idx) => {
		const option = document.createElement('option');
		option.value = idx;
		option.textContent = opt.name;
		sizeSelect.appendChild(option);
	});
}

// --- イベントリスナー ---

selectDirBtn.addEventListener('click', async () => {
	if (!('showDirectoryPicker' in window)) {
		showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
		return;
	}
	try {
		const dirHandle = await window.showDirectoryPicker();
		directoryHistory = [dirHandle];
		resetSearchQuery();
		await processDirectory(dirHandle);
		await scrollToVisitedChild(dirHandle);
	} catch (err) {
		if (err.name !== 'AbortError') console.error('ディレクトリ選択エラー:', err);
	}
});

upDirBtn.addEventListener('click', async () => {
	if (directoryHistory.length > 1) {
		const current = directoryHistory.pop();
		const parentDirHandle = directoryHistory[directoryHistory.length - 1];
		rememberVisitedChild(parentDirHandle, current.name);
		resetSearchQuery();
		await processDirectory(parentDirHandle);
		await scrollToVisitedChild(parentDirHandle);
	}
});

copyPathBtn.addEventListener('click', () => {
	if (directoryHistory.length > 0) {
		const path = directoryHistory.map(handle => handle.name).join('/');
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

copyImagePathBtn.addEventListener('click', () => {
	if (currentImageFiles.length > 0) {
		const dirPath = directoryHistory.map(handle => handle.name).join('/');
		const fileName = currentImageFiles[currentImageIndex].name;
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

sizeSelect.addEventListener('change', () => {
	thumbnailSizeIndex = parseInt(sizeSelect.value, 10);
	localStorage.setItem('thumbnailSizeIndex', thumbnailSizeIndex.toString());
	updateThumbnailSize();
	scheduleSaveCurrentDirectoryConfig();
});

filterSelect.addEventListener('change', async () => {
	filterType = filterSelect.value;
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

searchInput.addEventListener('input', () => {
	searchQuery = searchInput.value.toLowerCase();
	scheduleProcessForCurrentDir(180);
});

toggleSortBtn.addEventListener('click', async () => {
	sortOrder = (sortOrder === 'asc') ? 'desc' : 'asc';
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

reloadBtn.addEventListener('click', async () => {
	if (directoryHistory.length > 0) {
		const currentDir = directoryHistory[directoryHistory.length - 1];
		if (isRecursiveMode) {
			await processDirectoryRecursive(currentDir);
		} else {
			invalidateDirectoryCache(currentDir);
			await processDirectory(currentDir, { forceRefresh: true, useConfig: false });
			await scrollToVisitedChild(currentDir);
		}
	}
});

recursiveBtn.addEventListener('click', async () => {
	if (directoryHistory.length === 0) return;
	const currentDir = directoryHistory[directoryHistory.length - 1];
	if (isRecursiveMode) {
		isRecursiveMode = false;
		recursiveBtn.textContent = '全画像一覧';
		await processDirectory(currentDir);
		await scrollToVisitedChild(currentDir);
	} else {
		const confirmLoad = confirm('このフォルダ配下のすべての画像を読み込みます。続行しますか？');
		if (!confirmLoad) return;
		isRecursiveMode = true;
		recursiveBtn.textContent = '戻る';
		await processDirectoryRecursive(currentDir);
	}
});

favoriteFirstBtn.addEventListener('click', () => {
	favoriteFirst = !favoriteFirst;
	toolbar.updateFavoriteControlsUI();
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

favoriteOnlyBtn.addEventListener('click', () => {
	favoriteOnly = !favoriteOnly;
	toolbar.updateFavoriteControlsUI();
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

closeViewerBtn.addEventListener('click', () => viewerController.closeViewer());
toggleViewBtn.addEventListener('click', () => {
	isSinglePageView = !isSinglePageView;
	localStorage.setItem('isSinglePageView', isSinglePageView ? '1' : '0');
	updateViewModeUI();
	viewerController.displayPages();
});
adjustSpreadBtn.addEventListener('click', () => {
	pageOffset = 1 - pageOffset;
	viewerController.displayPages();
});

// ★変更点: ページ送りボタンの方向をR-to-Lに戻す
nextBtn.addEventListener('click', () => {
	const step = isSinglePageView ? 1 : 2;
	viewerController.navigatePages(-step);
});
prevBtn.addEventListener('click', () => {
	const step = isSinglePageView ? 1 : 2;
	viewerController.navigatePages(step);
});

fullscreenBtn.addEventListener('click', toggleFullscreen);

document.addEventListener('keydown', (e) => {
	if (e.altKey && e.key === 'ArrowLeft') {
		e.preventDefault();
		if (viewer.style.display !== 'none') {
			viewerController.closeViewer();
		} else if (directoryHistory.length > 1) {
			upDirBtn.click();
		}
		return;
	}

	if (viewer.style.display === 'none') return;
	if (e.key === 'Escape') {
		e.preventDefault();
		viewerController.closeViewer();
		return;
	}
	if (!viewerVideoContainer.classList.contains('hidden')) return;

	// 右から左へ読み進める操作は意図されたもの (右矢印: 前のページ, 左矢印: 次のページ)
	const step = isSinglePageView ? 1 : 2;
	switch (e.key) {
		case 'ArrowLeft': viewerController.navigatePages(step); break; // 次へ
		case 'ArrowRight': viewerController.navigatePages(-step); break; // 前へ
	}
});

document.addEventListener('fullscreenchange', () => {
	if (document.fullscreenElement) {
		viewer.addEventListener('mousemove', toolbar.resetToolbarTimer);
		toolbar.resetToolbarTimer();
	} else {
		viewer.removeEventListener('mousemove', toolbar.resetToolbarTimer);
		clearTimeout(toolbarHideTimer);
		viewerToolbar.classList.remove('hidden');
	}
});

// --- メインロジック ---

async function processDirectory(dirHandle, { forceRefresh = false, useConfig = true } = {}) {
	const label = `processDirectory:${dirHandle.name}-${Date.now()}`;
	if (ENABLE_DEBUG_LOGS) {
		console.log(`[start] ${label}`);
		console.time(label);
	}
	clearTransientUrls();
	if (lazyLoadObserver) {
		lazyLoadObserver.disconnect();
		lazyLoadObserver = null;
	}

	showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
	updateThumbnailSize();
	itemList.innerHTML = '';
	toolbar.updateNavigationUI();

	try {
		currentDirHandle = dirHandle;
		const cacheEntry = await ensureDirectoryCache(dirHandle, { forceRefresh });
		const rootHandle = getRootDirHandle();
		const rootConfig = await readRootConfig(rootHandle);
		const dirPathSegments = getCurrentDirPathSegments();
		const config = getConfigNode(rootConfig, dirPathSegments, { create: false }) || ensureConfigNode({});
		if (useConfig) {
			applySettingsFromConfig(config);
		}
		const favoriteSet = makeFavoriteSet(config);
		if (!cacheEntry.sorted[sortOrder]) {
			const sorted = [...cacheEntry.items].sort((a, b) => {
				const nameA = (a.nameLower || a.name.toLowerCase());
				const nameB = (b.nameLower || b.name.toLowerCase());
				return sortOrder === 'asc'
					? nameA.localeCompare(nameB, undefined, { numeric: true })
					: nameB.localeCompare(nameA, undefined, { numeric: true });
			});
			cacheEntry.sorted[sortOrder] = sorted;
		}

		const items = cacheEntry.sorted[sortOrder].map(i => ({ ...i }));

		let imgIdx = 0;
		items.forEach(item => {
			item.imageIndex = item.type === 'image' ? imgIdx++ : -1;
			const key = getFavoriteKeyForItem(item);
			item.isFavorite = key ? favoriteSet.has(key) : false;
		});

		let filteredItems = items;
		if (filterType === 'directory') {
			filteredItems = items.filter(i => i.type === 'directory');
		} else if (filterType === 'image') {
			filteredItems = items.filter(i => i.type === 'image');
		} else if (filterType === 'gif') {
			filteredItems = items.filter(i => i.type === 'image' && i.name.toLowerCase().endsWith('.gif'));
		} else if (filterType === 'video') {
			filteredItems = items.filter(i => i.type === 'video');
		}

		if (searchQuery) {
			filteredItems = filteredItems.filter(i => (i.nameLower || i.name.toLowerCase()).includes(searchQuery));
		}

		if (favoriteOnly) {
			filteredItems = filteredItems.filter(i => i.isFavorite);
		}

		if (favoriteFirst) {
			filteredItems = sortByFavorite(filteredItems);
		}

		currentDisplayImageList = filteredItems
			.filter(i => i.type === 'image')
			.map(i => i.handle);

		const displayIndexMap = new WeakMap();
		currentDisplayImageList.forEach((handle, index) => {
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

		const useLazy = directoryHistory.length > 1 && cacheEntry.imageCount >= LAZY_LOAD_THRESHOLD;
		const dirPath = dirPathSegments.join('/');
		await gallery.renderItemsInBatches(filteredItems, dirHandle, useLazy, false, dirPath);

	} catch (err) {
		console.error('ディレクトリ処理エラー:', err);
		showStatus('フォルダの読み込み中にエラーが発生しました。', 'error');
	} finally {
		if (ENABLE_DEBUG_LOGS) {
			console.timeEnd(label);
			console.log(`[end] ${label}`);
		}
	}
}


async function enterDirectory(dirHandle) {
	const current = directoryHistory[directoryHistory.length - 1];
	rememberVisitedChild(current, dirHandle.name);
	directoryHistory.push(dirHandle);
	resetSearchQuery();
	await processDirectory(dirHandle);
	await scrollToVisitedChild(dirHandle);
}

async function getImageFilesFromDirectory(dirHandle, order = 'asc') {
	const imageFiles = [];
	try {
		for await (const entry of dirHandle.values()) {
			if (entry.kind === 'file' && isImageFileName(entry.name, imageExtensions)) {
				imageFiles.push(entry);
			}
		}
		imageFiles.sort((a, b) => {
			const nameA = a.name.toLowerCase();
			const nameB = b.name.toLowerCase();
			if (order === 'asc') {
				return nameA.localeCompare(nameB, undefined, { numeric: true });
			} else {
				return nameB.localeCompare(nameA, undefined, { numeric: true });
			}
		});
	} catch (e) { console.error(`ディレクトリ内の画像取得エラー (${dirHandle.name}):`, e); }
	return imageFiles;
}

async function collectImagesRecursively(dirHandle, list = [], basePath = '') {
	const images = await getImageFilesFromDirectory(dirHandle);
	images.forEach((img, idx) => {
		list.push({
			handle: img,
			name: img.name,
			parentHandle: dirHandle,
			imageIndex: idx,
			parentPath: basePath,
			path: joinRelativePath(basePath, img.name)
		});
	});
	try {
		for await (const entry of dirHandle.values()) {
			if (entry.kind === 'directory') {
				await collectImagesRecursively(entry, list, joinRelativePath(basePath, entry.name));
			}
		}
	} catch (e) { console.error('再帰的な画像取得に失敗', e); }
	return list;
}

async function processDirectoryRecursive(dirHandle) {
	const label = `processDirectoryRecursive:${dirHandle.name}-${Date.now()}`;
	if (ENABLE_DEBUG_LOGS) {
		console.log(`[start] ${label}`);
		console.time(label);
	}
	clearTransientUrls();
	if (lazyLoadObserver) {
		lazyLoadObserver.disconnect();
		lazyLoadObserver = null;
	}

	showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
	updateThumbnailSize();
	itemList.innerHTML = '';
	toolbar.updateNavigationUI();
	currentDisplayImageList = [];

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
		if (sortOrder === 'asc') {
			return pathA.localeCompare(pathB, undefined, { numeric: true });
		} else {
			return pathB.localeCompare(pathA, undefined, { numeric: true });
		}
	});

	if (filterType === 'gif') {
		items = items.filter(i => i.name.toLowerCase().endsWith('.gif'));
	} else if (filterType === 'image') {
		// no change, show all images
	} else if (filterType === 'directory' || filterType === 'video') {
		items = [];
	}

	if (searchQuery) {
		items = items.filter(i => i.name.toLowerCase().includes(searchQuery));
	}

	if (favoriteOnly) {
		items = items.filter(i => i.isFavorite);
	}

	if (favoriteFirst) {
		items = sortByFavorite(items);
	}

	if (items.length === 0) {
		showStatus('表示できる画像がありません。', 'info');
		return;
	}

	showStatus('', 'clear');
	const useLazy = directoryHistory.length > 1 && items.length >= LAZY_LOAD_THRESHOLD;
	await gallery.renderItemsInBatches(items, null, useLazy, true);
	if (ENABLE_DEBUG_LOGS) {
		console.timeEnd(label);
		console.log(`[end] ${label}`);
	}
}

function updateViewModeUI() {
	if (isSinglePageView) {
		toggleViewBtn.textContent = '見開きに戻す';
		adjustSpreadBtn.style.display = 'none';
	} else {
		toggleViewBtn.textContent = '単一表示にする';
		adjustSpreadBtn.style.display = 'inline-block';
	}
}

function showStatus(message, type) {
	statusArea.innerHTML = message;
	statusArea.className = 'text-center my-8 p-4 rounded-lg ';
	switch (type) {
		case 'info': statusArea.classList.add('bg-blue-900', 'text-blue-200'); break;
		case 'error': statusArea.classList.add('bg-red-900', 'text-red-200'); break;
		case 'loading': statusArea.classList.add('text-gray-300'); break;
		case 'clear': statusArea.innerHTML = ''; statusArea.className = ''; break;
	}
}

function toggleFullscreen() {
	if (!document.fullscreenElement) {
		document.documentElement.requestFullscreen().catch(err => console.error(err));
	} else {
		document.exitFullscreen();
	}
}

function updateThumbnailSize() {
	const size = sizeOptions[thumbnailSizeIndex];
	itemList.className = 'grid ' + size.classes;
	itemList.classList.toggle('original-aspect', size.originalAspect);
	sizeSelect.value = thumbnailSizeIndex;
}

function ensureLazyLoadObserver() {
	if (!lazyLoadObserver) {
		lazyLoadObserver = new IntersectionObserver(entries => {
			entries.forEach(entry => {
				if (entry.isIntersecting) {
					const card = entry.target;
					if (card._loadThumb) card._loadThumb();
					lazyLoadObserver.unobserve(card);
					delete card._loadThumb;
				}
			});
		}, { rootMargin: '200px' });
	}
}

const toolbar = createToolbar({
	upDirBtn,
	copyPathBtn,
	listToolbar,
	currentDirName,
	recursiveBtn,
	toggleSortBtn,
	favoriteFirstBtn,
	favoriteOnlyBtn,
	viewerToolbar,
	getDirectoryHistoryLength: () => directoryHistory.length,
	getCurrentDirName: () => directoryHistory.length > 0 ? directoryHistory[directoryHistory.length - 1].name : '',
	getIsRecursiveMode: () => isRecursiveMode,
	setIsRecursiveMode: (value) => { isRecursiveMode = value; },
	getSortOrder: () => sortOrder,
	getFavoriteFirst: () => favoriteFirst,
	getFavoriteOnly: () => favoriteOnly,
	setToolbarHideTimer: (id) => { toolbarHideTimer = id; },
	getToolbarHideTimer: () => toolbarHideTimer
});

populateSizeSelect();
updateThumbnailSize();
toolbar.updateSortButtonUI();
toolbar.updateFavoriteControlsUI();
filterSelect.value = filterType;

const viewerController = createViewer({
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
	getCurrentImageFiles: () => currentImageFiles,
	setCurrentImageFiles: (files) => { currentImageFiles = files; },
	getCurrentImageIndex: () => currentImageIndex,
	setCurrentImageIndex: (index) => { currentImageIndex = index; },
	getPageOffset: () => pageOffset,
	setPageOffset: (offset) => { pageOffset = offset; },
	getSortOrder: () => sortOrder,
	getIsSinglePageView: () => isSinglePageView,
	setIsSinglePageView: (value) => { isSinglePageView = value; },
	updateViewModeUI,
	showStatus,
	ensureDirectoryCache
});

const gallery = createGallery({
	itemList,
	createdUrls,
	RIC,
	enableDebugLogs: ENABLE_DEBUG_LOGS,
	ensureLazyLoadObserver,
	getLazyLoadObserver: () => lazyLoadObserver,
	getCurrentDisplayImageList: () => currentDisplayImageList,
	openViewer: viewerController.openViewer,
	openVideoPlayer: viewerController.openVideoPlayer,
	enterDirectory,
	getDirectoryPreviewUrl,
	setFavoriteButtonState: toolbar.setFavoriteButtonState,
	toggleFavoriteEntry,
	getRootDirHandle,
	normalizeDirPathSegments,
	scheduleProcessForCurrentDir,
	getFavoriteFirst: () => favoriteFirst,
	getFavoriteOnly: () => favoriteOnly,
	showStatus
});

function rememberVisitedChild(parentHandle, childName) {
	if (parentHandle && childName) {
		lastVisitedChild.set(parentHandle, childName);
	}
}

async function scrollToVisitedChild(handle) {
	const childName = handle ? lastVisitedChild.get(handle) : null;
	if (!childName) return;
	let tries = 0;
	const maxTries = 20; // 約1秒 (20 * 50ms)
	while (tries < maxTries) {
		const target = Array.from(itemList.querySelectorAll('.directory-card'))
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
	for (const url of createdUrls) {
		URL.revokeObjectURL(url);
	}
	createdUrls.clear();
	for (const url of previewUrls) {
		URL.revokeObjectURL(url);
	}
	previewUrls.clear();
});

function scheduleProcessForCurrentDir(debounceMs = 150) {
	if (searchDebounceTimer) {
		clearTimeout(searchDebounceTimer);
	}
	searchDebounceTimer = setTimeout(async () => {
		if (directoryHistory.length === 0) return;
		const currentDir = directoryHistory[directoryHistory.length - 1];
		if (isRecursiveMode) {
			await processDirectoryRecursive(currentDir);
		} else {
			await processDirectory(currentDir, { useConfig: false });
		}
	}, debounceMs);
}
