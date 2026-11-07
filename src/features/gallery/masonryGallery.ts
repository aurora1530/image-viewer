import type { createVirtualGallery } from './virtualGallery';

// React owns card contents; this engine measures and positions their empty hosts.
export function createMasonryGallery(
  ...[
    container,
    count,
    createCard,
    disposeCard,
    isCurrent,
    estimate = (_index, width) => width * 0.75,
    commit = () => {},
  ]: Parameters<typeof createVirtualGallery>
) {
  const canvas = document.createElement('div');
  canvas.className = 'masonry-canvas';
  container.append(canvas);
  container.dataset.virtual = 'true';
  const mounted = new Map<number, HTMLElement>();
  const measured = new Map<number, number>();
  let positions: Array<{ top: number; left: number; height: number }> = [];
  let lanes: number[][] = [];
  let cardWidth = 0;
  let layoutKey = '';
  let dirty = true;
  let disposed = false;
  let frame = 0;
  let origin = 0;

  function remove(index: number, card: HTMLElement) {
    observer?.unobserve(card);
    disposeCard(card);
    card.remove();
    mounted.delete(index);
  }

  function render(target?: number) {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    if (!isCurrent()) return dispose();
    if (document.body.classList.contains('viewer-open')) return;
    const style = getComputedStyle(container);
    const width = Math.max(
      1,
      container.clientWidth -
        parseFloat(style.paddingLeft || '0') -
        parseFloat(style.paddingRight || '0'),
    );
    origin = canvas.getBoundingClientRect().top + window.scrollY;
    // Keep the regular layout's column count so removing gaps cannot shrink cards.
    const gap = parseFloat(style.columnGap) || 0;
    const minimum = parseFloat(style.getPropertyValue('--thumbnail-min-width')) || 170;
    const columns = Math.max(1, Math.floor((width + gap) / (minimum + gap)));
    const key = `${width}:${columns}`;
    if (key !== layoutKey) {
      measured.clear();
      cardWidth = width / columns;
      layoutKey = key;
      dirty = true;
    }
    if (dirty) {
      const anchor = positions.findIndex(
        (position) => position.top + position.height > window.scrollY - origin,
      );
      const previousTop = positions[anchor]?.top;
      const heights = Array<number>(columns).fill(0);
      lanes = Array.from({ length: columns }, () => []);
      positions = Array.from({ length: count }, (_, index) => {
        let lane = 0;
        for (let next = 1; next < columns; next++) if (heights[next] < heights[lane]) lane = next;
        const height = measured.get(index) ?? estimate(index, cardWidth);
        const position = { top: heights[lane], left: lane * cardWidth, height };
        heights[lane] += height;
        lanes[lane].push(index);
        return position;
      });
      canvas.style.height = `${Math.max(0, ...heights)}px`;
      dirty = false;
      if (target === undefined && previousTop !== undefined && window.scrollY > origin)
        window.scrollTo(window.scrollX, window.scrollY + positions[anchor].top - previousTop);
    }
    if (target !== undefined) window.scrollTo(window.scrollX, origin + positions[target].top);
    const start = window.scrollY - origin - 800;
    const end = window.scrollY - origin + window.innerHeight + 800;
    const visible = new Set<number>();
    // Each lane is ordered vertically, so scrolling need not scan the complete list.
    for (const lane of lanes) {
      let low = 0;
      let high = lane.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const position = positions[lane[middle]];
        if (position.top + position.height < start) low = middle + 1;
        else high = middle;
      }
      for (let cursor = low; cursor < lane.length; cursor++) {
        const index = lane[cursor];
        if (positions[index].top > end) break;
        visible.add(index);
      }
    }
    let changed = false;
    for (const [index, card] of mounted) {
      if (!visible.has(index)) {
        remove(index, card);
        changed = true;
      }
    }
    for (const index of [...visible].sort((a, b) => a - b)) {
      let card = mounted.get(index);
      if (!card) {
        card = createCard(index, canvas);
        card.dataset.itemIndex = String(index);
        mounted.set(index, card);
        const next = Array.from(canvas.children).find(
          (child) => child instanceof HTMLElement && Number(child.dataset.itemIndex) > index,
        );
        canvas.insertBefore(card, next ?? null);
        observer?.observe(card);
        changed = true;
      }
      card.style.position = 'absolute';
      card.style.width = `${cardWidth}px`;
      card.style.left = `${positions[index].left}px`;
      card.style.top = `${positions[index].top}px`;
    }
    if (changed) commit();
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(() => render());
  }
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target === container) {
              schedule();
              continue;
            }
            if (!(entry.target instanceof HTMLElement)) continue;
            const height = entry.borderBoxSize?.[0]?.blockSize || entry.target.offsetHeight;
            const index = Number(entry.target.dataset.itemIndex);
            if (
              height > 0 &&
              Math.abs((measured.get(index) ?? positions[index]?.height ?? 0) - height) > 0.5
            ) {
              measured.set(index, height);
              dirty = true;
              schedule();
            }
          }
        });
  const mutations = new MutationObserver(schedule);
  mutations.observe(container, { attributes: true, attributeFilter: ['class', 'style'] });
  mutations.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  observer?.observe(container);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    mutations.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    for (const [index, card] of mounted) remove(index, card);
    canvas.remove();
    delete container.dataset.virtual;
  }
  render();
  return {
    dispose,
    scrollToItem(index: number) {
      if (disposed || !isCurrent() || index < 0 || index >= count) return null;
      render(index);
      return mounted.get(index) ?? null;
    },
  };
}
