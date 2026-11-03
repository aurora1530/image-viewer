import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
import { selectThumbnailSize } from '../../shared/thumbnail';
import type { ThumbnailSize } from '../../shared/thumbnail';

export function useThumbnailSize(card: RefObject<HTMLDivElement | null>) {
  const originalAspect = useAppState(
    (state) => sizeOptions[state.thumbnailSizeIndex].originalAspect,
  );
  const [size, setSize] = useState<ThumbnailSize | null>(() =>
    typeof ResizeObserver === 'undefined' ? 1280 : null,
  );
  useEffect(() => {
    const element = card.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let active = true;
    const measure = () => {
      if (active)
        setSize(
          selectThumbnailSize(
            element.getBoundingClientRect().width,
            window.devicePixelRatio,
            originalAspect,
          ),
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Window resize also covers moving between monitors with different scaling.
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [card, originalAspect]);
  return size;
}
