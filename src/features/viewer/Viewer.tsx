import { useViewerLayout } from './useViewerLayout';
import { useViewerToolbar } from './useViewerToolbar';
import { useVideoPlayback } from './useVideoPlayback';
import { useAppActions } from '../../app/ApplicationProvider';
import type { ViewerPresentation } from '../../app/viewerModel';

export function Viewer({
  presentation,
  single,
}: {
  presentation: ViewerPresentation;
  single: boolean;
}) {
  const actions = useAppActions();
  const { toolbarHidden, resetToolbar } = useViewerToolbar();
  useViewerLayout(presentation.mode !== 'closed');
  const video = useVideoPlayback(presentation.video, presentation.playback);
  return (
    <div
      id="viewer"
      style={{ display: presentation.mode === 'closed' ? 'none' : 'flex' }}
      onMouseMove={resetToolbar}
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest('#viewer-toolbar, video')) return;
        if (target instanceof HTMLImageElement) {
          if (!target.naturalWidth || !target.naturalHeight) return;
          // object-fit: contain leaves clickable background inside the image element's box.
          const box = target.getBoundingClientRect();
          const scale = Math.min(
            box.width / target.naturalWidth,
            box.height / target.naturalHeight,
          );
          const width = target.naturalWidth * scale;
          const height = target.naturalHeight * scale;
          const left = box.left + (box.width - width) / 2;
          const top = box.top + (box.height - height) / 2;
          if (
            event.clientX >= left &&
            event.clientX <= left + width &&
            event.clientY >= top &&
            event.clientY <= top + height
          )
            return;
        }
        actions.closeViewer();
      }}
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
