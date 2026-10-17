import { useAppActions } from '../../app/ApplicationProvider';
export function LibraryCard({ item }: { item: DesktopLibraryItem }) {
  const actions = useAppActions();
  return (
    <div
      className="library-card"
      tabIndex={0}
      role="button"
      onClick={() => {
        void actions.openLibrary(item);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          void actions.openLibrary(item);
        }
      }}
    >
      <div className="library-folder-icon">▰</div>
      <div className="library-copy">
        <div className="library-name">{item.name}</div>
        <div className="library-path">{item.path}</div>
      </div>
      <div className="library-card-actions">
        <button
          className={`icon-btn favorite-root-btn${item.favorite ? ' active' : ''}`}
          title="お気に入り"
          onClick={(event) => {
            event.stopPropagation();
            void actions.toggleLibraryFavorite(item);
          }}
        >
          ★
        </button>
        <button
          className="icon-btn remove-root-btn"
          title="履歴から削除"
          onClick={(event) => {
            event.stopPropagation();
            void actions.removeLibrary(item);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
