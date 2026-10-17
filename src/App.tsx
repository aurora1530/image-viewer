import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { appStore, sizeOptions } from './appStore';
import type { FavoriteMode } from './appStore';
import { actions } from './application';
import { isDesktopApp } from './nativeFs';
import { Gallery } from './Gallery';
import { ViewerPanel } from './ViewerPanel';

function LibraryCard({ item }: { item: DesktopLibraryItem }) {
  return <div className="library-card" tabIndex={0} role="button" onClick={() => { void actions.openLibrary(item); }}
    onKeyDown={event => {
      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault(); void actions.openLibrary(item);
      }
    }}>
    <div className="library-folder-icon">▰</div>
    <div className="library-copy"><div className="library-name">{item.name}</div><div className="library-path">{item.path}</div></div>
    <div className="library-card-actions">
      <button className={`icon-btn favorite-root-btn${item.favorite ? ' active' : ''}`} title="お気に入り" onClick={event => { event.stopPropagation(); void actions.toggleLibraryFavorite(item); }}>★</button>
      <button className="icon-btn remove-root-btn" title="履歴から削除" onClick={event => { event.stopPropagation(); void actions.removeLibrary(item); }}>×</button>
    </div>
  </div>;
}
function Home() {
  const home = useStore(appStore, state => state.screen === 'home');
  const library = useStore(appStore, state => state.library);
  const favorites = library.filter(item => item.favorite);
  return <div id="home-view" className={`home-view${home ? '' : ' hidden'}`}>
    <div className="home-intro"><div><span className="chip-label">ライブラリ</span><h2>フォルダーをすぐに開く</h2><p>最近使ったフォルダーはこの端末に保存されます。よく使う場所は ★ で上部に固定できます。</p></div>
      <button id="home-select-dir-btn" className="ui-btn primary" onClick={() => { void actions.selectRootDirectory(); }}>新しいフォルダーを開く</button></div>
    <div id="favorite-roots-section" className={`library-section${favorites.length ? '' : ' hidden'}`}><div className="library-heading"><h3>お気に入り</h3><span id="favorite-roots-count">{favorites.length}</span></div><div id="favorite-roots" className="library-grid">{favorites.map(item => <LibraryCard key={item.path} item={item} />)}</div></div>
    <div id="recent-roots-section" className={`library-section${library.length ? '' : ' hidden'}`}><div className="library-heading"><h3>最近使ったフォルダー</h3><span id="recent-roots-count">{library.length}</span></div><div id="recent-roots" className="library-grid">{library.map(item => <LibraryCard key={item.path} item={item} />)}</div></div>
    <div id="empty-library" className={`empty-library${library.length ? ' hidden' : ''}`}><div className="empty-icon">▧</div><h3>まだフォルダーがありません</h3><p>画像を保存しているフォルダーを選ぶと、次回からここから開けます。</p></div>
  </div>;
}
export function FolderControls() {
  const { directories, screen, listMode } = useStore(appStore, useShallow(state => ({ directories: state.directories, screen: state.screen, listMode: state.listMode })));
  const hidden = directories.length ? '' : ' hidden';
  return <div className="panel-top">
    <div className="dir-chip"><span className="chip-label">現在のフォルダ</span><span id="current-dir-name" className="chip-value">{screen === 'home' ? 'ホーム' : directories.at(-1)?.name ?? 'フォルダを選択してください'}</span></div>
    <div className="actions">
      <button id="home-btn" className={`ui-btn ghost${isDesktopApp() ? hidden : ' hidden'}`} onClick={() => { void actions.showHome(); }}>ホーム</button>
      <button id="up-dir-btn" className={`ui-btn ghost${directories.length > 1 ? '' : ' hidden'}`} onClick={() => { void actions.navigate('back'); }}>
        <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.707 4.293a1 1 0 010 1.414L7.414 9H14a1 1 0 110 2H7.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z" clipRule="evenodd" /></svg>上の階層へ
      </button>
      <button id="copy-path-btn" className={`ui-btn ghost${hidden}`} onClick={() => { void actions.copyPath(); }}><svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" /></svg>パスをコピー</button>
      <button id="reload-btn" className={`ui-btn ghost${hidden}`} onClick={() => { void actions.reload(); }}>再読み込み</button>
      <button id="recursive-btn" className={`ui-btn outline${hidden}${listMode === 'recursive' ? ' is-active' : ''}`} onClick={() => { void actions.changeListMode('recursive'); }}>{listMode === 'recursive' ? '戻る' : '全画像一覧'}</button>
      <button id="favorite-list-btn" className={`ui-btn outline${hidden}${listMode === 'favorites' ? ' is-active' : ''}`} onClick={() => { void actions.changeListMode('favorites'); }}>{listMode === 'favorites' ? '戻る' : 'お気に入り一覧'}</button>
      <button id="select-dir-btn" className="ui-btn primary" onClick={() => { void actions.selectRootDirectory(); }}>ルートフォルダを選択</button>
    </div>
  </div>;
}
export function ListToolbar() {
  const s = useStore(appStore, useShallow(state => ({
    size: state.thumbnailSizeIndex, filter: state.filterType, search: state.searchQuery,
    favoriteMode: state.favoriteMode, mode: state.listMode, uiHidden: state.isUiHidden, hasFolder: !!state.directories.length, viewerOpen: state.viewer.mode !== 'closed'
  })));
  return <div id="list-toolbar" className={`dock${s.hasFolder ? '' : ' hidden'}`} style={{ display: s.viewerOpen ? 'none' : undefined }}
    onFocus={() => actions.revealDock(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) actions.revealDock(false); }}>
    <div className="dock-inner">
      <select id="size-select" className="ui-select" value={s.size} onChange={event => actions.setThumbnailSize(Number(event.target.value))}>{sizeOptions.map((size, i) => <option key={size.name} value={i}>{size.name}</option>)}</select>
      <select id="filter-select" className="ui-select" value={s.filter} onChange={event => actions.setFilter(event.target.value)}>
        <option value="all">すべて</option><option value="directory">ディレクトリ</option><option value="image">画像</option><option value="gif">GIF</option><option value="video">動画</option>
      </select>
      <select id="favorite-mode-select" className="ui-select" aria-label="お気に入り" value={s.favoriteMode} disabled={s.mode === 'favorites'} title={s.mode === 'favorites' ? 'お気に入り一覧では使用できません' : ''}
        onChange={event => actions.setFavoriteMode(event.target.value as FavoriteMode)}><option value="off">お気に入り: 無効</option><option value="first">お気に入り: 優先</option><option value="only">お気に入り: のみ</option></select>
      <input id="search-input" type="text" placeholder="検索" className="ui-input" value={s.search} onChange={event => actions.setSearch(event.target.value)} />
      <SortButton />
      <button id="ui-visibility-btn" className="ui-btn ghost" aria-pressed={s.uiHidden} onClick={actions.toggleUi}>{s.uiHidden ? 'UI表示' : 'UI非表示'}</button>
      <button id="hidden-mode-btn" className="ui-btn ghost" aria-pressed={s.mode === 'hidden'} onClick={() => { void actions.changeListMode('hidden'); }}>{s.mode === 'hidden' ? '戻る' : '非表示一覧'}</button>
    </div>
  </div>;
}
function SortButton() {
  const order = useStore(appStore, state => state.sortOrder);
  return <button id="toggle-sort-btn" className="ui-btn ghost" onClick={actions.toggleSort}><svg className="h-5 w-5 inline-block -mt-1 mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d={order === 'asc' ? 'M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z' : 'M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 011.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'} clipRule="evenodd" /></svg>名前: {order === 'asc' ? '昇順' : '降順'}</button>;
}
function StatusArea() {
  const status = useStore(appStore, state => state.status);
  const preview = useStore(appStore, state => state.scanPreview);
  const home = useStore(appStore, state => state.screen === 'home');
  const color = status.type === 'error' ? 'bg-red-900 text-red-200' : status.type === 'info' ? 'bg-blue-900 text-blue-200' : 'text-gray-300';
  return <div id="status-area" className={`${status.type === 'clear' ? '' : `text-center my-8 p-4 rounded-lg ${color}`}${home ? ' hidden' : ''}`}>
    {status.type === 'loading' && <div className="loader mx-auto" />}{status.message && <p className="mt-2">{status.message}</p>}
    {preview && <img className="scan-preview" src={preview.url} alt={preview.name} title="画像を開く" onClick={preview.open} />}
  </div>;
}
export function App() {
  const hidden = useStore(appStore, state => state.isUiHidden);
  const revealed = useStore(appStore, state => state.isUiDockRevealed);
  useLayoutClasses(hidden, revealed);
  return <>
    <div id="main-content" className="frame"><header className="app-header"><div><span className="eyebrow">DESKTOP LIBRARY</span><h1>ローカル画像ビューワー</h1></div><span id="desktop-badge" className={`desktop-badge${isDesktopApp() ? '' : ' hidden'}`}>DESKTOP</span></header>
      <div className="panel"><FolderControls /><Home /><StatusArea /><Gallery ref={actions.setGalleryNavigation} /></div><ListToolbar />
    </div><ViewerPanel />
  </>;
}
function useLayoutClasses(hidden: boolean, revealed: boolean) {
  useEffect(() => {
    document.body.classList.toggle('ui-hidden-mode', hidden);
    document.body.classList.toggle('ui-dock-revealed', hidden && revealed);
    return () => { document.body.classList.remove('ui-hidden-mode', 'ui-dock-revealed'); };
  }, [hidden, revealed]);
  useEffect(() => {
    const move = (event: MouseEvent) => actions.revealDock(event.clientY >= Math.max(window.innerHeight - 120, 0));
    const leave = () => actions.revealDock(false);
    document.addEventListener('mousemove', move); document.addEventListener('mouseleave', leave);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseleave', leave); };
  }, []);
}
