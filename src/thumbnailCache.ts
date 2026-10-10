import { getMediaSource } from './nativeFs';

const MAX_EDGE = 1280;
const MAX_ENTRIES = 1000;
type Source = { url: string; objectUrl: boolean };
type Entry = { promise: Promise<Blob | null>; consumers: Set<() => boolean> };

// APNGではacTLチャンクが最初のIDATより前にある。圧縮データは読み込まない。
export async function isAnimatedPng(blob: Blob): Promise<boolean> {
  let offset = 8;
  while (offset + 8 <= blob.size) {
    const header = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const kind = String.fromCharCode(...header.slice(4, 8));
    if (kind === 'acTL') return true;
    if (kind === 'IDAT' || kind === 'IEND') return false;
    offset += new DataView(header.buffer).getUint32(0) + 12;
  }
  return false;
}

async function generate(handle: FileSystemFileHandle): Promise<Blob | null> {
  let source: Source | null = null;
  const image = new Image();
  let canvas: HTMLCanvasElement | null = null;
  try {
    let blob: Blob;
    if (handle.nativePath && window.desktopApi) {
      source = await getMediaSource(handle);
      const response = await fetch(source.url);
      if (!response.ok) throw new Error('元画像の読み込みに失敗しました。');
      blob = await response.blob();
    } else {
      blob = await handle.getFile();
    }
    if (handle.name.toLowerCase().endsWith('.png') && await isAnimatedPng(blob)) return null;
    source = { url: URL.createObjectURL(blob), objectUrl: true };
    image.decoding = 'async';
    image.src = source.url;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('サムネイルを生成できませんでした。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas!.toBlob(
      result => result ? resolve(result) : reject(new Error('サムネイルの圧縮に失敗しました。')),
      'image/webp', 0.85
    ));
  } finally {
    image.removeAttribute('src');
    if (source?.objectUrl) URL.revokeObjectURL(source.url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

async function validateStored(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return true;
  } catch { return false; }
  finally { image.removeAttribute('src'); URL.revokeObjectURL(url); }
}

export function createThumbnailCache() {
  let entries = new Map<string | FileSystemFileHandle, Entry>();
  let active = 0;
  const waiting: Array<() => void> = [];

  async function enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  async function get(handle: FileSystemFileHandle, shouldContinue: () => boolean = () => true): Promise<Source | null> {
    // GIF・WebPは動画のように原画像を表示し、アニメーションを保つ。
    if (/\.(gif|webp)$/i.test(handle.name)) return shouldContinue() ? getMediaSource(handle) : null;
    const key = handle.nativePath || handle;
    let entry = entries.get(key);
    if (!entry) {
      const cache = entries;
      const consumers = new Set([shouldContinue]);
      entry = { consumers, promise: Promise.resolve(null) };
      cache.set(key, entry);
      const current = entry;
      entry.promise = enqueue(async () => {
        if (cache !== entries || ![...consumers].some(consumer => consumer())) return null;
        let stored: Awaited<ReturnType<NonNullable<Window['desktopApi']>['readThumbnail']>> | null = null;
        if (handle.nativePath && window.desktopApi) {
          try { stored = await window.desktopApi.readThumbnail(handle.nativePath); } catch { /* 保存領域が使えない場合も表示する */ }
          if (stored?.bytes) {
            const bytes = new Uint8Array(stored.bytes);
            const blob = new Blob([bytes.buffer], { type: 'image/webp' });
            if (await validateStored(blob)) return blob;
          }
        }
        const blob = await generate(handle);
        if (blob && stored && handle.nativePath && window.desktopApi) {
          try { await window.desktopApi.writeThumbnail(handle.nativePath, stored.version, new Uint8Array(await blob.arrayBuffer())); }
          catch { /* ディスク保存に失敗した場合もメモリに保持する */ }
        }
        return blob;
      }).catch(() => null).then(blob => {
        consumers.clear();
        if (!blob && cache.get(key) === current) cache.delete(key);
        return blob;
      });
      // 圧縮したBlobだけを保持する。URLは表示側が所有して解放する。
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    } else {
      entry.consumers.add(shouldContinue);
      entries.delete(key);
      entries.set(key, entry);
    }
    const blob = await entry.promise;
    entry.consumers.delete(shouldContinue);
    if (!shouldContinue()) return null;
    return blob ? { url: URL.createObjectURL(blob), objectUrl: true } : getMediaSource(handle);
  }

  function clear() { entries = new Map(); }
  return { get, clear };
}

export const thumbnailCache = createThumbnailCache();
