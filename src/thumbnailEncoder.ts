const MAX_EDGE = 1280;

// JPEG's decoder can discard high-frequency detail before allocating a full-size
// RGBA image. PNG does not support this optimization in Chromium.
export async function encodeThumbnail(blob: Blob, format: string): Promise<Blob> {
  let image: ImageBitmap | VideoFrame | null = null;
  let decoder: ImageDecoder | null = null;
  let canvas: OffscreenCanvas | null = null;
  try {
    if (blob.type === 'image/jpeg' && typeof ImageDecoder !== 'undefined') {
      try {
        decoder = new ImageDecoder({
          data: blob.stream(),
          type: 'image/jpeg',
          desiredWidth: MAX_EDGE,
          desiredHeight: MAX_EDGE,
        });
        image = (await decoder.decode({ frameIndex: 0 })).image;
      } catch {
        decoder?.close();
        decoder = null;
        // Retain the established decoding path on browsers/codecs that reject it.
      }
    }
    if (!image) image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    // Display dimensions include EXIF orientation. Decoder size hints may return
    // a larger image, so the final proportional resize is still necessary.
    const width = 'displayWidth' in image ? image.displayWidth : image.width;
    const height = 'displayHeight' in image ? image.displayHeight : image.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    canvas = new OffscreenCanvas(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
    // Keep the default canvas path: forcing CPU readback or adding a WebGL
    // upload/readback did not improve first-generation scrolling in measurements.
    const context = canvas.getContext('2d');
    if (!context) throw new Error('サムネイルを生成できませんでした。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Release our decoded image handle before asynchronous compression begins.
    image.close();
    image = null;
    decoder?.close();
    decoder = null;
    return await canvas.convertToBlob({ type: format, quality: 0.85 });
  } finally {
    image?.close();
    decoder?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
