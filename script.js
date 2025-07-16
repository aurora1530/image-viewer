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
const pageCounter = document.getElementById('page-counter');
const toggleViewBtn = document.getElementById('toggle-view-btn');
const viewerToolbar = document.getElementById('viewer-toolbar');
const upDirBtn = document.getElementById('up-dir-btn');
const currentDirName = document.getElementById('current-dir-name');
const copyPathBtn = document.getElementById('copy-path-btn');
const toggleSizeBtn = document.getElementById('toggle-size-btn');
const toggleSortBtn = document.getElementById('toggle-sort-btn');
const recursiveBtn = document.getElementById('recursive-btn');
const viewerPages = document.getElementById('viewer-pages');
const viewerVideoContainer = document.getElementById('viewer-video-container');
const viewerVideo = document.getElementById('viewer-video');

// グローバル変数
let directoryHistory = [];
let currentImageFiles = [];
let currentImageIndex = 0;
let pageOffset = 0;
let isSinglePageView = false;
let toolbarHideTimer = null;
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const videoExtensions = ['.mp4', '.webm', '.mov', '.ogg'];
let createdUrls = new Set();
let thumbnailSizeIndex = 1;
let sortOrder = 'asc';
let isRecursiveMode = false;
const sizeOptions = [
    { name: '小', classes: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-4', originalAspect: false },
    { name: '中', classes: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6', originalAspect: false },
    { name: '大', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 md:gap-8', originalAspect: false },
    { name: '元サイズ', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8', originalAspect: true }
];

// --- イベントリスナー ---

selectDirBtn.addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
        showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
        return;
    }
    try {
        const dirHandle = await window.showDirectoryPicker();
        directoryHistory = [dirHandle];
        await processDirectory(dirHandle);
    } catch (err) {
        if (err.name !== 'AbortError') console.error('ディレクトリ選択エラー:', err);
    }
});

upDirBtn.addEventListener('click', async () => {
    if (directoryHistory.length > 1) {
        directoryHistory.pop();
        const parentDirHandle = directoryHistory[directoryHistory.length - 1];
        await processDirectory(parentDirHandle);
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

toggleSizeBtn.addEventListener('click', () => {
    thumbnailSizeIndex = (thumbnailSizeIndex + 1) % sizeOptions.length;
    updateThumbnailSize();
});

toggleSortBtn.addEventListener('click', async () => {
    sortOrder = (sortOrder === 'asc') ? 'desc' : 'asc';
    if (directoryHistory.length > 0) {
        await processDirectory(directoryHistory[directoryHistory.length - 1]);
    }
});

recursiveBtn.addEventListener('click', async () => {
    if (directoryHistory.length === 0) return;
    const currentDir = directoryHistory[directoryHistory.length - 1];
    if (isRecursiveMode) {
        isRecursiveMode = false;
        recursiveBtn.textContent = '全画像一覧';
        await processDirectory(currentDir);
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
    if (!viewerVideoContainer.classList.contains('hidden')) return;

    // 右から左へ読み進める操作は意図されたもの (右矢印: 前のページ, 左矢印: 次のページ)
    const step = isSinglePageView ? 1 : 2;
    switch (e.key) {
        case 'ArrowLeft': navigatePages(step); break; // 次へ
        case 'ArrowRight': navigatePages(-step); break; // 前へ
        case 'Escape': closeViewer(); break;
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

async function processDirectory(dirHandle) {
    for (const url of createdUrls) {
        URL.revokeObjectURL(url);
    }
    createdUrls.clear();

    showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
    updateThumbnailSize();
    itemList.innerHTML = '';
    updateNavigationUI();

    const items = [];
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                items.push({ type: 'directory', handle: entry, name: entry.name });
            } else if (entry.kind === 'file') {
                const lowerName = entry.name.toLowerCase();
                if (imageExtensions.some(ext => lowerName.endsWith(ext))) {
                    items.push({ type: 'image', handle: entry, name: entry.name });
                } else if (videoExtensions.some(ext => lowerName.endsWith(ext))) {
                    items.push({ type: 'video', handle: entry, name: entry.name });
                }
            }
        }

        items.sort((a, b) => {
            const nameA = a.name.toLowerCase();
            const nameB = b.name.toLowerCase();
            if (sortOrder === 'asc') {
                return nameA.localeCompare(nameB, undefined, { numeric: true });
            } else {
                return nameB.localeCompare(nameA, undefined, { numeric: true });
            }
        });

        if (items.length === 0) {
            showStatus('表示できるアイテムがありません。', 'info');
            return;
        }

        showStatus('', 'clear');

        const imageItems = items.filter(item => item.type === 'image');

        items.forEach(item => {
            const imageIndex = item.type === 'image' ? imageItems.findIndex(imgItem => imgItem.name === item.name) : -1;
            createItemCard(item, dirHandle, imageIndex);
        });

    } catch (err) {
        console.error('ディレクトリ処理エラー:', err);
        showStatus('フォルダの読み込み中にエラーが発生しました。', 'error');
    }
}

function createItemCard(item, parentHandle, imageIndex) {
    const card = document.createElement('div');
    card.className = 'group item-card';

    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.className = 'thumbnail-container cursor-pointer';

    if (item.type === 'directory') {
        card.classList.add('directory-card', 'bg-gray-800', 'rounded-lg', 'shadow-md', 'overflow-hidden');
        const title = document.createElement('h3');
        title.className = 'p-3 text-sm font-semibold text-white flex items-start justify-between flex-wrap gap-y-1';
        const titleText = document.createElement('span');
        titleText.textContent = item.name;
        titleText.className = "break-all";
        title.appendChild(titleText);
        const badge = document.createElement('span');
        badge.className = 'text-xs bg-gray-600 text-gray-300 px-2 py-1 rounded-full ml-2 self-center';
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
        } else { // video
            card.addEventListener('click', () => openVideoPlayer(item.handle));
        }
    }

    itemList.appendChild(card);

    (async () => {
        if (item.type === 'image') {
            try {
                const file = await item.handle.getFile();
                const thumbnailUrl = URL.createObjectURL(file);
                createdUrls.add(thumbnailUrl);
                const img = document.createElement('img');
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
            let imageForThumbnail = null;
            const directImages = await getImageFilesFromDirectory(item.handle);
            if (directImages.length > 0) {
                imageForThumbnail = directImages[0];
                const readBtn = document.createElement('button');
                readBtn.className = 'read-button';
                readBtn.textContent = '開く';
                readBtn.onclick = (e) => { e.stopPropagation(); openViewer(item.handle, 0); };
                thumbnailContainer.appendChild(readBtn);
            } else {
                const subSubDirs = [];
                try {
                     for await (const entry of item.handle.values()) {
                        if (entry.kind === 'directory') subSubDirs.push(entry);
                    }
                } catch (e) { console.error("サブディレクトリの読み込みに失敗", e); }
                subSubDirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                if (subSubDirs.length > 0) {
                    const deepImages = await getImageFilesFromDirectory(subSubDirs[0]);
                    if (deepImages.length > 0) imageForThumbnail = deepImages[0];
                }
            }
            if (imageForThumbnail) {
                const file = await imageForThumbnail.getFile();
                const thumbnailUrl = URL.createObjectURL(file);
                createdUrls.add(thumbnailUrl);
                const img = document.createElement('img');
                img.src = thumbnailUrl;
                img.alt = `Thumbnail for ${item.name}`;
                thumbnailContainer.insertBefore(img, thumbnailContainer.firstChild);
            } else {
                thumbnailContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>`;
            }
        }
    })();
}

async function enterDirectory(dirHandle) {
    directoryHistory.push(dirHandle);
    await processDirectory(dirHandle);
}

async function getImageFilesFromDirectory(dirHandle) {
    const imageFiles = [];
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && imageExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
                imageFiles.push(entry);
            }
        }
        imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } catch (e) { console.error(`ディレクトリ内の画像取得エラー (${dirHandle.name}):`, e); }
    return imageFiles;
}

async function collectImagesRecursively(dirHandle, list = []) {
    const images = await getImageFilesFromDirectory(dirHandle);
    images.forEach((img, idx) => {
        list.push({ handle: img, name: img.name, parentHandle: dirHandle, imageIndex: idx });
    });
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                await collectImagesRecursively(entry, list);
            }
        }
    } catch (e) { console.error('再帰的な画像取得に失敗', e); }
    return list;
}

async function processDirectoryRecursive(dirHandle) {
    for (const url of createdUrls) {
        URL.revokeObjectURL(url);
    }
    createdUrls.clear();

    showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
    updateThumbnailSize();
    itemList.innerHTML = '';
    updateNavigationUI();

    const items = await collectImagesRecursively(dirHandle);
    items.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        if (sortOrder === 'asc') {
            return nameA.localeCompare(nameB, undefined, { numeric: true });
        } else {
            return nameB.localeCompare(nameA, undefined, { numeric: true });
        }
    });

    if (items.length === 0) {
        showStatus('表示できる画像がありません。', 'info');
        return;
    }

    showStatus('', 'clear');
    items.forEach(item => {
        createItemCard({ type: 'image', handle: item.handle, name: item.name }, item.parentHandle, item.imageIndex);
    });
}

async function openViewer(dirHandle, startIndex) {
    try {
        showStatus('<div class="loader mx-auto"></div><p class="mt-2">画像を読み込んでいます...</p>', 'loading');
        currentImageFiles = await getImageFilesFromDirectory(dirHandle);
        if (currentImageFiles.length === 0) { showStatus('このフォルダには表示できる画像がありません。', 'info'); return; }
        currentImageIndex = startIndex;
        pageOffset = 0;
        isSinglePageView = false;
        viewer.style.display = 'flex';
        viewerPages.style.display = 'flex';
        viewerVideoContainer.classList.add('hidden');
        viewerToolbar.style.display = 'flex';
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
        await displayImage(rightPageImg, currentImageIndex);
        await displayImage(leftPageImg, -1);
        pageCounter.textContent = `${currentImageIndex + 1} / ${total}`;
    } else {
        let baseIndex = currentImageIndex;
        if (baseIndex % 2 !== 0 && baseIndex > 0) baseIndex--;
        const rightPageIndex = baseIndex - pageOffset;
        const leftPageIndex = baseIndex + 1 - pageOffset;
        await displayImage(rightPageImg, rightPageIndex);
        await displayImage(leftPageImg, leftPageIndex);
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
    toggleSizeBtn.classList.toggle('hidden', !hasHistory);
    toggleSortBtn.classList.toggle('hidden', !hasHistory);
    recursiveBtn.classList.toggle('hidden', !hasHistory);
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
    const svgIcon = toggleSizeBtn.querySelector('svg').outerHTML;
    toggleSizeBtn.innerHTML = `${svgIcon} サイズ: ${size.name}`;
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

updateSortButtonUI();
