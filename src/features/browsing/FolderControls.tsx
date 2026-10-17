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
      <div className="dir-chip">
        <span className="chip-label">現在のフォルダ</span>
        <span id="current-dir-name" className="chip-value">
          {screen === 'home'
            ? 'ホーム'
            : (directories.at(-1)?.name ?? 'フォルダを選択してください')}
        </span>
      </div>
      <div className="actions">
        <button
          id="home-btn"
          className={`ui-btn ghost${capabilities.desktop ? hidden : ' hidden'}`}
          onClick={() => {
            void actions.showHome();
          }}
        >
          ホーム
        </button>
        <button
          id="up-dir-btn"
          className={`ui-btn ghost${directories.length > 1 ? '' : ' hidden'}`}
          onClick={() => {
            void actions.navigate('back');
          }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10.707 4.293a1 1 0 010 1.414L7.414 9H14a1 1 0 110 2H7.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          上の階層へ
        </button>
        <button
          id="copy-path-btn"
          className={`ui-btn ghost${hidden}`}
          onClick={() => {
            void actions.copyPath();
          }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
          パスをコピー
        </button>
        <button
          id="reload-btn"
          className={`ui-btn ghost${hidden}`}
          onClick={() => {
            void actions.reload();
          }}
        >
          再読み込み
        </button>
        <button
          id="recursive-btn"
          className={`ui-btn outline${hidden}${listMode === 'recursive' ? ' is-active' : ''}`}
          onClick={() => {
            void actions.changeListMode('recursive');
          }}
        >
          {listMode === 'recursive' ? '戻る' : '全画像一覧'}
        </button>
        <button
          id="favorite-list-btn"
          className={`ui-btn outline${hidden}${listMode === 'favorites' ? ' is-active' : ''}`}
          onClick={() => {
            void actions.changeListMode('favorites');
          }}
        >
          {listMode === 'favorites' ? '戻る' : 'お気に入り一覧'}
        </button>
        <button
          id="select-dir-btn"
          className="ui-btn primary"
          onClick={() => {
            void actions.selectRootDirectory();
          }}
        >
          ルートフォルダを選択
        </button>
      </div>
    </div>
  );
}
