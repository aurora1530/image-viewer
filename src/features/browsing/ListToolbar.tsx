import { useShallow } from 'zustand/react/shallow';
import { useAppActions, useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
import type { FavoriteMode } from '../../app/store';
export function ListToolbar() {
  const actions = useAppActions();
  const s = useAppState(
    useShallow((state) => ({
      size: state.thumbnailSizeIndex,
      filter: state.filterType,
      search: state.searchQuery,
      favoriteMode: state.favoriteMode,
      mode: state.listMode,
      uiHidden: state.isUiHidden,
      hasFolder: !!state.directories.length,
      viewerOpen: state.viewer.mode !== 'closed',
    })),
  );
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
        <select
          id="size-select"
          className="ui-select"
          value={s.size}
          onChange={(event) => actions.setThumbnailSize(Number(event.target.value))}
        >
          {sizeOptions.map((size, i) => (
            <option key={size.name} value={i}>
              {size.name}
            </option>
          ))}
        </select>
        <select
          id="filter-select"
          className="ui-select"
          value={s.filter}
          onChange={(event) => actions.setFilter(event.target.value)}
        >
          <option value="all">すべて</option>
          <option value="directory">ディレクトリ</option>
          <option value="image">画像</option>
          <option value="gif">GIF</option>
          <option value="video">動画</option>
        </select>
        <select
          id="favorite-mode-select"
          className="ui-select"
          aria-label="お気に入り"
          value={s.favoriteMode}
          disabled={s.mode === 'favorites'}
          title={s.mode === 'favorites' ? 'お気に入り一覧では使用できません' : ''}
          onChange={(event) => actions.setFavoriteMode(event.target.value as FavoriteMode)}
        >
          <option value="off">お気に入り: 無効</option>
          <option value="first">お気に入り: 優先</option>
          <option value="only">お気に入り: のみ</option>
        </select>
        <input
          id="search-input"
          type="text"
          placeholder="検索"
          className="ui-input"
          value={s.search}
          onChange={(event) => actions.setSearch(event.target.value)}
        />
        <SortButton />
        <button
          id="ui-visibility-btn"
          className="ui-btn ghost"
          aria-pressed={s.uiHidden}
          onClick={() => actions.toggleUi()}
        >
          {s.uiHidden ? 'UI表示' : 'UI非表示'}
        </button>
        <button
          id="hidden-mode-btn"
          className="ui-btn ghost"
          aria-pressed={s.mode === 'hidden'}
          onClick={() => {
            void actions.changeListMode('hidden');
          }}
        >
          {s.mode === 'hidden' ? '戻る' : '非表示一覧'}
        </button>
      </div>
    </div>
  );
}
function SortButton() {
  const actions = useAppActions();
  const order = useAppState((state) => state.sortOrder);
  return (
    <button id="toggle-sort-btn" className="ui-btn ghost" onClick={() => actions.toggleSort()}>
      <svg className="h-5 w-5 inline-block -mt-1 mr-2" viewBox="0 0 20 20" fill="currentColor">
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
