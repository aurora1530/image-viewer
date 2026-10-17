import { useApplication, useAppState } from './ApplicationProvider';
import { Home } from '../features/library/Home';
import { FolderControls } from '../features/browsing/FolderControls';
import { ListToolbar } from '../features/browsing/ListToolbar';
import { StatusArea } from '../features/browsing/StatusArea';
import { Gallery } from '../features/gallery/Gallery';
import { ViewerPanel } from '../features/viewer/ViewerPanel';
import { useLayoutClasses } from './useLayoutClasses';
export function App() {
  const { capabilities, setGalleryNavigation } = useApplication();
  const hidden = useAppState((state) => state.isUiHidden);
  const revealed = useAppState((state) => state.isUiDockRevealed);
  useLayoutClasses(hidden, revealed);
  return (
    <>
      <div id="main-content" className="frame">
        <header className="app-header">
          <div>
            <span className="eyebrow">DESKTOP LIBRARY</span>
            <h1>ローカル画像ビューワー</h1>
          </div>
          <span
            id="desktop-badge"
            className={`desktop-badge${capabilities.desktop ? '' : ' hidden'}`}
          >
            DESKTOP
          </span>
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
