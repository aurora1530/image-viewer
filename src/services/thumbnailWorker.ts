import { encodeThumbnail } from './thumbnailEncoder';
import type { ThumbnailSize } from '../shared/thumbnail';

type Input = { blob: Blob; format: string; maxEdge: ThumbnailSize };

async function generateThumbnail(event: MessageEvent<Input>) {
  try {
    const blob = await encodeThumbnail(event.data.blob, event.data.format, event.data.maxEdge);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener('message', (event: MessageEvent<Input>) => {
  void generateThumbnail(event);
});
