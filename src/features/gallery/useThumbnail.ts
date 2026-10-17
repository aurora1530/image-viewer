import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { DirectoryCacheItem } from '../../shared/model';
import { useApplication } from '../../app/ApplicationProvider';
import type { MediaSource } from '../../app/ports';
import { aspectRatios } from './mediaMetrics';
import { observeThumbnail } from './observeThumbnail';

export function useThumbnail(
  item: DirectoryCacheItem,
  card: RefObject<HTMLDivElement | null>,
  video: RefObject<HTMLVideoElement | null>,
) {
  const { media } = useApplication();
  const [retryState, setRetryState] = useState<{
    handle: FileSystemHandle;
    attempt: number;
  } | null>(null);
  const attempt = retryState?.handle === item.handle ? retryState.attempt : 0;
  const [loaded, setLoaded] = useState<{
    handle: FileSystemHandle;
    attempt: number;
    source: MediaSource | null;
    failed: boolean;
  } | null>(null);
  const [decoded, setDecoded] = useState<MediaSource | null>(null);
  // A result belongs to one handle and request. A changed handle/retry renders
  // pending immediately, without an Effect that copies props into local state.
  const current = loaded?.handle === item.handle && loaded.attempt === attempt ? loaded : null;
  const source = current?.source ?? null;
  const ready = !!source && decoded === source;
  const failed = attempt > 2 || !!current?.failed;
  useEffect(() => {
    if (attempt > 2) return;
    let active = true;
    let owned: MediaSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const element = card.current!;
    const shouldContinue = () => active && element.isConnected;
    const getPriority = () => {
      const rect = element.getBoundingClientRect();
      return rect.bottom <= 0
        ? -rect.bottom + 1
        : rect.top >= window.innerHeight
          ? rect.top - window.innerHeight + 1
          : 0;
    };
    const stopObserving = observeThumbnail(element, () => {
      const load = async () => {
        try {
          let result: MediaSource | null;
          if (item.type === 'image' || item.type === 'pdf')
            result = await media.getThumbnail(item.handle, shouldContinue, getPriority);
          else if (item.type === 'video') result = await media.getMediaSource(item.handle);
          else {
            result = await media.getDirectoryPreview(item.handle, {
              shouldContinue,
              getPriority,
            });
          }
          if (!shouldContinue()) {
            if (result?.objectUrl) URL.revokeObjectURL(result.url);
            return;
          }
          owned = result;
          setLoaded({
            handle: item.handle,
            attempt,
            source: result,
            failed: !result,
          });
        } catch (error) {
          if (!active) return;
          console.error(`サムネイル生成失敗: ${item.name}`, error);
          setLoaded({ handle: item.handle, attempt, source: null, failed: true });
        }
      };
      // Failed decodes get a short delay before the next cache request.
      if (attempt)
        retry = setTimeout(() => {
          void load();
        }, 300 * attempt);
      else void load();
    });
    const videoElement = video.current;
    return () => {
      active = false;
      stopObserving();
      clearTimeout(retry);
      if (videoElement) {
        videoElement.pause();
        videoElement.removeAttribute('src');
        videoElement.load();
      }
      if (owned?.objectUrl) URL.revokeObjectURL(owned.url);
    };
  }, [item.handle, item.type, item.name, attempt, card, video, media]);

  function markReady(width: number, height: number) {
    if (height) aspectRatios.set(item.handle, width / height);
    setDecoded(source);
  }
  function retry() {
    if (!card.current?.isConnected || (item.type !== 'image' && item.type !== 'pdf')) return;
    media.invalidateThumbnail(item.handle);
    setRetryState({ handle: item.handle, attempt: attempt + 1 });
  }
  return { source, ready, failed, attempt, markReady, retry };
}
