import { useShallow } from 'zustand/react/shallow';
import { useAppActions, useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
export function ListToolbar() {
  const actions = useAppActions();
  const s = useAppState(
    useShallow((state) => ({
      size: state.thumbnailSizeIndex,
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
            <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
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
                ×
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
            <option value="directory">種別: ディレクトリ</option>
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
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
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
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
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
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d={
            order === 'asc'
              ? 'M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z'
              : 'M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 011.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'
          }
          clipRule="evenodd"
        />
      </svg>
      名前: {order === 'asc' ? '昇順' : '降順'}
    </button>
  );
}
