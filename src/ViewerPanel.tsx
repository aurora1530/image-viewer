import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from './appStore';
import type { ViewerPresentation } from './viewer';
import { actions } from './application';

export function Viewer({
  presentation,
  single,
}: {
  presentation: ViewerPresentation;
  single: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resetToolbar = () => {
    clearTimeout(timer.current);
    setToolbarHidden(false);
    if (document.fullscreenElement) timer.current = setTimeout(() => setToolbarHidden(true), 2000);
  };
  useLayoutEffect(() => {
    const opened = presentation.mode !== 'closed';
    document.body.classList.toggle('viewer-open', opened);
    document.body.style.overflow = opened ? 'hidden' : 'auto';
    return () => {
      document.body.classList.remove('viewer-open');
      document.body.style.overflow = 'auto';
    };
  }, [presentation.mode]);
  useEffect(() => {
    const onFullscreen = () => resetToolbar();
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(timer.current);
    };
  }, []);
  useLayoutEffect(() => {
    const element = video.current!;
    actions.attachVideo(element);
    if (presentation.video) {
      const restore = () => {
        if (presentation.playback) element.currentTime = presentation.playback.time;
        if (presentation.playback?.paused) element.pause();
        else
          void element
            .play()
            .catch((error) => console.error('動画の再生を開始できませんでした:', error));
      };
      if (presentation.playback && element.readyState < 1)
        element.addEventListener('loadedmetadata', restore, { once: true });
      else restore();
      return () => {
        element.removeEventListener('loadedmetadata', restore);
        element.pause();
        actions.attachVideo(null);
      };
    }
    element.pause();
    element.load();
    return () => {
      actions.attachVideo(null);
    };
  }, [presentation.video, presentation.playback]);
  return (
    <div
      id="viewer"
      style={{ display: presentation.mode === 'closed' ? 'none' : 'flex' }}
      onMouseMove={resetToolbar}
    >
      <div
        id="viewer-pages"
        className={single ? 'single-view' : ''}
        style={{ display: presentation.mode === 'image' ? 'flex' : 'none' }}
      >
        <div className="page-container">
          <img
            id="left-page"
            src={presentation.left ?? undefined}
            data-url={presentation.left ?? ''}
            alt="Left Page"
            decoding="async"
            style={{ visibility: presentation.left ? 'visible' : 'hidden' }}
          />
        </div>
        <div className="page-container">
          <img
            id="right-page"
            src={presentation.right ?? undefined}
            data-url={presentation.right ?? ''}
            alt="Right Page"
            decoding="async"
            style={{ visibility: presentation.right ? 'visible' : 'hidden' }}
          />
        </div>
      </div>
      <div
        id="viewer-video-container"
        className={`w-full h-full flex items-center justify-center p-4${presentation.mode === 'video' ? '' : ' hidden'}`}
      >
        <video
          ref={video}
          id="viewer-video"
          src={presentation.video ?? undefined}
          className="max-w-full max-h-full"
          controls
          loop
        />
      </div>
      <div
        id="viewer-toolbar"
        className={toolbarHidden ? 'hidden' : ''}
        style={{ display: presentation.mode === 'image' ? 'flex' : 'none' }}
      >
        <button
          id="prev-btn"
          className="ui-btn ghost"
          onClick={() => actions.turnPage(1)}
          aria-label="次のページ"
        >
          <Arrow direction="left" />
        </button>
        <button
          id="toggle-view-btn"
          className="ui-btn ghost w-32"
          onClick={() => actions.toggleSinglePage()}
        >
          {single ? '見開きに戻す' : '単一表示にする'}
        </button>
        <button
          id="adjust-spread-btn"
          className="ui-btn ghost"
          style={{ display: single ? 'none' : 'inline-block' }}
          onClick={() => actions.adjustSpread()}
        >
          見開き調整
        </button>
        <span id="page-counter" className="page-counter">
          {presentation.counter}
        </span>
        <button
          id="next-btn"
          className="ui-btn ghost"
          onClick={() => actions.turnPage(-1)}
          aria-label="前のページ"
        >
          <Arrow direction="right" />
        </button>
        <button
          id="fullscreen-btn"
          className="ui-btn ghost"
          onClick={() => {
            const operation = document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen();
            void operation.catch(console.error);
          }}
        >
          全画面
        </button>
        <button
          id="copy-image-path-btn"
          className="ui-btn ghost"
          onClick={() => {
            void actions.copyPath(true);
          }}
        >
          パスをコピー
        </button>
        <button id="close-viewer-btn" className="ui-btn primary" onClick={actions.closeViewer}>
          閉じる
        </button>
      </div>
      <div className="viewer-loading" role="status" hidden={!presentation.loading}>
        {presentation.loading}
      </div>
    </div>
  );
}
function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d={direction === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
      />
    </svg>
  );
}
export function ViewerPanel() {
  const presentation = useStore(appStore, (state) => state.viewer);
  const single = useStore(appStore, (state) => state.isSinglePageView);
  return <Viewer presentation={presentation} single={single} />;
}
