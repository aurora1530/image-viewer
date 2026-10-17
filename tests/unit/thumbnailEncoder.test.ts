import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeThumbnail } from '../../src/services/thumbnailEncoder';

const bitmapClose = vi.fn();
const frameClose = vi.fn();
const decoderClose = vi.fn();
const draw = vi.fn();
const encode = vi.fn();
const sizes: number[][] = [];
const decode = vi.fn();

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  bitmapClose.mockReset();
  frameClose.mockReset();
  decoderClose.mockReset();
  draw.mockReset();
  decode
    .mockReset()
    .mockResolvedValue({ image: { displayWidth: 1500, displayHeight: 1000, close: frameClose } });
  sizes.length = 0;
  encode.mockReset().mockResolvedValue(new Blob(['thumbnail']));
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 6000, height: 4000, close: bitmapClose })),
  );
  vi.stubGlobal(
    'ImageDecoder',
    class {
      decode = decode;
      close = decoderClose;
    },
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        sizes.push([width, height]);
      }
      getContext() {
        return { drawImage: draw };
      }
      convertToBlob = encode;
    },
  );
});

describe('thumbnail encoding', () => {
  it('decodes JPEG at thumbnail scale and releases pixels before compression', async () => {
    encode.mockImplementation(async () => {
      expect(frameClose).toHaveBeenCalledOnce();
      expect(decoderClose).toHaveBeenCalledOnce();
      return new Blob(['thumbnail'], { type: 'image/jpeg' });
    });
    const result = await encodeThumbnail(
      new Blob(['original'], { type: 'image/jpeg' }),
      'image/jpeg',
    );
    expect(result.type).toBe('image/jpeg');
    expect(decode).toHaveBeenCalledWith({ frameIndex: 0 });
    expect(sizes).toEqual([[1280, 853]]);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('preserves the existing PNG path and does not upscale small images', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 100, height: 200, close: bitmapClose });
    await encodeThumbnail(new Blob(['original'], { type: 'image/png' }), 'image/webp');
    expect(decode).not.toHaveBeenCalled();
    expect(sizes).toEqual([[100, 200]]);
    expect(bitmapClose).toHaveBeenCalledOnce();
    expect(encode).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.85 });
  });

  it('falls back cleanly when reduced JPEG decoding fails or is unavailable', async () => {
    decode.mockRejectedValueOnce(new Error('unsupported'));
    const blob = new Blob(['original'], { type: 'image/jpeg' });
    await encodeThumbnail(blob, 'image/jpeg');
    expect(createImageBitmap).toHaveBeenCalledWith(blob, { imageOrientation: 'from-image' });
    expect(decoderClose).toHaveBeenCalledOnce();
    expect(bitmapClose).toHaveBeenCalledOnce();
    vi.stubGlobal('ImageDecoder', undefined);
    await encodeThumbnail(blob, 'image/jpeg');
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
  });

  it('releases decoder resources when drawing fails', async () => {
    draw.mockImplementationOnce(() => {
      throw new Error('draw failed');
    });
    await expect(
      encodeThumbnail(new Blob(['original'], { type: 'image/jpeg' }), 'image/jpeg'),
    ).rejects.toThrow('draw failed');
    expect(frameClose).toHaveBeenCalledOnce();
    expect(decoderClose).toHaveBeenCalledOnce();
    expect(encode).not.toHaveBeenCalled();
  });
});
