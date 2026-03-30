type ToolbarDeps = {
	upDirBtn: HTMLElement;
	copyPathBtn: HTMLElement;
	reloadBtn: HTMLElement;
	listToolbar: HTMLElement;
	currentDirName: HTMLElement;
	recursiveBtn: HTMLButtonElement;
	toggleSortBtn: HTMLButtonElement;
	favoriteModeSelect: HTMLSelectElement;
	hiddenModeBtn: HTMLButtonElement;
	uiVisibilityBtn: HTMLButtonElement;
	viewerToolbar: HTMLElement;
	getDirectoryHistoryLength: () => number;
	getCurrentDirName: () => string;
	getIsRecursiveMode: () => boolean;
	setIsRecursiveMode: (value: boolean) => void;
	getSortOrder: () => 'asc' | 'desc';
	getFavoriteFirst: () => boolean;
	getFavoriteOnly: () => boolean;
	getIsHiddenMode: () => boolean;
	getIsUiHidden: () => boolean;
	setToolbarHideTimer: (id: number | null) => void;
	getToolbarHideTimer: () => number | null;
};

export function createToolbar(deps: ToolbarDeps) {
	const {
		upDirBtn,
		copyPathBtn,
		reloadBtn,
		listToolbar,
		currentDirName,
		recursiveBtn,
		toggleSortBtn,
		favoriteModeSelect,
		hiddenModeBtn,
		uiVisibilityBtn,
		viewerToolbar,
		getDirectoryHistoryLength,
		getCurrentDirName,
		getIsRecursiveMode,
		setIsRecursiveMode,
		getSortOrder,
		getFavoriteFirst,
		getFavoriteOnly,
		getIsHiddenMode,
		getIsUiHidden,
		setToolbarHideTimer,
		getToolbarHideTimer
	} = deps;

	function setFavoriteButtonState(button: HTMLButtonElement, isActive: boolean) {
		button.classList.toggle('active', !!isActive);
		button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
	}

	function updateFavoriteControlsUI() {
		if (getFavoriteOnly()) {
			favoriteModeSelect.value = 'only';
			return;
		}
		if (getFavoriteFirst()) {
			favoriteModeSelect.value = 'first';
			return;
		}
		favoriteModeSelect.value = 'off';
	}

	function updateSortButtonUI() {
		const iconUp = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block -mt-1 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>`;
		const iconDown = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 inline-block -mt-1 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
		if (getSortOrder() === 'asc') {
			toggleSortBtn.innerHTML = `${iconUp} 名前: 昇順`;
		} else {
			toggleSortBtn.innerHTML = `${iconDown} 名前: 降順`;
		}
	}

	function updateNavigationUI() {
		const isNotRoot = getDirectoryHistoryLength() > 1;
		upDirBtn.classList.toggle('hidden', !isNotRoot);
		const hasHistory = getDirectoryHistoryLength() > 0;
		copyPathBtn.classList.toggle('hidden', !hasHistory);
		reloadBtn.classList.toggle('hidden', !hasHistory);
		recursiveBtn.classList.toggle('hidden', !hasHistory);
		listToolbar.classList.toggle('hidden', !hasHistory);
		if (hasHistory) {
			currentDirName.textContent = getCurrentDirName();
			recursiveBtn.textContent = getIsRecursiveMode() ? '戻る' : '全画像一覧';
		} else {
			currentDirName.textContent = 'フォルダを選択してください';
			setIsRecursiveMode(false);
			recursiveBtn.textContent = '全画像一覧';
		}
		updateSortButtonUI();
		updateFavoriteControlsUI();
		hiddenModeBtn.textContent = getIsHiddenMode() ? '戻る' : '非表示一覧';
		hiddenModeBtn.setAttribute('aria-pressed', getIsHiddenMode() ? 'true' : 'false');
		uiVisibilityBtn.textContent = getIsUiHidden() ? 'UI表示' : 'UI非表示';
	}

	function resetToolbarTimer() {
		const existing = getToolbarHideTimer();
		if (existing) clearTimeout(existing);
		viewerToolbar.classList.remove('hidden');
		const next = window.setTimeout(() => viewerToolbar.classList.add('hidden'), 2000);
		setToolbarHideTimer(next);
	}

	return {
		setFavoriteButtonState,
		updateFavoriteControlsUI,
		updateSortButtonUI,
		updateNavigationUI,
		resetToolbarTimer
	};
}
