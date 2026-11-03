import { useState } from 'react';
import { useAppActions, useAppState } from '../../app/ApplicationProvider';
import { LibraryCard } from './LibraryCard';
export function Home() {
  const actions = useAppActions();
  const home = useAppState((state) => state.screen === 'home');
  const library = useAppState((state) => state.library);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const favorites = library
    .filter((item) => item.favorite)
    .sort((a, b) => (a.favoriteOrder ?? Infinity) - (b.favoriteOrder ?? Infinity));
  async function move(source: string, target: string) {
    if (saving || source === target) return;
    setSaving(true);
    try {
      await actions.moveLibraryFavorite(source, target);
    } finally {
      setSaving(false);
    }
  }
  function endDrag() {
    setDraggedPath(null);
    setDropPath(null);
  }
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
          {favorites.map((item, index) => (
            <div
              key={item.path}
              className={`favorite-root-slot${dropPath === item.path ? ' is-drop-target' : ''}${draggedPath === item.path ? ' is-dragging' : ''}`}
              onDragOver={(event) => {
                if (!draggedPath || saving) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropPath(item.path);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget instanceof Node ? event.relatedTarget : null,
                  )
                )
                  setDropPath(null);
              }}
              onDrop={(event) => {
                if (!draggedPath || saving) return;
                event.preventDefault();
                void move(draggedPath, item.path);
                endDrag();
              }}
            >
              <LibraryCard
                item={item}
                reorder={{
                  disabled: saving || favorites.length < 2,
                  onDragStart: () => setDraggedPath(item.path),
                  onDragEnd: endDrag,
                  onMove: (direction) => {
                    const target = favorites[index + direction];
                    if (target) void move(item.path, target.path);
                  },
                }}
              />
            </div>
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
