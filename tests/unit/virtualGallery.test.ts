import { describe, expect, it, vi } from 'vitest';
import { createVirtualGallery } from '../../src/features/gallery/virtualGallery';

function harness(commitCards: (container: HTMLElement) => void = () => {}) {
  const container = document.createElement('div');
  container.id = 'item-list';
  document.body.append(container);
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1024 });
  container.style.setProperty('--thumbnail-min-width', '170px');
  vi.spyOn(window, 'scrollTo').mockImplementation((_x, y) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y || 0 });
  });
  window.scrollTo(0, 0);
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(
    () => ({ top: -window.scrollY }) as DOMRect,
  );
  const disposeCard = vi.fn();
  let current = true;
  const view = createVirtualGallery(
    container,
    10000,
    (index, row) => {
      const card = document.createElement('div');
      card.textContent = String(index);
      row.append(card);
      return card;
    },
    disposeCard,
    () => current,
    undefined,
    () => commitCards(container),
  );
  return {
    container,
    view,
    disposeCard,
    invalidate() {
      current = false;
    },
  };
}

describe('virtual gallery', () => {
  it('bounds mounted cards, reaches the final item and disposes offscreen cards', () => {
    const { container, view, disposeCard } = harness();
    expect(container.querySelectorAll('[data-item-index]').length).toBeLessThan(100);
    const first = container.querySelector('[data-item-index="0"]')!;
    expect(view.scrollToItem(9999)?.textContent).toBe('9999');
    expect(first.isConnected).toBe(false);
    expect(disposeCard).toHaveBeenCalledWith(first);
    expect(container.querySelectorAll('[data-item-index]').length).toBeLessThan(100);
    expect(view.scrollToItem(0)?.textContent).toBe('0');
    view.dispose();
    expect(container.children.length).toBe(0);
    expect(container.dataset.virtual).toBeUndefined();
  });

  it('rejects invalid indexes and stops rendering after invalidation', () => {
    const { container, view, invalidate } = harness();
    expect(view.scrollToItem(-1)).toBeNull();
    expect(view.scrollToItem(10000)).toBeNull();
    invalidate();
    expect(view.scrollToItem(9999)).toBeNull();
    view.dispose();
    window.dispatchEvent(new Event('scroll'));
    expect(container.children.length).toBe(0);
  });

  it('keeps rows in item order while repeatedly scrolling upwards', () => {
    const { container, view } = harness();
    try {
      for (const index of [600, 570, 540, 510, 480]) {
        view.scrollToItem(index);
        const mounted = Array.from(
          container.querySelectorAll<HTMLElement>('[data-item-index]'),
          (card) => Number(card.dataset.itemIndex),
        );
        expect(mounted).toEqual([...mounted].sort((a, b) => a - b));
      }
    } finally {
      view.dispose();
    }
  });

  it('commits deferred cards once per changed viewport after attaching their rows', () => {
    const commit = vi.fn((container: HTMLElement) => {
      expect(container.querySelector('[data-item-index]')?.isConnected).toBe(true);
    });
    const { view } = harness(commit);
    try {
      expect(commit).toHaveBeenCalledTimes(1);
      view.scrollToItem(600);
      expect(commit).toHaveBeenCalledTimes(2);
      view.scrollToItem(600);
      expect(commit).toHaveBeenCalledTimes(2);
      view.scrollToItem(570);
      expect(commit).toHaveBeenCalledTimes(3);
    } finally {
      view.dispose();
    }
  });
});
