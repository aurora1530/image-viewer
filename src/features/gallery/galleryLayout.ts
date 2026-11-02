import type { EntryHandle } from '../../shared/fileSystem';
import type { GalleryEntry } from '../../app/store';

// Each Gallery owns its projection cache. Unrelated store updates reuse it
// without reading entries; metadata changes preserve the mounted virtual rows.
export function createGalleryLayoutSelector() {
  let previousEntries: GalleryEntry[] | undefined;
  let layout: { items: EntryHandle[]; keys: string[] } = { items: [], keys: [] };

  return ({ entries }: { entries: GalleryEntry[] }) => {
    if (entries === previousEntries) return layout;
    previousEntries = entries;
    if (
      entries.length === layout.items.length &&
      entries.every(
        (entry, index) =>
          entry.item.handle === layout.items[index] && entry.key === layout.keys[index],
      )
    )
      return layout;

    layout = {
      items: entries.map((entry) => entry.item.handle),
      keys: entries.map((entry) => entry.key),
    };
    return layout;
  };
}
