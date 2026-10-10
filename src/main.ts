import './style.css';
import { CONFIG, DOM, state } from './state';
import type { FilterType } from './state';
import { createGallery } from './gallery';
import { createViewer } from './viewer';
import { createToolbar } from './toolbar';
import {
	buildFavoriteKey,
	compareNumericText,
	isImageFileName,
	normalizeDirPathSegments,
	sortByFavorite
} from './utils';
import {
	collectFavoriteFilesFromConfig,
	ensureConfigNode,
	getConfigNode,
	getFavoriteKeyForItem,
	makeFavoriteSet,
	makeHiddenSet,
	readRootConfig,
	toggleFavoriteEntry,
	toggleHiddenEntry,
	writeRootConfig
} from './storage';
import type { ConfigNode } from './storage';
import {
	ensureDirectoryCache,
	getDirectoryPreviewUrl,
	invalidateDirectoryCache
} from './directoryCache';
import { createRecursiveImageCache } from './recursiveImageCache';
import {
	populateSizeSelect,
	showStatus,
	toggleFullscreen,
	updateThumbnailSize,
	updateUiVisibilityUI,
	updateViewModeUI
} from './ui';
import { chooseNativeDirectory, getMediaSource, isDesktopApp, openNativeDirectory } from './nativeFs';

const isFilterType = (value: string): value is FilterType =>
	value === 'all' || value === 'directory' || value === 'image' || value === 'gif' || value === 'video';

const recursiveImageCache = createRecursiveImageCache();

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

function getDisplayPath() {
	const current = state.directoryHistory[state.directoryHistory.length - 1];
	return current?.nativePath || state.directoryHistory.map(handle => handle.name).join('/');
}

async function openRootDirectory(dirHandle: FileSystemDirectoryHandle) {
	recursiveImageCache.clear();
	state.directoryHistory = [dirHandle];
	resetSearchQuery();
	DOM.homeView.classList.add('hidden');
	DOM.itemList.classList.remove('hidden');
	DOM.statusArea.classList.remove('hidden');
	DOM.homeBtn.classList.remove('hidden');
	await renderActiveDirectoryView(dirHandle);
	await scrollToVisitedChild(dirHandle);
}

function createLibraryCard(item: DesktopLibraryItem) {
	const card = document.createElement('div');
	card.className = 'library-card';
	card.tabIndex = 0;
	card.setAttribute('role', 'button');
	card.innerHTML = `
		<div class="library-folder-icon">▰</div>
		<div class="library-copy"><div class="library-name"></div><div class="library-path"></div></div>
		<div class="library-card-actions">
			<button class="icon-btn favorite-root-btn${item.favorite ? ' active' : ''}" title="お気に入り">★</button>
			<button class="icon-btn remove-root-btn" title="履歴から削除">×</button>
		</div>`;
	const name = card.querySelector<HTMLElement>('.library-name');
	const path = card.querySelector<HTMLElement>('.library-path');
	if (name) name.textContent = item.name;
	if (path) path.textContent = item.path;
	const open = async () => {
		try { await openRootDirectory(await openNativeDirectory(item.path)); }
		catch (error) { console.error(error); showStatus('フォルダーを開けませんでした。', 'error'); await showHome(); }
	};
	card.addEventListener('click', open);
	card.addEventListener('keydown', event => {
		if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void open(); }
	});
	card.querySelector('.favorite-root-btn')?.addEventListener('click', async event => {
		event.stopPropagation();
		await window.desktopApi!.toggleFavoriteRoot(item.path);
		await showHome();
	});
	card.querySelector('.remove-root-btn')?.addEventListener('click', async event => {
		event.stopPropagation();
		await window.desktopApi!.removeRecent(item.path);
		await showHome();
	});
	return card;
}

async function showHome() {
	if (!isDesktopApp()) return;
	state.renderToken++;
	recursiveImageCache.clear();
	state.directoryHistory = [];
	state.currentDirHandle = null;
	clearTransientUrls();
	DOM.homeView.classList.remove('hidden');
	DOM.itemList.classList.add('hidden');
	DOM.statusArea.classList.add('hidden');
	DOM.listToolbar.classList.add('hidden');
	DOM.homeBtn.classList.add('hidden');
	DOM.currentDirName.textContent = 'ホーム';
	DOM.copyPathBtn.classList.add('hidden');
	DOM.reloadBtn.classList.add('hidden');
	DOM.recursiveBtn.classList.add('hidden');
	DOM.favoriteListBtn.classList.add('hidden');
	const items = await window.desktopApi!.getLibrary();
	const favorites = items.filter(item => item.favorite);
	DOM.favoriteRoots.replaceChildren(...favorites.map(createLibraryCard));
	DOM.recentRoots.replaceChildren(...items.map(createLibraryCard));
	DOM.favoriteRootsCount.textContent = `${favorites.length}`;
	DOM.recentRootsCount.textContent = `${items.length}`;
	DOM.favoriteRootsSection.classList.toggle('hidden', favorites.length === 0);
	DOM.recentRootsSection.classList.toggle('hidden', items.length === 0);
	DOM.emptyLibrary.classList.toggle('hidden', items.length > 0);
}

async function selectRootDirectory() {
	try {
		const dirHandle = isDesktopApp()
			? await chooseNativeDirectory()
			: await window.showDirectoryPicker?.();
		if (!dirHandle) return;
		await openRootDirectory(dirHandle);
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		console.error('ディレクトリ選択エラー:', err);
		showStatus('フォルダーを開けませんでした。', 'error');
	}
}

function isSupportedVideoFileName(name: string) {
	const lower = name.toLowerCase();
	return CONFIG.VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function getFavoriteListMediaType(name: string): 'image' | 'video' | null {
	if (isImageFileName(name, CONFIG.IMAGE_EXTENSIONS)) return 'image';
	if (isSupportedVideoFileName(name)) return 'video';
	return null;
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

function normalizeFavoriteMode() {
	if (state.favoriteOnly) {
		state.favoriteFirst = false;
		return;
	}
	if (state.favoriteFirst) {
		state.favoriteOnly = false;
	}
}

function setFavoriteMode(mode: 'off' | 'first' | 'only') {
	state.favoriteFirst = mode === 'first';
	state.favoriteOnly = mode === 'only';
}

async function renderActiveDirectoryView(
	dirHandle: FileSystemDirectoryHandle,
	options: { forceRefresh?: boolean; useConfig?: boolean } = {}
) {
	if (state.isFavoriteListMode) {
		await processFavoriteList();
		return;
	}
	if (state.isRecursiveMode) {
		await processDirectoryRecursive(dirHandle);
		return;
	}
	await processDirectory(dirHandle, options);
}

function updateUiDockReveal(clientY: number) {
	if (!state.isUiHidden) {
		if (state.isUiDockRevealed) {
			state.isUiDockRevealed = false;
			updateUiVisibilityUI();
		}
		return;
	}
	const revealThreshold = Math.max(window.innerHeight - 120, 0);
	const nextReveal = clientY >= revealThreshold;
	if (state.isUiDockRevealed !== nextReveal) {
		state.isUiDockRevealed = nextReveal;
		updateUiVisibilityUI();
	}
}

function applySettingsFromConfig(config: ConfigNode | null) {
	if (!config || !config.settings) return;
	const settings = config.settings;
	const nextSize = settings.thumbnailSizeIndex;
	if (typeof nextSize === 'number' && Number.isInteger(nextSize)) {
		state.thumbnailSizeIndex = nextSize;
	} else if (typeof nextSize === 'string') {
		const parsedSize = parseInt(nextSize, 10);
		if (Number.isInteger(parsedSize)) {
			state.thumbnailSizeIndex = parsedSize;
		}
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
	normalizeFavoriteMode();
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
	if (!isDesktopApp() && !window.showDirectoryPicker) {
		showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
		return;
	}
	await selectRootDirectory();
});

DOM.homeSelectDirBtn.addEventListener('click', selectRootDirectory);
DOM.homeBtn.addEventListener('click', showHome);

DOM.upDirBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length > 1) {
		const current = state.directoryHistory.pop();
		const parentDirHandle = state.directoryHistory[state.directoryHistory.length - 1];
		if (current) {
			rememberVisitedChild(parentDirHandle, current.name);
		}
		resetSearchQuery();
		await renderActiveDirectoryView(parentDirHandle);
		await scrollToVisitedChild(parentDirHandle);
	}
});

DOM.copyPathBtn.addEventListener('click', () => {
	if (state.directoryHistory.length > 0) {
		const path = getDisplayPath();
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
		const dirPath = getDisplayPath();
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
		invalidateDirectoryCache(currentDir);
		recursiveImageCache.clear();
		await renderActiveDirectoryView(currentDir, { forceRefresh: true, useConfig: false });
		await scrollToVisitedChild(currentDir);
	}
});

DOM.recursiveBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length === 0) return;
	const currentDir = state.directoryHistory[state.directoryHistory.length - 1];
	if (state.isRecursiveMode) {
		state.isRecursiveMode = false;
		toolbar.updateNavigationUI();
		await processDirectory(currentDir);
		await scrollToVisitedChild(currentDir);
	} else {
		if (state.isFavoriteListMode) {
			state.isFavoriteListMode = false;
		}
		if (state.isHiddenMode) {
			state.isHiddenMode = false;
		}
		toolbar.updateNavigationUI();
		const confirmLoad = confirm('このフォルダ配下のすべての画像を読み込みます。続行しますか？');
		if (!confirmLoad) return;
		state.isRecursiveMode = true;
		toolbar.updateNavigationUI();
		await processDirectoryRecursive(currentDir);
	}
});

DOM.favoriteListBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length === 0) return;
	const currentDir = state.directoryHistory[state.directoryHistory.length - 1];
	if (state.isFavoriteListMode) {
		state.isFavoriteListMode = false;
		toolbar.updateNavigationUI();
		await processDirectory(currentDir);
		await scrollToVisitedChild(currentDir);
		return;
	}
	if (state.isRecursiveMode) {
		state.isRecursiveMode = false;
	}
	if (state.isHiddenMode) {
		state.isHiddenMode = false;
	}
	toolbar.updateNavigationUI();
	const confirmLoad = confirm('ルート設定の .image-viewer.json からお気に入りファイルをすべて読み込みます。続行しますか？');
	if (!confirmLoad) return;
	state.isFavoriteListMode = true;
	toolbar.updateNavigationUI();
	await processFavoriteList();
});

DOM.hiddenModeBtn.addEventListener('click', async () => {
	if (state.directoryHistory.length === 0) return;
	if (state.isRecursiveMode) {
		state.isRecursiveMode = false;
	}
	if (state.isFavoriteListMode) {
		state.isFavoriteListMode = false;
	}
	state.isHiddenMode = !state.isHiddenMode;
	toolbar.updateNavigationUI();
	scheduleProcessForCurrentDir(0);
});

DOM.favoriteModeSelect.addEventListener('change', () => {
	const mode = DOM.favoriteModeSelect.value === 'first' || DOM.favoriteModeSelect.value === 'only'
		? DOM.favoriteModeSelect.value
		: 'off';
	setFavoriteMode(mode);
	toolbar.updateFavoriteControlsUI();
	scheduleSaveCurrentDirectoryConfig();
	scheduleProcessForCurrentDir(0);
});

DOM.uiVisibilityBtn.addEventListener('click', () => {
	state.isUiHidden = !state.isUiHidden;
	state.isUiDockRevealed = false;
	localStorage.setItem('isUiHidden', state.isUiHidden ? '1' : '0');
	updateUiVisibilityUI();
	toolbar.updateNavigationUI();
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
		if (DOM.viewer.style.display === 'flex') {
			viewerController.closeViewer();
		} else if (state.directoryHistory.length > 1) {
			DOM.upDirBtn.click();
		} else if (state.directoryHistory.length === 1 && isDesktopApp()) {
			void showHome();
		}
		return;
	}

	if (DOM.viewer.style.display !== 'flex') return;
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

document.addEventListener('mousemove', (e) => {
	updateUiDockReveal(e.clientY);
});

document.addEventListener('mouseleave', () => {
	if (!state.isUiHidden || !state.isUiDockRevealed) return;
	state.isUiDockRevealed = false;
	updateUiVisibilityUI();
});

DOM.listToolbar.addEventListener('focusin', () => {
	if (!state.isUiHidden || state.isUiDockRevealed) return;
	state.isUiDockRevealed = true;
	updateUiVisibilityUI();
});

DOM.listToolbar.addEventListener('focusout', () => {
	const activeElement = document.activeElement;
	if (!state.isUiHidden) return;
	if (activeElement instanceof Node && DOM.listToolbar.contains(activeElement)) return;
	state.isUiDockRevealed = false;
	updateUiVisibilityUI();
});

// --- メインロジック ---

async function processDirectory(
	dirHandle: FileSystemDirectoryHandle,
	{ forceRefresh = false, useConfig = true }: { forceRefresh?: boolean; useConfig?: boolean } = {}
) {
	const renderToken = ++state.renderToken;
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
		const rootHandle = getRootDirHandle();
		const [cacheEntry, rootConfig] = await Promise.all([
			ensureDirectoryCache(dirHandle, { forceRefresh }),
			readRootConfig(rootHandle)
		]);
		if (renderToken !== state.renderToken) return;
		const dirPathSegments = getCurrentDirPathSegments();
		const config = getConfigNode(rootConfig, dirPathSegments, { create: false }) || ensureConfigNode({});
		if (useConfig) {
			applySettingsFromConfig(config);
		}
		const favoriteSet = makeFavoriteSet(config);
		const hiddenSet = makeHiddenSet(config);
		if (!cacheEntry.sorted[state.sortOrder]) {
			const sorted = [...cacheEntry.items].sort((a, b) => {
				const nameA = (a.nameLower || a.name.toLowerCase());
				const nameB = (b.nameLower || b.name.toLowerCase());
				return state.sortOrder === 'asc'
					? compareNumericText(nameA, nameB)
					: compareNumericText(nameB, nameA);
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
			item.isHidden = key ? hiddenSet.has(key) : false;
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

		filteredItems = filteredItems.filter(i => state.isHiddenMode ? i.isHidden : !i.isHidden);

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

		const useLazy = true;
		const dirPath = dirPathSegments.join('/');
		await gallery.renderItemsInBatches(filteredItems, dirHandle, useLazy, dirPath, renderToken);

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
	const renderToken = ++state.renderToken;
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
	const rootHandle = getRootDirHandle();
	let previewActive = true;
	let previewStarted = false;
	let previewUrl: string | null = null;
	const showFirstImage = (images: { handle: FileSystemFileHandle; name: string; parentHandle: FileSystemDirectoryHandle }[]) => {
		if (previewStarted || renderToken !== state.renderToken) return;
		previewStarted = true;
		void getMediaSource(images[0].handle).then(source => {
			if (!previewActive || renderToken !== state.renderToken) {
				if (source.objectUrl) URL.revokeObjectURL(source.url);
				return;
			}
			if (source.objectUrl) previewUrl = source.url;
			const img = document.createElement('img');
			img.src = source.url;
			img.alt = images[0].name;
			img.className = 'scan-preview';
			img.title = '画像を開く';
			img.addEventListener('click', () => {
				void viewerController.openViewer(images[0].parentHandle, 0, [images[0].handle]);
			});
			DOM.statusArea.appendChild(img);
		}).catch(error => console.error('先頭画像のプレビューに失敗:', error));
	};
	const [collectedItems, rootConfig] = await Promise.all([
		recursiveImageCache.get(dirHandle, currentBasePath, {
			shouldContinue: () => renderToken === state.renderToken,
			onFirstImages: showFirstImage
		}),
		readRootConfig(rootHandle)
	]);
	previewActive = false;
	const clearPreview = () => {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = null;
	};
	if (renderToken !== state.renderToken) { clearPreview(); return; }
	let items = collectedItems;
	const uniquePaths = new Set(items.map(item => item.parentPath));
	const favoriteMap = new Map();
	const hiddenMap = new Map();
	uniquePaths.forEach(path => {
		const config = getConfigNode(rootConfig, path, { create: false }) || ensureConfigNode({});
		favoriteMap.set(path, makeFavoriteSet(config));
		hiddenMap.set(path, makeHiddenSet(config));
	});
	items.forEach(item => {
		const set = favoriteMap.get(item.parentPath);
		const hiddenSet = hiddenMap.get(item.parentPath);
		const key = buildFavoriteKey('file', item.name);
		item.isFavorite = set ? set.has(key) : false;
		item.isHidden = hiddenSet ? hiddenSet.has(key) : false;
	});
	items.sort((a, b) => {
		const pathA = a.path.toLowerCase();
		const pathB = b.path.toLowerCase();
		if (state.sortOrder === 'asc') {
			return compareNumericText(pathA, pathB);
		} else {
			return compareNumericText(pathB, pathA);
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

	items = items.filter(i => !i.isHidden);

	if (state.favoriteOnly) {
		items = items.filter(i => i.isFavorite);
	}

	if (state.favoriteFirst) {
		items = sortByFavorite(items);
	}

	if (items.length === 0) {
		clearPreview();
		showStatus('表示できる画像がありません。', 'info');
		return;
	}

	showStatus('', 'clear');
	clearPreview();
	const useLazy = true;
	await gallery.renderRecursiveItemsInBatches(items, useLazy, renderToken);
	if (CONFIG.ENABLE_DEBUG_LOGS) {
		console.timeEnd(label);
		console.log(`[end] ${label}`);
	}
}

async function processFavoriteList() {
	const renderToken = ++state.renderToken;
	const label = `processFavoriteList:${Date.now()}`;
	if (CONFIG.ENABLE_DEBUG_LOGS) {
		console.log(`[start] ${label}`);
		console.time(label);
	}
	clearTransientUrls();
	if (state.lazyLoadObserver) {
		state.lazyLoadObserver.disconnect();
		state.lazyLoadObserver = null;
	}

	showStatus('<div class="loader mx-auto"></div><p class="mt-2">お気に入りを読み込んでいます...</p>', 'loading');
	updateThumbnailSize();
	DOM.itemList.innerHTML = '';
	toolbar.updateNavigationUI();
	state.currentDisplayImageList = [];

	try {
		const rootHandle = getRootDirHandle();
		const rootConfig = await readRootConfig(rootHandle);
		const favoriteEntries = await collectFavoriteFilesFromConfig(rootHandle, rootConfig);
		let imageIndex = 0;
		let items = favoriteEntries
			.map(entry => {
				const type = getFavoriteListMediaType(entry.name);
				if (!type) return null;
				return {
					type,
					handle: entry.handle,
					name: entry.name,
					parentHandle: entry.parentHandle,
					imageIndex: type === 'image' ? imageIndex++ : -1,
					parentPath: entry.parentPath,
					path: entry.path,
					isFavorite: true,
					isHidden: entry.isHidden,
					displayIndex: undefined,
					nameLower: entry.name.toLowerCase()
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null);

		items.sort((a, b) => {
			const pathA = a.path.toLowerCase();
			const pathB = b.path.toLowerCase();
			return state.sortOrder === 'asc'
				? compareNumericText(pathA, pathB)
				: compareNumericText(pathB, pathA);
		});

		if (state.filterType === 'gif') {
			items = items.filter(i => i.type === 'image' && i.nameLower.endsWith('.gif'));
		} else if (state.filterType === 'image') {
			items = items.filter(i => i.type === 'image');
		} else if (state.filterType === 'video') {
			items = items.filter(i => i.type === 'video');
		} else if (state.filterType === 'directory') {
			items = [];
		}

		if (state.searchQuery) {
			items = items.filter(i => i.nameLower.includes(state.searchQuery));
		}

		items = items.filter(i => state.isHiddenMode ? i.isHidden : !i.isHidden);

		state.currentDisplayImageList = items
			.filter(i => i.type === 'image')
			.map(i => i.handle);

		const displayIndexMap = new WeakMap();
		state.currentDisplayImageList.forEach((handle, index) => {
			displayIndexMap.set(handle, index);
		});
		items.forEach(item => {
			if (item.type === 'image') {
				item.displayIndex = displayIndexMap.get(item.handle);
			}
		});

		if (items.length === 0) {
			showStatus('お気に入りに登録された表示可能なファイルがありません。', 'info');
			return;
		}

		showStatus('', 'clear');
		const useLazy = true;
		await gallery.renderCollectedMediaInBatches(items, useLazy, renderToken);
	} catch (err) {
		console.error('お気に入り一覧の処理エラー:', err);
		showStatus('お気に入り一覧の読み込み中にエラーが発生しました。', 'error');
	} finally {
		if (CONFIG.ENABLE_DEBUG_LOGS) {
			console.timeEnd(label);
			console.log(`[end] ${label}`);
		}
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
		}, { rootMargin: '600px' });
	}
}

const toolbar = createToolbar({
	upDirBtn: DOM.upDirBtn,
	copyPathBtn: DOM.copyPathBtn,
	reloadBtn: DOM.reloadBtn,
	listToolbar: DOM.listToolbar,
	currentDirName: DOM.currentDirName,
	recursiveBtn: DOM.recursiveBtn,
	favoriteListBtn: DOM.favoriteListBtn,
	toggleSortBtn: DOM.toggleSortBtn,
	favoriteModeSelect: DOM.favoriteModeSelect,
	hiddenModeBtn: DOM.hiddenModeBtn,
	uiVisibilityBtn: DOM.uiVisibilityBtn,
	viewerToolbar: DOM.viewerToolbar,
	getDirectoryHistoryLength: () => state.directoryHistory.length,
	getCurrentDirName: () => state.directoryHistory.length > 0 ? state.directoryHistory[state.directoryHistory.length - 1].name : '',
	getIsRecursiveMode: () => state.isRecursiveMode,
	getIsFavoriteListMode: () => state.isFavoriteListMode,
	setIsRecursiveMode: (value) => { state.isRecursiveMode = value; },
	getSortOrder: () => state.sortOrder,
	getFavoriteFirst: () => state.favoriteFirst,
	getFavoriteOnly: () => state.favoriteOnly,
	getIsHiddenMode: () => state.isHiddenMode,
	getIsUiHidden: () => state.isUiHidden,
	setToolbarHideTimer: (id) => { state.toolbarHideTimer = id; },
	getToolbarHideTimer: () => state.toolbarHideTimer
});

populateSizeSelect();
updateThumbnailSize();
updateUiVisibilityUI();
toolbar.updateSortButtonUI();
toolbar.updateFavoriteControlsUI();
DOM.filterSelect.value = state.filterType;
if (isDesktopApp()) {
	DOM.desktopBadge.classList.remove('hidden');
	void showHome();
}

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
	setCurrentDisplayImageList: (list) => { state.currentDisplayImageList = list; },
	openViewer: viewerController.openViewer,
	openVideoPlayer: viewerController.openVideoPlayer,
	enterDirectory,
	getDirectoryPreviewUrl,
	setFavoriteButtonState: toolbar.setFavoriteButtonState,
	setHiddenButtonState: (button, isHidden, isHiddenMode) => {
		button.classList.toggle('restore', isHiddenMode);
		button.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
		button.setAttribute('aria-label', isHiddenMode ? '非表示を解除' : '非表示');
		button.innerHTML = isHiddenMode
			? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 7l5 5V9c3.31 0 6 2.69 6 6a6 6 0 01-6 6 6 6 0 01-5.65-4H4.26A8 8 0 0012 22a8 8 0 000-16z"/></svg>`
			: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z"/></svg>`;
	},
	toggleFavoriteEntry,
	toggleHiddenEntry,
	getRootDirHandle,
	normalizeDirPathSegments,
	scheduleProcessForCurrentDir,
	getFavoriteFirst: () => state.favoriteFirst,
	getFavoriteOnly: () => state.favoriteOnly,
	getIsFavoriteListMode: () => state.isFavoriteListMode,
	getIsHiddenMode: () => state.isHiddenMode,
	getRenderToken: () => state.renderToken,
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

function scheduleProcessForCurrentDir(debounceMs = 150, preserveScrollPosition = false) {
	if (state.searchDebounceTimer) {
		clearTimeout(state.searchDebounceTimer);
	}
	const scrollPosition = preserveScrollPosition
		? { x: window.scrollX, y: window.scrollY }
		: null;
	state.searchDebounceTimer = setTimeout(async () => {
		if (state.directoryHistory.length === 0) return;
		const currentDir = state.directoryHistory[state.directoryHistory.length - 1];
		await renderActiveDirectoryView(currentDir, { useConfig: false });
		if (scrollPosition) {
			window.scrollTo(scrollPosition.x, scrollPosition.y);
			requestAnimationFrame(() => window.scrollTo(scrollPosition.x, scrollPosition.y));
		}
	}, debounceMs);
}
