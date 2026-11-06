import { useShallow } from 'zustand/react/shallow';
import { useAppActions, useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
export function ListToolbar() {
  const actions = useAppActions();
  const s = useAppState(
    useShallow((state) => ({
      size: state.thumbnailSizeIndex,
      dense: state.denseGallery,
      filter: state.filterType,
      search: state.searchQuery,
      favoriteOnly: state.favoriteOnly,
      favoriteFirst: state.favoriteFirst,
      mode: state.listMode,
      uiHidden: state.isUiHidden,
      hasFolder: !!state.directories.length,
      viewerOpen: state.viewer.mode !== 'closed',
    })),
  );
  const inFavoritesList = s.mode === 'favorites';
  return (
    <div
      id="list-toolbar"
      className={`dock${s.hasFolder ? '' : ' hidden'}`}
      style={{ display: s.viewerOpen ? 'none' : undefined }}
      onFocus={() => actions.revealDock(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) actions.revealDock(false);
      }}
    >
      <div className="dock-inner">
        <div className="toolbar-group" role="group" aria-label="フィルター">
          <span className="toolbar-group-label">フィルター</span>
          <div className="search-field">
            <svg
              className="search-icon"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8.5" cy="8.5" r="5" />
              <path d="m12.2 12.2 4.3 4.3" />
            </svg>
            <input
              id="search-input"
              type="text"
              placeholder="検索..."
              aria-label="検索"
              className="ui-input search-input"
              value={s.search}
              onChange={(event) => actions.setSearch(event.target.value)}
            />
            {s.search && (
              <button
                type="button"
                className="search-clear-btn"
                aria-label="検索をクリア"
                onClick={() => actions.setSearch('')}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
          <select
            id="filter-select"
            aria-label="種別"
            className="ui-select"
            value={s.filter}
            onChange={(event) => actions.setFilter(event.target.value)}
          >
            <option value="all">種別: すべて</option>
            <option value="directory" disabled={s.mode === 'recursive'}>
              種別: ディレクトリ
            </option>
            <option value="image">種別: 画像</option>
            <option value="gif">種別: GIF</option>
            <option value="video">種別: 動画</option>
            <option value="pdf">種別: PDF</option>
          </select>
          <button
            id="favorite-only-btn"
            type="button"
            className={`ui-btn ghost${s.favoriteOnly ? ' is-active' : ''}`}
            aria-pressed={s.favoriteOnly}
            disabled={inFavoritesList}
            title={inFavoritesList ? 'お気に入り一覧では使用できません' : 'お気に入りのみ絞り込み'}
            onClick={() => actions.toggleFavoriteOnly()}
          >
            <svg
              viewBox="0 0 20 20"
              fill={s.favoriteOnly ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m10 2.75 2.18 4.42 4.88.71-3.53 3.44.83 4.86L10 13.88l-4.36 2.3.83-4.86-3.53-3.44 4.88-.71L10 2.75Z" />
            </svg>
            お気に入りのみ
          </button>
        </div>

        <div className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-group" role="group" aria-label="並び替え">
          <span className="toolbar-group-label">並び替え</span>
          <SortButton />
          <button
            id="favorite-first-btn"
            type="button"
            className={`ui-btn ghost${s.favoriteFirst ? ' is-active' : ''}`}
            aria-pressed={s.favoriteFirst}
            disabled={inFavoritesList}
            title={
              inFavoritesList ? 'お気に入り一覧では使用できません' : 'お気に入りを先頭に並べる'
            }
            onClick={() => actions.toggleFavoriteFirst()}
          >
            <svg
              viewBox="0 0 20 20"
              fill={s.favoriteFirst ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m10 2.75 2.18 4.42 4.88.71-3.53 3.44.83 4.86L10 13.88l-4.36 2.3.83-4.86-3.53-3.44 4.88-.71L10 2.75Z" />
            </svg>
            お気に入り優先
          </button>
        </div>

        <div className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-group" role="group" aria-label="表示">
          <span className="toolbar-group-label">表示</span>
          <select
            id="size-select"
            aria-label="サムネイルサイズ"
            className="ui-select"
            value={s.size}
            onChange={(event) => actions.setThumbnailSize(Number(event.target.value))}
          >
            {sizeOptions.map((size, i) => (
              <option key={size.name} value={i}>
                サイズ: {size.name}
              </option>
            ))}
          </select>
          {sizeOptions[s.size].originalAspect && (
            <button
              id="dense-gallery-btn"
              type="button"
              className={`ui-btn ghost${s.dense ? ' is-active' : ''}`}
              aria-pressed={s.dense}
              title="縦横比を保ち、高さの低い列へ画像を詰めて表示"
              onClick={() => actions.toggleDenseGallery()}
            >
              隙間を詰める
            </button>
          )}
          <button
            id="ui-visibility-btn"
            type="button"
            className={`ui-btn ghost${s.uiHidden ? ' is-active' : ''}`}
            aria-pressed={s.uiHidden}
            onClick={() => actions.toggleUi()}
          >
            {s.uiHidden ? 'UI表示' : 'UI非表示'}
          </button>
        </div>
      </div>
    </div>
  );
}
function SortButton() {
  const actions = useAppActions();
  const order = useAppState((state) => state.sortOrder);
  return (
    <button
      id="toggle-sort-btn"
      type="button"
      className="ui-btn ghost"
      onClick={() => actions.toggleSort()}
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
        <path
          d={
            order === 'asc' ? 'M6 15V5m0 0L3.5 7.5M6 5l2.5 2.5' : 'M6 5v10m0 0-2.5-2.5M6 15l2.5-2.5'
          }
        />
        <path d="M11 6h5.5M11 10h4M11 14h2.5" />
      </svg>
      名前: {order === 'asc' ? '昇順' : '降順'}
    </button>
  );
}
