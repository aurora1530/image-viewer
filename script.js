// DOM要素の取得
const selectDirBtn = document.getElementById('select-dir-btn');
const itemList = document.getElementById('item-list');
const statusArea = document.getElementById('status-area');
const viewer = document.getElementById('viewer');
const leftPageImg = document.getElementById('left-page');
const rightPageImg = document.getElementById('right-page');
const closeViewerBtn = document.getElementById('close-viewer-btn');
const adjustSpreadBtn = document.getElementById('adjust-spread-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const copyImagePathBtn = document.getElementById('copy-image-path-btn');
const pageCounter = document.getElementById('page-counter');
const toggleViewBtn = document.getElementById('toggle-view-btn');
const viewerToolbar = document.getElementById('viewer-toolbar');
const upDirBtn = document.getElementById('up-dir-btn');
const currentDirName = document.getElementById('current-dir-name');
const copyPathBtn = document.getElementById('copy-path-btn');
const sizeSelect = document.getElementById('size-select');
const filterSelect = document.getElementById('filter-select');
const searchInput = document.getElementById('search-input');
const listToolbar = document.getElementById('list-toolbar');
const toggleSortBtn = document.getElementById('toggle-sort-btn');
const reloadBtn = document.getElementById('reload-btn');
const recursiveBtn = document.getElementById('recursive-btn');
const viewerPages = document.getElementById('viewer-pages');
const viewerVideoContainer = document.getElementById('viewer-video-container');
const viewerVideo = document.getElementById('viewer-video');

// グローバル変数
let directoryHistory = [];
let currentImageFiles = [];
let currentImageIndex = 0;
let pageOffset = 0;
let isSinglePageView = localStorage.getItem('isSinglePageView') === '1';
let toolbarHideTimer = null;
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', ".heic"];
const videoExtensions = ['.mp4', '.webm', '.mov', '.ogg'];
const LAZY_LOAD_THRESHOLD = 500; // threshold for enabling lazy loading
let lazyLoadObserver = null;
let createdUrls = new Set();
const ENABLE_DEBUG_LOGS = true; // デバッグ用ログ出力をまとめて制御
let thumbnailSizeIndex = parseInt(localStorage.getItem('thumbnailSizeIndex') || '1', 10);
let sortOrder = 'asc';
let filterType = 'all';
let searchQuery = '';
let isRecursiveMode = false;
const lastVisitedChild = new WeakMap();
const directoryCache = new WeakMap(); // ディレクトリごとの項目キャッシュ
const directoryPreviewCache = new WeakMap(); // ディレクトリのプレビュー画像キャッシュ
const previewUrls = new Set(); // キャッシュ用 Object URL
let currentDirHandle = null;
let searchDebounceTimer = null;
const RIC = window.requestIdleCallback || function (cb) { return setTimeout(cb, 16); };
const CIC = window.cancelIdleCallback || clearTimeout;

function isImageFileName(name) {
    const lower = name.toLowerCase();
    return imageExtensions.some(ext => lower.endsWith(ext));
}

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

async function buildDirectoryCache(dirHandle) {
    const items = [];
    let imageCount = 0;
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                items.push({ type: 'directory', handle: entry, name: entry.name, nameLower: entry.name.toLowerCase() });
            } else if (entry.kind === 'file') {
                const lowerName = entry.name.toLowerCase();
                if (isImageFileName(lowerName)) {
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
            if (entry.kind === 'file' && isImageFileName(entry.name)) {
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
});

filterSelect.addEventListener('change', async () => {
    filterType = filterSelect.value;
    scheduleProcessForCurrentDir(0);
});

searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.toLowerCase();
    scheduleProcessForCurrentDir(180);
});

toggleSortBtn.addEventListener('click', async () => {
    sortOrder = (sortOrder === 'asc') ? 'desc' : 'asc';
    scheduleProcessForCurrentDir(0);
});

reloadBtn.addEventListener('click', async () => {
    if (directoryHistory.length > 0) {
        const currentDir = directoryHistory[directoryHistory.length - 1];
        if (isRecursiveMode) {
            await processDirectoryRecursive(currentDir);
        } else {
            invalidateDirectoryCache(currentDir);
            await processDirectory(currentDir, { forceRefresh: true });
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

closeViewerBtn.addEventListener('click', closeViewer);
toggleViewBtn.addEventListener('click', () => {
    isSinglePageView = !isSinglePageView;
    localStorage.setItem('isSinglePageView', isSinglePageView ? '1' : '0');
    updateViewModeUI();
    displayPages();
});
adjustSpreadBtn.addEventListener('click', () => {
    pageOffset = 1 - pageOffset;
    displayPages();
});

// ★変更点: ページ送りボタンの方向をR-to-Lに戻す
nextBtn.addEventListener('click', () => {
    const step = isSinglePageView ? 1 : 2;
    navigatePages(-step);
});
prevBtn.addEventListener('click', () => {
    const step = isSinglePageView ? 1 : 2;
    navigatePages(step);
});

fullscreenBtn.addEventListener('click', toggleFullscreen);

document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (viewer.style.display !== 'none') {
            closeViewer();
        } else if (directoryHistory.length > 1) {
            upDirBtn.click();
        }
        return;
    }

    if (viewer.style.display === 'none') return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeViewer();
        return;
    }
    if (!viewerVideoContainer.classList.contains('hidden')) return;

    // 右から左へ読み進める操作は意図されたもの (右矢印: 前のページ, 左矢印: 次のページ)
    const step = isSinglePageView ? 1 : 2;
    switch (e.key) {
        case 'ArrowLeft': navigatePages(step); break; // 次へ
        case 'ArrowRight': navigatePages(-step); break; // 前へ
    }
});

document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        viewer.addEventListener('mousemove', resetToolbarTimer);
        resetToolbarTimer();
    } else {
        viewer.removeEventListener('mousemove', resetToolbarTimer);
        clearTimeout(toolbarHideTimer);
        viewerToolbar.classList.remove('hidden');
    }
});

// --- メインロジック ---

async function processDirectory(dirHandle, { forceRefresh = false } = {}) {
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

    showStatus('<div class="loader mx-auto"></div><p class=\"mt-2\">フォルダを読み込んでいます...</p>', 'loading');
    updateThumbnailSize();
    itemList.innerHTML = '';
    updateNavigationUI();

    try {
        currentDirHandle = dirHandle;
        const cacheEntry = await ensureDirectoryCache(dirHandle, { forceRefresh });
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

        if (filteredItems.length === 0) {
            showStatus('表示できるアイテムがありません。', 'info');
            return;
        }

        showStatus('', 'clear');

        const useLazy = directoryHistory.length > 1 && cacheEntry.imageCount >= LAZY_LOAD_THRESHOLD;
        await renderItemsInBatches(filteredItems, dirHandle, useLazy);

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


function createItemCard(item, parentHandle, imageIndex, lazyLoad = false, container = null) {
    const card = document.createElement('div');
    card.className = 'group item-card';

    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.className = 'thumbnail-container cursor-pointer';

    if (item.type === 'directory') {
        card.classList.add('directory-card');
        card.dataset.dirName = item.name;
        const title = document.createElement('h3');
        title.className = 'dir-title';
        const titleText = document.createElement('span');
        titleText.textContent = item.name;
        titleText.className = 'break-all';
        title.appendChild(titleText);
        const badge = document.createElement('span');
        badge.className = 'dir-badge';
        badge.textContent = 'フォルダ';
        title.appendChild(badge);
        card.appendChild(thumbnailContainer);
        card.appendChild(title);
        thumbnailContainer.addEventListener('click', () => enterDirectory(item.handle));
        title.addEventListener('click', (e) => { if (e.target !== badge) enterDirectory(item.handle); });
    } else {
        card.classList.add('media-card');
        card.appendChild(thumbnailContainer);
        if (item.type === 'image') {
            card.addEventListener('click', () => openViewer(parentHandle, imageIndex));
        } else {
            card.addEventListener('click', () => openVideoPlayer(item.handle));
        }
    }

    (container || itemList).appendChild(card);

    const loadThumb = async () => {
        if (card.dataset.loaded) return;
        card.dataset.loaded = '1';
        if (item.type === 'image') {
            try {
                const file = await item.handle.getFile();
                const thumbnailUrl = URL.createObjectURL(file);
                createdUrls.add(thumbnailUrl);
                const img = document.createElement('img');
                img.loading = 'lazy';
                img.decoding = 'async';
                img.src = thumbnailUrl;
                img.alt = item.name;
                thumbnailContainer.appendChild(img);
            } catch(e) { console.error(`サムネイル生成失敗: ${item.name}`, e); }
        } else if (item.type === 'video') {
            const playIconOverlay = document.createElement('div');
            playIconOverlay.className = 'absolute inset-0 flex items-center justify-center pointer-events-none z-10';
            playIconOverlay.innerHTML = `<svg class="w-16 h-16 text-white opacity-70 group-hover:opacity-90 transition-opacity" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>`;
            thumbnailContainer.appendChild(playIconOverlay);
            try {
                const file = await item.handle.getFile();
                const videoUrl = URL.createObjectURL(file);
                createdUrls.add(videoUrl);
                const video = document.createElement('video');
                video.src = videoUrl + '#t=0.5';
                video.muted = true;
                video.preload = 'metadata';
                thumbnailContainer.insertBefore(video, playIconOverlay);
            } catch(e) { console.error(`ビデオサムネイル生成失敗: ${item.name}`, e); }
        } else if (item.type === 'directory') {
            const readBtn = document.createElement('button');
            readBtn.className = 'read-button';
            readBtn.textContent = '開く';
            readBtn.onclick = (e) => { e.stopPropagation(); openViewer(item.handle, 0); };
            thumbnailContainer.appendChild(readBtn);

            const thumbnailUrl = await getDirectoryPreviewUrl(item.handle);
            if (thumbnailUrl) {
                const img = document.createElement('img');
                img.loading = 'lazy';
                img.decoding = 'async';
                img.src = thumbnailUrl;
                img.alt = `Thumbnail for ${item.name}`;
                thumbnailContainer.insertBefore(img, thumbnailContainer.firstChild);
            } else {
                thumbnailContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`;
            }
        }
    };

    const shouldLazyLoad = lazyLoad || item.type === 'directory';
    if (shouldLazyLoad) {
        ensureLazyLoadObserver();
        card._loadThumb = loadThumb;
        lazyLoadObserver.observe(card);
    } else {
        loadThumb();
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
            if (entry.kind === 'file' && imageExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
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
            path: `${basePath}/${img.name}`
        });
    });
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                await collectImagesRecursively(entry, list, `${basePath}/${entry.name}`);
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
    updateNavigationUI();

    let items = await collectImagesRecursively(dirHandle);
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

    if (items.length === 0) {
        showStatus('表示できる画像がありません。', 'info');
        return;
    }

    showStatus('', 'clear');
    const useLazy = directoryHistory.length > 1 && items.length >= LAZY_LOAD_THRESHOLD;
    await renderItemsInBatches(items, null, useLazy, true);
    if (ENABLE_DEBUG_LOGS) {
        console.timeEnd(label);
        console.log(`[end] ${label}`);
    }
}

async function openViewer(dirHandle, startIndex) {
    try {
        showStatus('<div class="loader mx-auto"></div><p class="mt-2">画像を読み込んでいます...</p>', 'loading');
        const cacheEntry = await ensureDirectoryCache(dirHandle);
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
        currentImageFiles = cacheEntry.sorted[sortOrder]
            .filter(i => i.type === 'image')
            .map(i => i.handle);
        if (currentImageFiles.length === 0) { showStatus('このフォルダには表示できる画像がありません。', 'info'); return; }
        currentImageIndex = startIndex;
        pageOffset = 0;
        isSinglePageView = localStorage.getItem('isSinglePageView') === '1';
        viewer.style.display = 'flex';
        viewerPages.style.display = 'flex';
        viewerVideoContainer.classList.add('hidden');
        viewerToolbar.style.display = 'flex';
        listToolbar.style.display = 'none';
        document.body.style.overflow = 'hidden';
        updateViewModeUI();
        displayPages();
        showStatus('', 'clear');
    } catch (err) {
        console.error('ビューワー起動エラー:', err);
        showStatus('画像の読み込みに失敗しました。', 'error');
        closeViewer();
    }
}

async function openVideoPlayer(videoHandle) {
    try {
        viewer.style.display = 'flex';
        viewerPages.style.display = 'none';
        viewerVideoContainer.classList.remove('hidden');
        viewerToolbar.style.display = 'none';
        listToolbar.style.display = 'none';
        document.body.style.overflow = 'hidden';
        const file = await videoHandle.getFile();
        const url = URL.createObjectURL(file);
        createdUrls.add(url);
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
    if (leftPageImg.dataset.url) URL.revokeObjectURL(leftPageImg.dataset.url);
    if (rightPageImg.dataset.url) URL.revokeObjectURL(rightPageImg.dataset.url);
    createdUrls.delete(leftPageImg.dataset.url);
    createdUrls.delete(rightPageImg.dataset.url);
    leftPageImg.src = ''; rightPageImg.src = '';
    leftPageImg.dataset.url = ''; rightPageImg.dataset.url = '';
    currentImageFiles = [];
    if (viewerVideo.src) {
        viewerVideo.pause();
        URL.revokeObjectURL(viewerVideo.src);
        createdUrls.delete(viewerVideo.src);
        viewerVideo.src = '';
    }
    if (document.fullscreenElement) document.exitFullscreen();
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

async function displayPages() {
    viewerPages.classList.toggle('single-view', isSinglePageView);
    const total = currentImageFiles.length;
    if (isSinglePageView) {
        await Promise.all([
            displayImage(rightPageImg, currentImageIndex),
            displayImage(leftPageImg, -1)
        ]);
        pageCounter.textContent = `${currentImageIndex + 1} / ${total}`;
    } else {
        let baseIndex = currentImageIndex;
        if (baseIndex % 2 !== 0 && baseIndex > 0) baseIndex--;
        const rightPageIndex = baseIndex - pageOffset;
        const leftPageIndex = baseIndex + 1 - pageOffset;
        await Promise.all([
            displayImage(rightPageImg, rightPageIndex),
            displayImage(leftPageImg, leftPageIndex)
        ]);
        const rightPageNum = rightPageIndex >= 0 && rightPageIndex < total ? rightPageIndex + 1 : '-';
        const leftPageNum = leftPageIndex >= 0 && leftPageIndex < total ? leftPageIndex + 1 : '-';
        pageCounter.textContent = `${leftPageNum} - ${rightPageNum} / ${total}`;
    }
}

async function displayImage(imgElement, index) {
    if (imgElement.dataset.url) {
        URL.revokeObjectURL(imgElement.dataset.url);
        createdUrls.delete(imgElement.dataset.url);
        imgElement.dataset.url = '';
    }
    if (index >= 0 && index < currentImageFiles.length) {
        try {
            const file = await currentImageFiles[index].getFile();
            const url = URL.createObjectURL(file);
            createdUrls.add(url);
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

function navigatePages(direction) {
    const total = currentImageFiles.length;
    if (total <= 1) return;

    let newIndex = currentImageIndex + direction;

    if (newIndex >= total) {
        newIndex = 0;
    } else if (newIndex < 0) {
        if (isSinglePageView) {
            newIndex = total - 1;
        } else {
            let lastSpreadIndex = (total % 2 === 0) ? total - 2 : total - 1;
            newIndex = lastSpreadIndex < 0 ? 0 : lastSpreadIndex;
        }
    }

    if (newIndex !== currentImageIndex) {
        currentImageIndex = newIndex;
        displayPages();
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

function resetToolbarTimer() {
    clearTimeout(toolbarHideTimer);
    viewerToolbar.classList.remove('hidden');
    toolbarHideTimer = setTimeout(() => viewerToolbar.classList.add('hidden'), 2000);
}

function updateNavigationUI() {
    const isNotRoot = directoryHistory.length > 1;
    upDirBtn.classList.toggle('hidden', !isNotRoot);
    const hasHistory = directoryHistory.length > 0;
    copyPathBtn.classList.toggle('hidden', !hasHistory);
    listToolbar.classList.toggle('hidden', !hasHistory);
    if (hasHistory) {
        currentDirName.textContent = directoryHistory[directoryHistory.length - 1].name;
        recursiveBtn.textContent = isRecursiveMode ? '戻る' : '全画像一覧';
    } else {
        currentDirName.textContent = 'フォルダを選択してください';
        isRecursiveMode = false;
        recursiveBtn.textContent = '全画像一覧';
    }
    updateSortButtonUI();
}

function updateThumbnailSize() {
    const size = sizeOptions[thumbnailSizeIndex];
    itemList.className = 'grid ' + size.classes;
    itemList.classList.toggle('original-aspect', size.originalAspect);
    sizeSelect.value = thumbnailSizeIndex;
}

function updateSortButtonUI() {
    const iconUp = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block -mt-1 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>`;
    const iconDown = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block -mt-1 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
    if (sortOrder === 'asc') {
        toggleSortBtn.innerHTML = `${iconUp} 名前: 昇順`;
    } else {
        toggleSortBtn.innerHTML = `${iconDown} 名前: 降順`;
    }
}

populateSizeSelect();
updateThumbnailSize();
updateSortButtonUI();
filterSelect.value = filterType;

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

// ---- Rendering helpers ----
function renderItemsInBatches(items, dirHandle, useLazy, isRecursiveList = false) {
    return new Promise(resolve => {
        const label = ENABLE_DEBUG_LOGS ? `render:${dirHandle ? dirHandle.name : 'recursive'}-${Date.now()}` : null;
        if (label) console.time(label);
        const total = items.length;
        const chunkSize = 100;
        let index = 0;
        let chunk = 0;
        function renderChunk() {
            const frag = document.createDocumentFragment();
            for (let i = 0; i < chunkSize && index < total; i++, index++) {
                const it = items[index];
                if (isRecursiveList) {
                    createItemCard({ type: 'image', handle: it.handle, name: it.name, nameLower: it.name.toLowerCase() }, it.parentHandle, it.imageIndex, useLazy, frag);
                } else {
                    createItemCard(it, dirHandle, it.imageIndex, useLazy, frag);
                }
            }
            itemList.appendChild(frag);
            chunk++;
            if (label && chunk % 5 === 0) {
                console.log(`[render chunk] ${label} chunk=${chunk} rendered=${index}/${total}`);
            }
            if (index < total) {
                RIC(renderChunk);
            } else {
                if (label) {
                    console.timeEnd(label);
                    console.log(`[render done] ${label} total=${total} chunks=${chunk}`);
                }
                resolve();
            }
        }
        renderChunk();
    });
}

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
            await processDirectory(currentDir);
        }
    }, debounceMs);
}
