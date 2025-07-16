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
const toggleViewBtn = document.getElementById('toggle-view-btn'); // ★追加

// グローバル変数
let currentDirectoryHandle = null;
let currentImageFiles = [];
let currentImageIndex = 0;
let pageOffset = 0; // 0: 通常, 1: 1ページずらす
let isSinglePageView = false; // ★追加: 表示モードの状態

// --- イベントリスナー ---

// 親フォルダ選択ボタン
selectDirBtn.addEventListener('click', async () => {
    if (!('showDirectoryPicker' in window)) {
        showStatus('お使いのブラウザはこの機能に対応していません。Google ChromeやMicrosoft Edgeの最新版をお試しください。', 'error');
        return;
    }
    try {
        const dirHandle = await window.showDirectoryPicker();
        currentDirectoryHandle = dirHandle;
        await processDirectory(dirHandle);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('ディレクトリ選択エラー:', err);
            showStatus('フォルダの選択中にエラーが発生しました。', 'error');
        }
    }
});

// ビューワーを閉じる
closeViewerBtn.addEventListener('click', closeViewer);

// ★追加: 表示モード切替
toggleViewBtn.addEventListener('click', () => {
    isSinglePageView = !isSinglePageView;
    updateViewMode();
    displayPages();
});

// 見開き調整
adjustSpreadBtn.addEventListener('click', () => {
    pageOffset = 1 - pageOffset; // 0と1をトグル
    displayPages();
});

// ページ送りボタン
nextBtn.addEventListener('click', () => navigatePages(isSinglePageView ? -1 : -2));
prevBtn.addEventListener('click', () => navigatePages(isSinglePageView ? 1 : 2));

// 全画面切り替え
fullscreenBtn.addEventListener('click', toggleFullscreen);

// ★変更点: キーボード操作をモードに対応させる
document.addEventListener('keydown', (e) => {
    if (viewer.style.display === 'none') return;

    const step = isSinglePageView ? 1 : 2;
    switch (e.key) {
        case 'ArrowRight':
            navigatePages(step); // 前のページ
            break;
        case 'ArrowLeft':
            navigatePages(-step); // 次のページ
            break;
        case 'Escape':
            closeViewer();
            break;
    }
});

// --- 関数 ---

/**
 * 親ディレクトリを処理してサブディレクトリ一覧を表示する
 * @param {FileSystemDirectoryHandle} dirHandle
 */
async function processDirectory(dirHandle) {
    showStatus('<div class="loader mx-auto"></div><p class="mt-2">フォルダを読み込んでいます...</p>', 'loading');
    directoryList.innerHTML = '';
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

        const thumbnailPromises = subdirectories.map(subdir => createDirectoryCard(subdir));
        await Promise.all(thumbnailPromises);

        showStatus('', 'clear');

    } catch (err) {
        console.error('ディレクトリ処理エラー:', err);
        showStatus('フォルダの読み込み中にエラーが発生しました。', 'error');
    }
}

/**
 * サブディレクトリのカード（サムネイル付き）を作成して表示
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

    card.addEventListener('click', () => openViewer(subdirHandle, 0));
    directoryList.appendChild(card);

    try {
        const imageFiles = await getImageFilesFromDirectory(subdirHandle);
        if (imageFiles.length > 0) {
            const firstImageFile = await imageFiles[0].getFile();
            const thumbnailUrl = URL.createObjectURL(firstImageFile);
            const img = document.createElement('img');
            img.src = thumbnailUrl;
            img.alt = `Thumbnail for ${subdirHandle.name}`;
            img.onload = () => URL.revokeObjectURL(thumbnailUrl);
            thumbnailContainer.innerHTML = '';
            thumbnailContainer.appendChild(img);
        } else {
            thumbnailContainer.innerHTML = '<span class="text-xs text-gray-400">画像なし</span>';
        }
    } catch (err) {
        console.error(`サムネイル生成エラー (${subdirHandle.name}):`, err);
        thumbnailContainer.innerHTML = '<span class="text-xs text-red-400">読込失敗</span>';
    }
}

/**
 * 指定されたディレクトリから画像ファイルの一覧を取得してソートする
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<FileSystemFileHandle[]>}
 */
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

/**
 * ビューワーを開く
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {number} startIndex
 */
async function openViewer(dirHandle, startIndex) {
    try {
        showStatus('<div class="loader mx-auto"></div><p class="mt-2">画像を読み込んでいます...</p>', 'loading');
        currentImageFiles = await getImageFilesFromDirectory(dirHandle);
        if (currentImageFiles.length === 0) {
            showStatus('このフォルダには表示できる画像がありません。', 'info');
            return;
        }

        currentImageIndex = startIndex;
        pageOffset = 0; // ズレをリセット
        isSinglePageView = false; // ★追加: デフォルトは見開き

        viewer.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        updateViewMode(); // ★追加: ボタンの表示を更新
        displayPages();
        showStatus('', 'clear');

    } catch (err) {
        console.error('ビューワー起動エラー:', err);
        showStatus('画像の読み込みに失敗しました。', 'error');
        closeViewer();
    }
}

/**
 * ビューワーを閉じる
 */
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

/**
 * ★追加: 表示モードに応じてUIを更新する
 */
function updateViewMode() {
    if (isSinglePageView) {
        toggleViewBtn.textContent = '単一表示';
        adjustSpreadBtn.style.display = 'none';
    } else {
        toggleViewBtn.textContent = '見開き表示';
        adjustSpreadBtn.style.display = 'inline-block';
    }
}

/**
 * ★変更点: ページを表示する（モード対応）
 */
async function displayPages() {
    const leftContainer = leftPageImg.parentElement;
    const rightContainer = rightPageImg.parentElement;
    const total = currentImageFiles.length;

    if (isSinglePageView) {
        // --- 単一ページ表示 ---
        leftContainer.style.display = 'none';
        rightContainer.style.width = '100%';

        await displayImage(rightPageImg, currentImageIndex);
        await displayImage(leftPageImg, -1); // 左ページは非表示

        pageCounter.textContent = `${currentImageIndex + 1} / ${total}`;

    } else {
        // --- 見開きページ表示 ---
        leftContainer.style.display = 'block';
        rightContainer.style.width = '50%';

        // 現在のページが見開き開始位置（偶数）になるように調整
        if (currentImageIndex % 2 !== 0) {
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


/**
 * 指定されたimg要素に画像を表示する
 * @param {HTMLImageElement} imgElement
 * @param {number} index
 */
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

/**
 * ★変更点: ページを移動する（モード対応）
 * @param {number} direction -1 or -2で次へ, 1 or 2で前へ
 */
function navigatePages(direction) {
    let newIndex = currentImageIndex + direction;

    // インデックスが範囲内に収まるように調整
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

/**
 * ステータスメッセージを表示する
 * @param {string} message - HTMLも可
 * @param {'info'|'error'|'loading'|'clear'} type
 */
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

/**
 * 全画面表示をトグルする
 */
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`全画面表示にできませんでした: ${err.message} (${err.name})`);
        });
    } else {
        document.exitFullscreen();
    }
}
