import { useCallback, useEffect, useRef, useState } from 'react';

export function useViewerToolbar() {
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resetToolbar = useCallback(() => {
    clearTimeout(timer.current);
    setToolbarHidden(false);
    if (document.fullscreenElement) timer.current = setTimeout(() => setToolbarHidden(true), 2000);
  }, []);
  useEffect(() => {
    document.addEventListener('fullscreenchange', resetToolbar);
    return () => {
      document.removeEventListener('fullscreenchange', resetToolbar);
      clearTimeout(timer.current);
    };
  }, [resetToolbar]);
  return { toolbarHidden, resetToolbar };
}
