import { encodeThumbnail } from './thumbnailEncoder';
import { encodeAnimatedGifThumbnail } from './animatedGifThumbnail';
import type { ThumbnailSize } from '../shared/thumbnail';

type Input = { blob: Blob; format: string; maxEdge: ThumbnailSize } | { paused: boolean };
let paused = false;
let resume: (() => void) | undefined;

async function waitForResume() {
  while (paused) {
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
  }
}

async function generateThumbnail(event: MessageEvent<Input>) {
  if ('paused' in event.data) {
    paused = event.data.paused;
    if (!paused) {
      resume?.();
      resume = undefined;
    }
    return;
  }
  try {
    const { blob: source, format, maxEdge } = event.data;
    const blob =
      format === 'gif-animation'
        ? await encodeAnimatedGifThumbnail(source, maxEdge, waitForResume)
        : await encodeThumbnail(source, format, maxEdge);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener('message', (event: MessageEvent<Input>) => {
  void generateThumbnail(event);
});
