import { describe, expect, it } from 'vitest';
import { selectThumbnailSize } from '../../src/shared/thumbnail';

describe('thumbnail resolution selection', () => {
  it('accounts for display scaling and preserves large and original-aspect cards', () => {
    expect(selectThumbnailSize(230, 2, false)).toBe(640);
    expect(selectThumbnailSize(320, 2, false)).toBe(640);
    expect(selectThumbnailSize(321, 2, false)).toBe(1280);
    expect(selectThumbnailSize(230, 3, false)).toBe(1280);
    expect(selectThumbnailSize(170, 1, true)).toBe(1280);
    expect(selectThumbnailSize(0, 1, false)).toBe(1280);
  });
});
