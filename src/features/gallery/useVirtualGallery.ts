import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import { createVirtualGallery } from './virtualGallery';
import { aspectRatios } from './mediaMetrics';

// Adapter around the measured layout engine. Only handle/order changes rebuild
// rows; metadata updates reach the existing React cards without losing scroll.
export function useVirtualGallery(
  container: RefObject<HTMLDivElement | null>,
  items: FileSystemHandle[],
  keys: string[],
) {
  const virtual = useRef<ReturnType<typeof createVirtualGallery> | null>(null);
  const [slots, setSlots] = useState<Array<{ index: number; host: HTMLElement }>>([]);
  const isVirtual = items.length > 200;
  useLayoutEffect(() => {
    if (!isVirtual) return;
    let active = true;
    let initializing = true;
    const mounted = new Map<HTMLElement, number>();
    const publish = () => {
      if (!active) return;
      const next = Array.from(mounted, ([host, index]) => ({ host, index }));
      // During setup React flushes layout-effect updates before paint. Later
      // scroll frames need a synchronous commit after all slot changes.
      if (initializing) setSlots(next);
      else flushSync(() => setSlots(next));
    };
    // The layout engine owns only empty slots. React owns all card contents.
    const engine = createVirtualGallery(
      container.current!,
      items.length,
      (index, row) => {
        const host = document.createElement('div');
        host.className = 'gallery-slot';
        row.append(host);
        mounted.set(host, index);
        return host;
      },
      (host) => {
        mounted.delete(host);
      },
      () => active,
      (index, width) => {
        const handle = items[index];
        const original =
          container.current!.classList.contains('original-aspect') && handle.kind !== 'directory';
        return (
          Math.max(1, width - 2) / (original ? aspectRatios.get(handle) || 4 / 3 : 4 / 3) +
          2 +
          (handle.kind === 'directory' ? 52 : 0)
        );
      },
      publish,
    );
    initializing = false;
    virtual.current = engine;
    return () => {
      active = false;
      engine.dispose();
      virtual.current = null;
    };
  }, [items, keys, isVirtual, container]);

  return { virtual, slots, isVirtual };
}
