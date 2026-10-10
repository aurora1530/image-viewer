// Keep the complete item order in memory, but only mount rows near the viewport.
export function createVirtualGallery(
	container: HTMLElement,
	count: number,
	createCard: (index: number, row: HTMLElement) => HTMLElement,
	disposeCard: (card: HTMLElement) => void,
	isCurrent: () => boolean,
	estimateCardHeight: (index: number, width: number) => number = (_index, width) => width * 0.75 + 2
) {
	container.dataset.virtual = 'true';
	const top = document.createElement('div');
	const bottom = document.createElement('div');
	top.setAttribute('aria-hidden', 'true');
	bottom.setAttribute('aria-hidden', 'true');
	top.style.overflowAnchor = 'none';
	bottom.style.overflowAnchor = 'none';
	container.append(top, bottom);
	const rows = new Map<number, HTMLElement>();
	let heights: number[] = [];
	let offsets: number[] = [];
	let columns = 0;
	let width = 0;
	let gap = 0;
	let origin = 0;
	let layoutKey = '';
	let frame = 0;
	let disposed = false;
	const overscan = 800;

	function updateOffsets() {
		offsets = [0];
		for (const height of heights) offsets.push(offsets[offsets.length - 1] + height + gap);
	}

	function rowAt(position: number) {
		let low = 0;
		let high = heights.length - 1;
		while (low < high) {
			const middle = Math.floor((low + high + 1) / 2);
			if (offsets[middle] <= position) low = middle;
			else high = middle - 1;
		}
		return low;
	}

	function removeRow(index: number, row: HTMLElement) {
		resizeObserver?.unobserve(row);
		for (const card of Array.from(row.children)) disposeCard(card as HTMLElement);
		row.remove();
		rows.delete(index);
	}

	function render() {
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
		if (disposed) return;
		if (!isCurrent()) { dispose(); return; }
		if (document.body.classList.contains('viewer-open')) return;
		const style = getComputedStyle(container);
		const nextWidth = container.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
		const nextGap = parseFloat(style.columnGap) || 0;
		const minimum = parseFloat(style.getPropertyValue('--thumbnail-min-width')) || 170;
		const nextColumns = Math.max(1, Math.floor((nextWidth + nextGap) / (minimum + nextGap)));
		const nextKey = `${nextWidth}:${nextGap}:${nextColumns}:${container.classList.contains('original-aspect')}`;
		const previousOrigin = origin;
		origin = container.getBoundingClientRect().top + window.scrollY + parseFloat(style.paddingTop || '0');
		if (layoutKey !== nextKey) {
			// Preserve the first visible item when the column count or card size changes.
			const anchor = columns ? rowAt(Math.max(0, window.scrollY - previousOrigin)) * columns : 0;
			const wasInList = columns > 0 && window.scrollY > previousOrigin;
			for (const [index, row] of rows) removeRow(index, row);
			width = Math.max(1, nextWidth);
			columns = nextColumns;
			gap = nextGap;
			layoutKey = nextKey;
			const cardWidth = (width - gap * (columns - 1)) / columns;
			heights = Array.from({ length: Math.ceil(count / columns) }, (_, row) => {
				let height = 0;
				for (let index = row * columns; index < Math.min(count, (row + 1) * columns); index++) {
					height = Math.max(height, estimateCardHeight(index, cardWidth));
				}
				return height;
			});
			updateOffsets();
			top.style.height = '0px';
			bottom.style.height = `${Math.max(0, offsets[heights.length] - gap)}px`;
			if (wasInList) window.scrollTo(window.scrollX, origin + offsets[Math.floor(anchor / columns)]);
		}
		const start = rowAt(Math.max(0, window.scrollY - origin - overscan));
		const end = Math.min(heights.length, rowAt(window.scrollY + window.innerHeight - origin + overscan) + 1);
		for (const [index, row] of rows) if (index < start || index >= end) removeRow(index, row);
		for (let index = start; index < end; index++) {
			let row = rows.get(index);
			if (!row) {
				row = document.createElement('div');
				row.className = 'virtual-gallery-row';
				row.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
				row.style.gap = `${gap}px`;
				row.style.marginBottom = `${index === heights.length - 1 ? 0 : gap}px`;
				for (let item = index * columns; item < Math.min(count, (index + 1) * columns); item++) {
					const card = createCard(item, row);
					card.dataset.itemIndex = String(item);
				}
				rows.set(index, row);
				// Insert without detaching retained rows (pending thumbnails depend on isConnected).
				const next = Array.from(rows.entries()).find(([key]) => key > index)?.[1] || bottom;
				container.insertBefore(row, next);
				resizeObserver?.observe(row);
			}
		}
		top.style.height = `${offsets[start]}px`;
		bottom.style.height = `${Math.max(0, offsets[heights.length] - offsets[end] - (end < heights.length ? gap : 0))}px`;
	}

	function schedule() {
		if (!disposed && !frame) frame = requestAnimationFrame(render);
	}

	const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
		if (disposed || !isCurrent()) return;
		let changed = false;
		for (const entry of entries) {
			if (entry.target === container) { schedule(); continue; }
			const index = Array.from(rows.entries()).find(([, row]) => row === entry.target)?.[0];
			if (index === undefined) continue;
			const height = entry.borderBoxSize?.[0]?.blockSize || (entry.target as HTMLElement).offsetHeight;
			if (height > 0 && Math.abs(heights[index] - height) > 0.5) {
				heights[index] = height;
				changed = true;
			}
		}
		if (changed) {
			updateOffsets();
			// Native scroll anchoring preserves the visible card without interrupting wheel momentum.
			// Batch measurements with scroll events instead of replacing rows inside ResizeObserver.
			schedule();
		}
	});
	const mutations = new MutationObserver(schedule);
	mutations.observe(container, { attributes: true, attributeFilter: ['class', 'style'] });
	mutations.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	resizeObserver?.observe(container);
	window.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', schedule);

	function dispose() {
		if (disposed) return;
		disposed = true;
		cancelAnimationFrame(frame);
		resizeObserver?.disconnect();
		mutations.disconnect();
		window.removeEventListener('scroll', schedule);
		window.removeEventListener('resize', schedule);
		for (const [index, row] of rows) removeRow(index, row);
		top.remove();
		bottom.remove();
		delete container.dataset.virtual;
	}

	render();
	return {
		dispose,
		scrollToItem(index: number) {
			if (disposed || !isCurrent() || index < 0 || index >= count) return null;
			window.scrollTo(window.scrollX, origin + offsets[Math.floor(index / columns)]);
			render();
			return container.querySelector<HTMLElement>(`[data-item-index="${index}"]`);
		}
	};
}
