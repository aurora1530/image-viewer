import { useLayoutEffect } from 'react';

export function useViewerLayout(opened: boolean) {
  useLayoutEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.classList.toggle('viewer-open', opened);
    if (opened) document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('viewer-open');
      document.body.style.overflow = previousOverflow;
      if (opened && document.fullscreenElement) void document.exitFullscreen().catch(console.error);
    };
  }, [opened]);
}
