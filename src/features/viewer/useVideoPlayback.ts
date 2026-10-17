import { useLayoutEffect, useRef } from 'react';
import { useAppActions } from '../../app/ApplicationProvider';
import type { ViewerPresentation } from '../../app/viewerModel';

export function useVideoPlayback(source: string | null, playback: ViewerPresentation['playback']) {
  const actions = useAppActions();
  const video = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const element = video.current!;
    actions.attachPlaybackReader(() => ({ time: element.currentTime, paused: element.paused }));
    if (source) {
      const restore = () => {
        if (playback) element.currentTime = playback.time;
        if (playback?.paused) element.pause();
        else
          void element
            .play()
            .catch((error) => console.error('動画の再生を開始できませんでした:', error));
      };
      if (playback && element.readyState < 1)
        element.addEventListener('loadedmetadata', restore, { once: true });
      else restore();
      return () => {
        element.removeEventListener('loadedmetadata', restore);
        element.pause();
        actions.attachPlaybackReader(null);
      };
    }
    element.pause();
    element.load();
    return () => {
      actions.attachPlaybackReader(null);
    };
  }, [source, playback, actions]);
  return video;
}
