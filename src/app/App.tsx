import { Settings } from '../features/settings/Settings';
import { VersionBadge } from '../features/settings/ReleaseInfo';
import { useApplication, useAppActions, useAppState } from './ApplicationProvider';
import { Home } from '../features/library/Home';
import { FolderControls } from '../features/browsing/FolderControls';
import { ListToolbar } from '../features/browsing/ListToolbar';
import { StatusArea } from '../features/browsing/StatusArea';
import { Gallery } from '../features/gallery/Gallery';
import { ViewerPanel } from '../features/viewer/ViewerPanel';
import { useLayoutClasses } from './useLayoutClasses';
export function App() {
  const { capabilities, setGalleryNavigation } = useApplication();
  const actions = useAppActions();
  const hidden = useAppState((state) => state.isUiHidden);
  const revealed = useAppState((state) => state.isUiDockRevealed);
  useLayoutClasses(hidden, revealed);
  return (
    <>
      <div id="main-content" className="frame">
        <header className="app-header">
          <div className="app-brand">
            <span className="eyebrow">DESKTOP LIBRARY</span>
            <h1>ローカル画像ビューワー</h1>
            <VersionBadge />
            <span
              id="desktop-badge"
              className={`desktop-badge${capabilities.desktop ? '' : ' hidden'}`}
            >
              DESKTOP
            </span>
          </div>
          <div className="header-actions">
            <button
              id="select-dir-btn"
              type="button"
              className="ui-btn primary"
              onClick={() => {
                void actions.selectRootDirectory();
              }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              ルートフォルダを選択
            </button>
            <Settings />
          </div>
        </header>
        <div className="panel">
          <FolderControls />
          <Home />
          <StatusArea />
          <Gallery ref={setGalleryNavigation} />
        </div>
        <ListToolbar />
      </div>
      <ViewerPanel />
    </>
  );
}
