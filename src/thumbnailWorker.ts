import { encodeThumbnail } from './thumbnailEncoder';

self.addEventListener('message', async (event: MessageEvent<{ blob: Blob; format: string }>) => {
  try {
    const blob = await encodeThumbnail(event.data.blob, event.data.format);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
