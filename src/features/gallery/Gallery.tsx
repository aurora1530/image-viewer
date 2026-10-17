import { useImperativeHandle, useRef } from 'react';
import type { CSSProperties, Ref } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
import type { GalleryNavigation } from '../../app/ports';
import { GalleryCard } from './GalleryCard';
import { useVirtualGallery } from './useVirtualGallery';

export function Gallery({ ref }: { ref?: Ref<GalleryNavigation> }) {
  const entries = useAppState((state) => state.entries);
  const sizeIndex = useAppState((state) => state.thumbnailSizeIndex);
  const home = useAppState((state) => state.screen === 'home');
  const size = sizeOptions[sizeIndex];
  const container = useRef<HTMLDivElement>(null);
  const items = useAppState(useShallow((state) => state.entries.map((entry) => entry.item.handle)));
  const keys = useAppState(useShallow((state) => state.entries.map((entry) => entry.key)));
  const { virtual, slots, isVirtual } = useVirtualGallery(container, items, keys);

  useImperativeHandle(
    ref,
    () => ({
      revealDirectory(name) {
        const index = entries.findIndex(
          (entry) => entry.item.type === 'directory' && entry.item.name === name,
        );
        if (index < 0) return false;
        const target = virtual.current
          ? virtual.current.scrollToItem(index)?.querySelector<HTMLElement>('.directory-card')
          : Array.from(
              container.current?.querySelectorAll<HTMLElement>('.directory-card') ?? [],
            ).find((card) => card.dataset.dirName === name);
        target?.scrollIntoView({ block: 'center' });
        return !!target;
      },
    }),
    [entries, virtual],
  );

  return (
    <div
      id="item-list"
      ref={container}
      className={`grid contact-sheet${size.originalAspect ? ' original-aspect' : ''}${home ? ' hidden' : ''}`}
      style={
        {
          '--thumbnail-min-width': `${size.minWidth}px`,
          '--thumbnail-gap': `${size.gap}px`,
        } as CSSProperties
      }
    >
      {isVirtual
        ? slots
            .filter((slot) => slot.host.isConnected && entries[slot.index])
            .map((slot) =>
              createPortal(
                <GalleryCard entry={entries[slot.index]} />,
                slot.host,
                entries[slot.index].key,
              ),
            )
        : entries.map((entry) => <GalleryCard key={entry.key} entry={entry} />)}
    </div>
  );
}
