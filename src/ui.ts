import { DOM, state } from './state';

type SizeOption = {
	name: string;
	classes: string;
	originalAspect: boolean;
};

export type StatusType = 'info' | 'error' | 'loading' | 'clear';

const sizeOptions: SizeOption[] = [
	{ name: '小', classes: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-2', originalAspect: false },
	{ name: '中', classes: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2 md:gap-3', originalAspect: false },
	{ name: '大', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4', originalAspect: false },
	{ name: '元サイズ 小', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4', originalAspect: true },
	{ name: '元サイズ 中', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4', originalAspect: true },
	{ name: '元サイズ 大', classes: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-3 md:gap-4', originalAspect: true },
];

export function populateSizeSelect(): void {
	DOM.sizeSelect.innerHTML = '';
	sizeOptions.forEach((opt, idx) => {
		const option = document.createElement('option');
		option.value = String(idx);
		option.textContent = opt.name;
		DOM.sizeSelect.appendChild(option);
	});
}

export function updateThumbnailSize(): void {
	const size = sizeOptions[state.thumbnailSizeIndex];
	DOM.itemList.className = 'grid contact-sheet ' + size.classes;
	DOM.itemList.classList.toggle('original-aspect', size.originalAspect);
	DOM.sizeSelect.value = String(state.thumbnailSizeIndex);
}

export function updateUiVisibilityUI(): void {
	document.body.classList.toggle('ui-hidden-mode', state.isUiHidden);
	document.body.classList.toggle('ui-dock-revealed', state.isUiHidden && state.isUiDockRevealed);
	DOM.uiVisibilityBtn.textContent = state.isUiHidden ? 'UI表示' : 'UI非表示';
	DOM.uiVisibilityBtn.setAttribute('aria-pressed', state.isUiHidden ? 'true' : 'false');
}

export function updateViewModeUI(): void {
	if (state.isSinglePageView) {
		DOM.toggleViewBtn.textContent = '見開きに戻す';
		DOM.adjustSpreadBtn.style.display = 'none';
	} else {
		DOM.toggleViewBtn.textContent = '単一表示にする';
		DOM.adjustSpreadBtn.style.display = 'inline-block';
	}
}

export function showStatus(message: string, type: StatusType): void {
	DOM.statusArea.innerHTML = message;
	DOM.statusArea.className = 'text-center my-8 p-4 rounded-lg ';
	switch (type) {
		case 'info':
			DOM.statusArea.classList.add('bg-blue-900', 'text-blue-200');
			break;
		case 'error':
			DOM.statusArea.classList.add('bg-red-900', 'text-red-200');
			break;
		case 'loading':
			DOM.statusArea.classList.add('text-gray-300');
			break;
		case 'clear':
			DOM.statusArea.innerHTML = '';
			DOM.statusArea.className = '';
			break;
	}
}

export function toggleFullscreen(): void {
	if (!document.fullscreenElement) {
		document.documentElement.requestFullscreen().catch(err => console.error(err));
	} else {
		document.exitFullscreen();
	}
}
