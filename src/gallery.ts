import type { StatusType } from './ui';

type MediaType = 'image' | 'video';

type DirectoryItem = {
	type: 'directory';
	handle: FileSystemDirectoryHandle;
	name: string;
	nameLower?: string;
	displayIndex?: number;
	isFavorite?: boolean;
	isHidden?: boolean;
	imageIndex?: number;
};

type MediaItem = {
	type: MediaType;
	handle: FileSystemFileHandle;
	name: string;
	nameLower?: string;
	displayIndex?: number;
	isFavorite?: boolean;
	isHidden?: boolean;
	imageIndex?: number;
};

type Item = DirectoryItem | MediaItem;

type RecursiveItem = {
	handle: FileSystemFileHandle;
	name: string;
	parentHandle: FileSystemDirectoryHandle;
	imageIndex: number;
	parentPath: string;
	path: string;
	isFavorite?: boolean;
	isHidden?: boolean;
	displayIndex?: number;
	nameLower?: string;
};

type GalleryDeps = {
	itemList: HTMLElement;
	createdUrls: Set<string>;
	RIC: (cb: () => void) => number;
	enableDebugLogs: boolean;
	ensureLazyLoadObserver: () => void;
	getLazyLoadObserver: () => IntersectionObserver | null;
	getCurrentDisplayImageList: () => FileSystemFileHandle[];
	setCurrentDisplayImageList: (list: FileSystemFileHandle[]) => void;
	openViewer: (handle: FileSystemDirectoryHandle, startIndex: number, overrideList?: FileSystemFileHandle[] | null) => void;
	openVideoPlayer: (handle: FileSystemFileHandle) => void;
	enterDirectory: (handle: FileSystemDirectoryHandle) => Promise<void>;
	getDirectoryPreviewUrl: (handle: FileSystemDirectoryHandle) => Promise<string | null>;
	setFavoriteButtonState: (button: HTMLButtonElement, isActive: boolean) => void;
	setHiddenButtonState: (button: HTMLButtonElement, isHidden: boolean, isHiddenMode: boolean) => void;
	toggleFavoriteEntry: (
		rootHandle: FileSystemDirectoryHandle | null,
		dirPathSegments: unknown,
		entry: { type: string; path: string },
		onError: (message: string) => void
	) => Promise<boolean>;
	toggleHiddenEntry: (
		rootHandle: FileSystemDirectoryHandle | null,
		dirPathSegments: unknown,
		entry: { type: string; path: string },
		onError: (message: string) => void
	) => Promise<boolean>;
	getRootDirHandle: () => FileSystemDirectoryHandle | null;
	normalizeDirPathSegments: (path: unknown) => string[];
	scheduleProcessForCurrentDir: (debounceMs: number) => void;
	getFavoriteFirst: () => boolean;
	getFavoriteOnly: () => boolean;
	getIsHiddenMode: () => boolean;
	getRenderToken: () => number;
	showStatus: (message: string, type: StatusType) => void;
};

export function createGallery(deps: GalleryDeps) {
	const {
		itemList,
		createdUrls,
		RIC,
		enableDebugLogs,
		ensureLazyLoadObserver,
		getLazyLoadObserver,
		getCurrentDisplayImageList,
		setCurrentDisplayImageList,
		openViewer,
		openVideoPlayer,
		enterDirectory,
		getDirectoryPreviewUrl,
		setFavoriteButtonState,
		setHiddenButtonState,
		toggleFavoriteEntry,
		toggleHiddenEntry,
		getRootDirHandle,
		normalizeDirPathSegments,
		scheduleProcessForCurrentDir,
		getFavoriteFirst,
		getFavoriteOnly,
		getIsHiddenMode,
		getRenderToken,
		showStatus
	} = deps;

	function removeCardFromCurrentView(card: HTMLDivElement, item: Item) {
		if (item.type === 'image') {
			const nextList = getCurrentDisplayImageList().filter(handle => handle !== item.handle);
			setCurrentDisplayImageList(nextList);
		}
		card.remove();
		if (itemList.querySelector('.item-card')) {
			showStatus('', 'clear');
			return;
		}
		showStatus('表示できるアイテムがありません。', 'info');
	}

	function createItemCard(item: Item, parentHandle: FileSystemDirectoryHandle | null, imageIndex: number, lazyLoad = false, container: ParentNode | null = null, parentPath = '') {
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
				card.addEventListener('click', () => {
					if (!parentHandle) return;
					const displayList = getCurrentDisplayImageList();
					const resolvedIndex = displayList.findIndex(handle => handle === item.handle);
					const startIndex = resolvedIndex >= 0
						? resolvedIndex
						: (typeof item.displayIndex === 'number' ? item.displayIndex : imageIndex);
					const overrideList = displayList.length > 0 ? displayList : null;
					openViewer(parentHandle, startIndex, overrideList);
				});
			} else {
				card.addEventListener('click', () => openVideoPlayer(item.handle));
			}
		}

		(container || itemList).appendChild(card);

		if (parentHandle) {
			const canToggleHidden = parentPath.length > 0;
			if (canToggleHidden) {
				const hiddenBtn = document.createElement('button');
				hiddenBtn.className = 'hidden-toggle-btn';
				hiddenBtn.type = 'button';
				setHiddenButtonState(hiddenBtn, !!item.isHidden, getIsHiddenMode());
				hiddenBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					const entryType = item.type === 'directory' ? 'directory' : 'file';
					const dirPathSegments = normalizeDirPathSegments(parentPath);
					const rootHandle = getRootDirHandle();
					const nextState = await toggleHiddenEntry(
						rootHandle,
						dirPathSegments,
						{ type: entryType, path: item.name },
						(message) => showStatus(message, 'error')
					);
					item.isHidden = nextState;
					setHiddenButtonState(hiddenBtn, nextState, getIsHiddenMode());
					removeCardFromCurrentView(card, item);
				});
				thumbnailContainer.appendChild(hiddenBtn);
			}

			const favoriteBtn = document.createElement('button');
			favoriteBtn.className = 'favorite-btn';
			favoriteBtn.type = 'button';
			favoriteBtn.setAttribute('aria-label', 'お気に入り');
			favoriteBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 6 4 4 6.5 4c1.74 0 3.41 1.01 4.22 2.62h2.56C14.09 5.01 15.76 4 17.5 4 20 4 22 6 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
			setFavoriteButtonState(favoriteBtn, !!item.isFavorite);
			favoriteBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const entryType = item.type === 'directory' ? 'directory' : 'file';
				const dirPathSegments = normalizeDirPathSegments(parentPath);
				const rootHandle = getRootDirHandle();
				const nextState = await toggleFavoriteEntry(
					rootHandle,
					dirPathSegments,
					{ type: entryType, path: item.name },
					(message) => showStatus(message, 'error')
				);
				setFavoriteButtonState(favoriteBtn, nextState);
				if (getFavoriteOnly() || getFavoriteFirst()) {
					scheduleProcessForCurrentDir(0);
				}
			});
			thumbnailContainer.appendChild(favoriteBtn);
		}

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
					const placeholder = document.createElement('div');
					placeholder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`;
					const icon = placeholder.firstElementChild;
					if (icon) {
						thumbnailContainer.insertBefore(icon, thumbnailContainer.firstChild);
					}
				}
			}
		};

		const shouldLazyLoad = lazyLoad || item.type === 'directory';
		if (shouldLazyLoad) {
			ensureLazyLoadObserver();
			card._loadThumb = loadThumb;
			const observer = getLazyLoadObserver();
			if (observer) observer.observe(card);
		} else {
			loadThumb();
		}
	}

	function renderItemsInBatches(items: Item[], dirHandle: FileSystemDirectoryHandle | null, useLazy: boolean, parentPath = '', renderToken = getRenderToken()) {
		return new Promise<void>(resolve => {
			const label = enableDebugLogs ? `render:${dirHandle ? dirHandle.name : 'list'}-${Date.now()}` : null;
			if (label) console.time(label);
			const total = items.length;
			const chunkSize = 100;
			let index = 0;
			let chunk = 0;
			function renderChunk() {
				if (renderToken !== getRenderToken()) {
					if (label) console.timeEnd(label);
					resolve();
					return;
				}
				const frag = document.createDocumentFragment();
				for (let i = 0; i < chunkSize && index < total; i++, index++) {
					const it = items[index];
					createItemCard(it, dirHandle, it.imageIndex ?? 0, useLazy, frag, parentPath);
				}
				if (renderToken !== getRenderToken()) {
					if (label) console.timeEnd(label);
					resolve();
					return;
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

	function renderRecursiveItemsInBatches(items: RecursiveItem[], useLazy: boolean, renderToken = getRenderToken()) {
		return new Promise<void>(resolve => {
			const label = enableDebugLogs ? `render:recursive-${Date.now()}` : null;
			if (label) console.time(label);
			const total = items.length;
			const chunkSize = 100;
			let index = 0;
			let chunk = 0;
			function renderChunk() {
				if (renderToken !== getRenderToken()) {
					if (label) console.timeEnd(label);
					resolve();
					return;
				}
				const frag = document.createDocumentFragment();
				for (let i = 0; i < chunkSize && index < total; i++, index++) {
					const rec = items[index];
					createItemCard(
						{
							type: 'image',
							handle: rec.handle,
							name: rec.name,
							nameLower: rec.name.toLowerCase(),
							isFavorite: rec.isFavorite,
							isHidden: rec.isHidden,
							displayIndex: rec.displayIndex
						},
						rec.parentHandle,
						rec.imageIndex,
						useLazy,
						frag,
						rec.parentPath
					);
				}
				if (renderToken !== getRenderToken()) {
					if (label) console.timeEnd(label);
					resolve();
					return;
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

	return {
		createItemCard,
		renderItemsInBatches,
		renderRecursiveItemsInBatches
	};
}
