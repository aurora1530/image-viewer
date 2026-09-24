import { describe, expect, it } from 'vitest';
import {
  buildEntryKey, isImageFileName, joinRelativePath, normalizeConfigEntry,
  normalizeDirPathSegments, sortByFavorite
} from '../../src/utils';

describe('legacy config keys and paths', () => {
  it('accepts supported extensions without depending on filename case', () => {
    expect(isImageFileName('Cover.HEIC', ['.heic'])).toBe(true);
    expect(isImageFileName('cover.heic.bak', ['.heic'])).toBe(false);
  });

  it('normalizes legacy file entries and typed directory entries', () => {
    expect(normalizeConfigEntry('chapter/cover.png')).toBe('file:chapter/cover.png');
    expect(normalizeConfigEntry({ type: 'directory', path: 'chapter' })).toBe('directory:chapter');
    expect(normalizeConfigEntry({ type: 'file', path: '' })).toBeNull();
    expect(buildEntryKey('file', 'a:b.png')).toBe('file:a:b.png');
  });

  it('preserves meaningful relative path segments', () => {
    expect(normalizeDirPathSegments('/a//b/')).toEqual(['a', 'b']);
    expect(normalizeDirPathSegments(['a', '', 'b'])).toEqual(['a', 'b']);
    expect(joinRelativePath('a', 'b.png')).toBe('a/b.png');
    expect(joinRelativePath('', 'b.png')).toBe('b.png');
  });

  it('puts favorites first while keeping each group in its original order', () => {
    const items = [
      { name: 'a', isFavorite: false }, { name: 'b', isFavorite: true },
      { name: 'c', isFavorite: false }, { name: 'd', isFavorite: true }
    ];
    expect(sortByFavorite(items).map(item => item.name)).toEqual(['b', 'd', 'a', 'c']);
    expect(items.map(item => item.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});
