import { useShallow } from 'zustand/react/shallow';
import { useApplication, useAppActions, useAppState } from '../../app/ApplicationProvider';
export function FolderControls() {
  const actions = useAppActions();
  const { capabilities } = useApplication();
  const { directories, screen, listMode } = useAppState(
    useShallow((state) => ({
      directories: state.directories,
      screen: state.screen,
      listMode: state.listMode,
    })),
  );
  const hidden = directories.length ? '' : ' hidden';
  return (
    <div className="panel-top">
      <div className="folder-nav">
        <div className="nav-buttons">
          <button
            id="home-btn"
            type="button"
            className={`ui-btn ghost${capabilities.desktop ? hidden : ' hidden'}`}
            onClick={() => {
              void actions.showHome();
            }}
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
              <path d="M3 8.5 10 3l7 5.5" />
              <path d="M4.5 7.5v8a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8" />
              <path d="M8.25 16.5v-5h3.5v5" />
            </svg>
            ホーム
          </button>
          <button
            id="up-dir-btn"
            type="button"
            className={`ui-btn ghost${directories.length > 1 ? '' : ' hidden'}`}
            onClick={() => {
              void actions.navigate('back');
            }}
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
              <path d="M6.5 9.5 3.5 6.5l3-3" />
              <path d="M3.5 6.5h7.5a4 4 0 0 1 4 4v5" />
            </svg>
            上の階層へ
          </button>
        </div>
        <div className="dir-chip">
          {screen !== 'home' && <span className="chip-label">現在のフォルダ</span>}
          <span id="current-dir-name" className="chip-value">
            {screen === 'home'
              ? 'ホーム'
              : (directories.at(-1)?.name ?? 'フォルダを選択してください')}
          </span>
        </div>
      </div>

      {screen === 'home' && (
        <button
          id="home-select-dir-btn"
          type="button"
          className="ui-btn primary"
          onClick={() => {
            void actions.selectRootDirectory();
          }}
        >
          新しいフォルダーを開く
        </button>
      )}
      <div className={`panel-controls${screen === 'home' ? ' hidden' : hidden}`}>
        <div className="toolbar-group" role="group" aria-label="一覧モード">
          <span className="toolbar-group-label">一覧モード</span>
          <div className="segmented-control">
            <button
              id="directory-mode-btn"
              type="button"
              className={`seg-btn${listMode === 'directory' ? ' is-active' : ''}`}
              aria-pressed={listMode === 'directory'}
              onClick={() => {
                void actions.changeListMode('directory');
              }}
            >
              通常
            </button>
            <button
              id="recursive-btn"
              type="button"
              className={`seg-btn${listMode === 'recursive' ? ' is-active' : ''}`}
              aria-pressed={listMode === 'recursive'}
              onClick={() => {
                void actions.changeListMode('recursive');
              }}
            >
              全画像一覧
            </button>
            <button
              id="favorite-list-btn"
              type="button"
              className={`seg-btn${listMode === 'favorites' ? ' is-active' : ''}`}
              aria-pressed={listMode === 'favorites'}
              onClick={() => {
                void actions.changeListMode('favorites');
              }}
            >
              お気に入り一覧
            </button>
            <button
              id="hidden-mode-btn"
              type="button"
              className={`seg-btn${listMode === 'hidden' ? ' is-active' : ''}`}
              aria-pressed={listMode === 'hidden'}
              onClick={() => {
                void actions.changeListMode('hidden');
              }}
            >
              非表示一覧
            </button>
          </div>
        </div>

        <div className="actions" role="group" aria-label="フォルダ操作">
          <button
            id="reload-btn"
            type="button"
            className="ui-btn ghost"
            onClick={() => {
              void actions.reload();
            }}
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
              <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6" />
              <path d="M16.5 3.5v3h-3" />
            </svg>
            再読み込み
          </button>
          <button
            id="copy-path-btn"
            type="button"
            className="ui-btn ghost"
            onClick={() => {
              void actions.copyPath();
            }}
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
              <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
              <path d="M4.5 13H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h7.5A1.5 1.5 0 0 1 13 4v.5" />
            </svg>
            パスをコピー
          </button>
          {capabilities.desktop && (
            <button
              id="open-directory-externally-btn"
              type="button"
              className="ui-btn ghost"
              title="現在のフォルダーをエクスプローラーやFinderなどで開きます"
              onClick={() => {
                void actions.openCurrentDirectoryExternally();
              }}
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
                <path d="M11 3.5h5.5V9" />
                <path d="M16.5 3.5 9.5 10.5" />
                <path d="M15.5 11.5v3.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5h3.5" />
              </svg>
              フォルダーを外部で開く
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
