import { encodeThumbnail } from './thumbnailEncoder';

async function generateThumbnail(event: MessageEvent<{ blob: Blob; format: string }>) {
  try {
    const blob = await encodeThumbnail(event.data.blob, event.data.format);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener('message', (event: MessageEvent<{ blob: Blob; format: string }>) => {
  void generateThumbnail(event);
});
