import { useAppActions, useAppState } from '../../app/ApplicationProvider';
import { LibraryCard } from './LibraryCard';
export function Home() {
  const actions = useAppActions();
  const home = useAppState((state) => state.screen === 'home');
  const library = useAppState((state) => state.library);
  const favorites = library.filter((item) => item.favorite);
  return (
    <div id="home-view" className={`home-view${home ? '' : ' hidden'}`}>
      <div className="home-intro">
        <div>
          <span className="chip-label">ライブラリ</span>
          <h2>フォルダーをすぐに開く</h2>
          <p>
            最近使ったフォルダーはこの端末に保存されます。よく使う場所は ★ で上部に固定できます。
          </p>
        </div>
        <button
          id="home-select-dir-btn"
          className="ui-btn primary"
          onClick={() => {
            void actions.selectRootDirectory();
          }}
        >
          新しいフォルダーを開く
        </button>
      </div>
      <div
        id="favorite-roots-section"
        className={`library-section${favorites.length ? '' : ' hidden'}`}
      >
        <div className="library-heading">
          <h3>お気に入り</h3>
          <span id="favorite-roots-count">{favorites.length}</span>
        </div>
        <div id="favorite-roots" className="library-grid">
          {favorites.map((item) => (
            <LibraryCard key={item.path} item={item} />
          ))}
        </div>
      </div>
      <div
        id="recent-roots-section"
        className={`library-section${library.length ? '' : ' hidden'}`}
      >
        <div className="library-heading">
          <h3>最近使ったフォルダー</h3>
          <span id="recent-roots-count">{library.length}</span>
        </div>
        <div id="recent-roots" className="library-grid">
          {library.map((item) => (
            <LibraryCard key={item.path} item={item} />
          ))}
        </div>
      </div>
      <div id="empty-library" className={`empty-library${library.length ? ' hidden' : ''}`}>
        <div className="empty-icon">▧</div>
        <h3>まだフォルダーがありません</h3>
        <p>画像を保存しているフォルダーを選ぶと、次回からここから開けます。</p>
      </div>
    </div>
  );
}
