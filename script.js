// DOM要素の取得
const selectDirBtn = document.getElementById('select-dir-btn');
const directoryList = document.getElementById('directory-list');
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
const upDirBtn = document.getElementById('up-dir-btn'); // ★追加
const currentDirName = document.getElementById('current-dir-name'); // ★追加

// グローバル変数
let directoryHistory = []; // ★変更: ディレクトリ階層を管理
let currentImageFiles = [];
let currentImageIndex = 0;
let pageOffset = 0;
let isSinglePageView = false;
let toolbarHideTimer = null;

// --- イベントリスナー ---

// ルートフォルダ選択ボタン
selectDirBtn.addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
        showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
        return;
    }
    try {
        const dirHandle = await window.showDirectoryPicker();
        directoryHistory = [dirHandle]; // ★変更: 履歴をリセットしてルートを設定
        await processDirectory(dirHandle);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('ディレクトリ選択エラー:', err);
            showStatus('フォルダの選択中にエラーが発生しました。', 'error');
        }
    }
});

// ★追加: 上の階層へ戻るボタン
upDirBtn.addEventListener('click', async () => {
    if (directoryHistory.length > 1) {
        directoryHistory.pop();
        const parentDirHandle = directoryHistory[directoryHistory.length - 1];
        await processDirectory(parentDirHandle);
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

nextBtn.addEventListener('click', () => navigatePages(isSinglePageView ? -1 : -2));
prevBtn.addEventListener('click', () => navigatePages(isSinglePageView ? 1 : 2));

fullscreenBtn.addEventListener('click', toggleFullscreen);

document.addEventListener('keydown', (e) => {
    if (viewer.style.display === 'none') return;

    const step = isSinglePageView ? 1 : 2;
    switch (e.key) {
        case 'ArrowLeft':
            navigatePages(step);
            break;
        case 'ArrowRight':
            navigatePages(-step);
            break;
        case 'Escape':
            closeViewer();
            break;
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


// --- 関数 ---

/**
 * ★変更: ディレクトリを処理してサブディレクトリ一覧を表示する
 * @param {FileSystemDirectoryHandle} dirHandle
 */
async function processDirectory(dirHandle) {
    showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
    directoryList.innerHTML = '';
    updateNavigationUI(); // ★追加: ナビゲーションUIを更新

    const subdirectories = [];
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                subdirectories.push(entry);
            }
        }

        subdirectories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        if (subdirectories.length === 0) {
            showStatus('サブフォルダが見つかりませんでした。', 'info');
            return;
        }

        showStatus(`<strong>${subdirectories.length}</strong>個のフォルダを検出しました。サムネイルを生成中...`, 'loading');

        const cardPromises = subdirectories.map(subdir => createDirectoryCard(subdir));
        await Promise.all(cardPromises);

        showStatus('', 'clear');

    } catch (err) {
        console.error('ディレクトリ処理エラー:', err);
        showStatus('フォルダの読み込み中にエラーが発生しました。', 'error');
    }
}

/**
 * ★大幅変更: サブディレクトリのカードを作成して表示（画像有無で動作を分岐）
 * @param {FileSystemDirectoryHandle} subdirHandle
 */
async function createDirectoryCard(subdirHandle) {
    const card = document.createElement('div');
    card.className = 'group cursor-pointer bg-gray-800 rounded-lg shadow-md overflow-hidden transform transition-transform hover:-translate-y-1';

    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.className = 'thumbnail-container';

    const title = document.createElement('h3');
    title.className = 'p-3 text-sm font-semibold text-white truncate';
    title.textContent = subdirHandle.name;

    card.appendChild(thumbnailContainer);
    card.appendChild(title);
    directoryList.appendChild(card);

    try {
        const imageFiles = await getImageFilesFromDirectory(subdirHandle);

        if (imageFiles.length > 0) {
            // 画像がある場合：ビューワーを開く
            card.addEventListener('click', () => openViewer(subdirHandle, 0));
            const firstImageFile = await imageFiles[0].getFile();
            const thumbnailUrl = URL.createObjectURL(firstImageFile);
            const img = document.createElement('img');
            img.src = thumbnailUrl;
            img.alt = `Thumbnail for ${subdirHandle.name}`;
            img.onload = () => URL.revokeObjectURL(thumbnailUrl);
            thumbnailContainer.innerHTML = '';
            thumbnailContainer.appendChild(img);
        } else {
            // 画像がない場合：下の階層へ移動する
            card.addEventListener('click', async () => {
                directoryHistory.push(subdirHandle);
                await processDirectory(subdirHandle);
            });
            // フォルダアイコンを表示
            thumbnailContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>`;
        }
    } catch (err) {
        console.error(`カード生成エラー (${subdirHandle.name}):`, err);
        thumbnailContainer.innerHTML = '<span class="text-xs text-red-400">読込失敗</span>';
    }
}


async function getImageFilesFromDirectory(dirHandle) {
    const imageFiles = [];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && imageExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
            imageFiles.push(entry);
        }
    }
    imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return imageFiles;
}

async function openViewer(dirHandle, startIndex) {
    try {
        showStatus('<div class="loader mx-auto"></div><p class="mt-2">画像を読み込んでいます...</p>', 'loading');
        currentImageFiles = await getImageFilesFromDirectory(dirHandle);
        if (currentImageFiles.length === 0) {
            showStatus('このフォルダには表示できる画像がありません。', 'info');
            return;
        }

        currentImageIndex = startIndex;
        pageOffset = 0;
        isSinglePageView = false;

        viewer.style.display = 'flex';
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

function closeViewer() {
    viewer.style.display = 'none';
    document.body.style.overflow = 'auto';
    if (leftPageImg.src) URL.revokeObjectURL(leftPageImg.src);
    if (rightPageImg.src) URL.revokeObjectURL(rightPageImg.src);
    leftPageImg.src = '';
    rightPageImg.src = '';
    currentImageFiles = [];

    if (document.fullscreenElement) {
        document.exitFullscreen();
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

async function displayPages() {
    const leftContainer = leftPageImg.parentElement;
    const rightContainer = rightPageImg.parentElement;
    const total = currentImageFiles.length;

    if (isSinglePageView) {
        leftContainer.style.display = 'none';
        rightContainer.style.width = '100%';

        await displayImage(rightPageImg, currentImageIndex);
        await displayImage(leftPageImg, -1);

        pageCounter.textContent = `${currentImageIndex + 1} / ${total}`;

    } else {
        leftContainer.style.display = 'block';
        rightContainer.style.width = '50%';

        if (currentImageIndex % 2 !== 0 && currentImageIndex > 0) {
            currentImageIndex--;
        }

        const rightPageIndex = currentImageIndex - pageOffset;
        const leftPageIndex = currentImageIndex + 1 - pageOffset;

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
        imgElement.dataset.url = '';
    }

    if (index >= 0 && index < currentImageFiles.length) {
        try {
            const fileHandle = currentImageFiles[index];
            const file = await fileHandle.getFile();
            const url = URL.createObjectURL(file);
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
    let newIndex = currentImageIndex + direction;

    if (newIndex >= currentImageFiles.length) {
        newIndex = currentImageFiles.length - 1;
    }
    if (newIndex < 0) {
        newIndex = 0;
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
        case 'info':
            statusArea.classList.add('bg-blue-900', 'text-blue-200');
            break;
        case 'error':
            statusArea.classList.add('bg-red-900', 'text-red-200');
            break;
        case 'loading':
            statusArea.classList.add('text-gray-300');
            break;
        case 'clear':
            statusArea.innerHTML = '';
            statusArea.className = '';
            break;
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`全画面表示にできませんでした: ${err.message} (${err.name})`);
        });
    } else {
        document.exitFullscreen();
    }
}

function resetToolbarTimer() {
    clearTimeout(toolbarHideTimer);
    viewerToolbar.classList.remove('hidden');
    toolbarHideTimer = setTimeout(() => {
        viewerToolbar.classList.add('hidden');
    }, 2000);
}

/**
 * ★追加: ナビゲーションUI（戻るボタン、現在地表示）を更新する
 */
function updateNavigationUI() {
    if (directoryHistory.length > 1) {
        upDirBtn.classList.remove('hidden');
    } else {
        upDirBtn.classList.add('hidden');
    }

    if (directoryHistory.length > 0) {
        const currentHandle = directoryHistory[directoryHistory.length - 1];
        currentDirName.textContent = currentHandle.name;
    } else {
        currentDirName.textContent = 'フォルダを選択してください';
    }
}
