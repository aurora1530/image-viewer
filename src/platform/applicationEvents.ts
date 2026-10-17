import { createNavigationInput } from './navigationInput';

type EventHandlers = {
  getViewerMode: () => 'closed' | 'image' | 'video';
  navigate: (direction: 'back' | 'forward') => Promise<void>;
  closeViewer: () => void;
  turnPage: (direction: number) => void;
  flush: () => Promise<void>;
  saveFailed: () => void;
  refreshThumbnails: () => void;
};

// The platform owns event registration; the application owns the commands.
export function registerApplicationEvents(handlers: EventHandlers) {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const unsubscribeClose = window.desktopApi?.onBeforeClose(async () => {
    try {
      await handlers.flush();
      return true;
    } catch (error) {
      console.error(error);
      handlers.saveFailed();
      return false;
    }
  });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') void handlers.flush().catch(console.error);
    },
    options,
  );
  window.addEventListener(
    'pagehide',
    () => {
      void handlers.flush().catch(console.error);
    },
    options,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        void handlers.navigate(event.key === 'ArrowLeft' ? 'back' : 'forward');
        return;
      }
      if (handlers.getViewerMode() === 'closed') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        handlers.closeViewer();
        return;
      }
      if (handlers.getViewerMode() === 'video') return;
      if (event.key === 'ArrowLeft') handlers.turnPage(1);
      if (event.key === 'ArrowRight') handlers.turnPage(-1);
    },
    options,
  );
  const input = createNavigationInput((direction) => {
    void handlers.navigate(direction);
  });
  const unsubscribeNavigation = window.desktopApi?.onNavigate((direction) =>
    input(direction, 'command'),
  );
  for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) {
    document.addEventListener(
      type,
      (event) => {
        if (event.button !== 3 && event.button !== 4) return;
        event.preventDefault();
        if (type === 'mouseup') input(event.button === 3 ? 'back' : 'forward', 'mouse');
      },
      { ...options, capture: true },
    );
  }
  window.addEventListener('scroll', handlers.refreshThumbnails, { ...options, passive: true });
  return () => {
    controller.abort();
    unsubscribeClose?.();
    unsubscribeNavigation?.();
  };
}
