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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="5.5" cy="3.5" r="1.1" />
            <circle cx="10.5" cy="3.5" r="1.1" />
            <circle cx="5.5" cy="8" r="1.1" />
            <circle cx="10.5" cy="8" r="1.1" />
            <circle cx="5.5" cy="12.5" r="1.1" />
            <circle cx="10.5" cy="12.5" r="1.1" />
          </svg>
        </button>
      )}
      <div className="library-folder-icon" aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.8a1.5 1.5 0 0 1 1.1.48l1.2 1.32a1.5 1.5 0 0 0 1.1.45H16A1.5 1.5 0 0 1 17.5 7.75v6.75A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
        </svg>
      </div>
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
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill={item.favorite ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m10 2.75 2.18 4.42 4.88.71-3.53 3.44.83 4.86L10 13.88l-4.36 2.3.83-4.86-3.53-3.44 4.88-.71L10 2.75Z" />
          </svg>
        </button>
        <button
          className="icon-btn remove-root-btn"
          title="履歴から削除"
          onClick={(event) => {
            event.stopPropagation();
            void actions.removeLibrary(item);
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
