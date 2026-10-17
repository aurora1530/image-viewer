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
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
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
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M10.707 4.293a1 1 0 010 1.414L7.414 9H14a1 1 0 110 2H7.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            上の階層へ
          </button>
        </div>
        <div className="dir-chip">
          <span className="chip-label">現在のフォルダ</span>
          <span id="current-dir-name" className="chip-value">
            {screen === 'home'
              ? 'ホーム'
              : (directories.at(-1)?.name ?? 'フォルダを選択してください')}
          </span>
        </div>
      </div>

      <div className={`panel-controls${hidden}`}>
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
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
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
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
            パスをコピー
          </button>
        </div>
      </div>
    </div>
  );
}
