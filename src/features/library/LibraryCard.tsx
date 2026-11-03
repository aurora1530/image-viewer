import { useAppActions } from '../../app/ApplicationProvider';
type Reorder = {
  disabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (direction: -1 | 1) => void;
};
export function LibraryCard({ item, reorder }: { item: DesktopLibraryItem; reorder?: Reorder }) {
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
      {reorder && (
        <button
          type="button"
          className="icon-btn favorite-drag-handle"
          aria-label={`${item.name}の順番を変更`}
          title="ドラッグで並び替え（矢印キーでも移動できます）"
          disabled={reorder.disabled}
          draggable={!reorder.disabled}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.path);
            reorder.onDragStart();
          }}
          onDragEnd={reorder.onDragEnd}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              reorder.onMove(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
            }
          }}
        >
          ⠿
        </button>
      )}
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
