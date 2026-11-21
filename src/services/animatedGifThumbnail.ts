import type { ThumbnailSize } from '../shared/thumbnail';

const maxThumbnailBytes = 8 * 1024 * 1024;

// WebP RIFF chunks have even-length payloads on disk and store the unpadded length.
function chunkHeader(type: string, size: number) {
  const bytes = new Uint8Array(8);
  bytes.set(new TextEncoder().encode(type));
  new DataView(bytes.buffer).setUint32(4, size, true);
  return bytes;
}

function writeUint24(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function readFrame(bytes: ArrayBuffer) {
  const view = new DataView(bytes);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let alpha = false;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const type = String.fromCharCode(...new Uint8Array(bytes, offset, 4));
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.byteLength) throw new Error('WebPフレームの長さが不正です。');
    if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L')
      chunks.push(new Uint8Array(bytes, offset, end - offset));
    if (type === 'ALPH' || (type === 'VP8L' && size >= 5 && view.getUint8(offset + 12) & 16))
      alpha = true;
    if (type === 'VP8 ' || type === 'VP8L') return { chunks, alpha };
    offset = end;
  }
  throw new Error('WebPフレームがありません。');
}

export async function encodeAnimatedGifThumbnail(
  blob: Blob,
  maxEdge: ThumbnailSize,
  waitForResume: () => Promise<void>,
) {
  if (typeof ImageDecoder === 'undefined') return null;
  const decoder = new ImageDecoder({ data: blob.stream(), type: 'image/gif' });
  let canvas: OffscreenCanvas | undefined;
  try {
    await Promise.all([decoder.tracks.ready, decoder.completed]);
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount < 2) return null;
    const loopCount = track.repetitionCount === Infinity ? 0 : track.repetitionCount + 1;
    if (!Number.isInteger(loopCount) || loopCount < 0 || loopCount > 0xffff) return null;

    await waitForResume();
    const first = (await decoder.decode({ frameIndex: 0 })).image;
    const { displayWidth, displayHeight } = first;
    first.close();
    const scale = maxEdge / Math.max(displayWidth, displayHeight);
    if (scale >= 1) return null;
    const width = Math.max(1, Math.round(displayWidth * scale));
    const height = Math.max(1, Math.round(displayHeight * scale));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.globalCompositeOperation = 'copy';

    const extended = new Uint8Array(10);
    extended[0] = 0x02;
    writeUint24(extended, 4, width - 1);
    writeUint24(extended, 7, height - 1);
    const animation = new Uint8Array(6);
    new DataView(animation.buffer).setUint16(4, loopCount, true);
    const parts: BlobPart[] = [
      chunkHeader('VP8X', 10),
      extended,
      chunkHeader('ANIM', 6),
      animation,
    ];
    let size = 4 + 18 + 14;
    for (let index = 0; index < track.frameCount; index++) {
      await waitForResume();
      const { image } = await decoder.decode({ frameIndex: index });
      const duration = (image.duration ?? 0) / 1000;
      try {
        context.drawImage(image, 0, 0, width, height);
      } finally {
        image.close();
      }
      const frame = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
      if (frame.type !== 'image/webp') return null;
      const { chunks, alpha } = readFrame(await frame.arrayBuffer());
      if (alpha) extended[0] |= 0x10;
      const header = new Uint8Array(16);
      writeUint24(header, 6, width - 1);
      writeUint24(header, 9, height - 1);
      writeUint24(header, 12, duration);
      // Each decoded frame already includes GIF disposal and compositing.
      header[15] = 0x02;
      const length = header.byteLength + chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      size += 8 + length;
      if (size + 8 > maxThumbnailBytes) return null;
      parts.push(chunkHeader('ANMF', length), header, ...chunks);
    }
    return new Blob([chunkHeader('RIFF', size), 'WEBP', ...parts], { type: 'image/webp' });
  } finally {
    decoder.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
