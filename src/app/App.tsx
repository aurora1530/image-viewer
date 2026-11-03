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
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.8a1.5 1.5 0 0 1 1.1.48l1.2 1.32a1.5 1.5 0 0 0 1.1.45H16A1.5 1.5 0 0 1 17.5 7.75v6.75A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
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
