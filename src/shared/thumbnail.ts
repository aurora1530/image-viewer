export type ThumbnailSize = 640 | 1280;
export const thumbnailSizes: readonly ThumbnailSize[] = [640, 1280];

export function selectThumbnailSize(
  width: number,
  pixelRatio: number,
  originalAspect: boolean,
): ThumbnailSize {
  // Unknown aspect ratios can need a long edge much larger than the card width.
  // Preserve the existing resolution in the original-aspect display modes.
  return !originalAspect && width > 0 && width * Math.max(1, pixelRatio) <= 640 ? 640 : 1280;
}
