import { DOM, state } from './state';

type SizeOption = {
	name: string;
	minWidth: number;
	gap: number;
	originalAspect: boolean;
};

export type StatusType = 'info' | 'error' | 'loading' | 'clear';

const sizeOptions: SizeOption[] = [
	{ name: '小', minWidth: 120, gap: 8, originalAspect: false },
	{ name: '中', minWidth: 170, gap: 10, originalAspect: false },
	{ name: '大', minWidth: 230, gap: 14, originalAspect: false },
	{ name: '元サイズ 小', minWidth: 280, gap: 14, originalAspect: true },
	{ name: '元サイズ 中', minWidth: 390, gap: 16, originalAspect: true },
	{ name: '元サイズ 大', minWidth: 520, gap: 16, originalAspect: true },
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
	const safeIndex = Number.isInteger(state.thumbnailSizeIndex)
		? Math.min(Math.max(state.thumbnailSizeIndex, 0), sizeOptions.length - 1)
		: 1;
	state.thumbnailSizeIndex = safeIndex;
	const size = sizeOptions[safeIndex];
	DOM.itemList.className = 'grid contact-sheet';
	DOM.itemList.style.setProperty('--thumbnail-min-width', `${size.minWidth}px`);
	DOM.itemList.style.setProperty('--thumbnail-gap', `${size.gap}px`);
	DOM.itemList.classList.toggle('original-aspect', size.originalAspect);
	DOM.sizeSelect.value = String(safeIndex);
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
