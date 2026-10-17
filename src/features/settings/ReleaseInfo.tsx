import { useSyncExternalStore } from 'react';
import { useApplication } from '../../app/ApplicationProvider';
import { appVersion, releaseUrl, releasesUrl } from '../../shared/release';

export function ReleaseInfo() {
  const { releases } = useApplication();
  const state = useSyncExternalStore(releases.subscribe, releases.getSnapshot);
  const messages = {
    idle: '',
    manual: 'この実行形式は手動更新です。',
    checking: '更新を確認中…',
    current: '最新のバージョンです。',
    downloading: `v${state.version} をダウンロード中…`,
    ready: `v${state.version} に更新できます。`,
    available: `v${state.version} が公開されています。`,
    error: '更新を確認できませんでした。後でもう一度お試しください。',
  };
  return (
    <div className="settings-section">
      <h3>バージョンと更新</h3>
      <p>
        <a href={releaseUrl} target="_blank" rel="noreferrer">
          v{appVersion} のリリース情報
        </a>
      </p>
      <p>
        <a href={`${releasesUrl}/latest`} target="_blank" rel="noreferrer">
          最新リリース・ダウンロード
        </a>
      </p>
      <p role="status" aria-label="更新状況">
        {messages[state.status]}
      </p>
      {state.status === 'ready' ? (
        <button
          className="ui-btn primary"
          type="button"
          onClick={() => {
            void releases.install();
          }}
        >
          再起動して更新
        </button>
      ) : state.status === 'available' ? (
        <button className="ui-btn primary" type="button" onClick={() => window.location.reload()}>
          再読み込みして更新
        </button>
      ) : (
        state.status !== 'manual' && (
          <button
            className="ui-btn ghost"
            type="button"
            disabled={['checking', 'downloading'].includes(state.status)}
            onClick={() => {
              void releases.check();
            }}
          >
            更新を確認
          </button>
        )
      )}
    </div>
  );
}

export function VersionBadge() {
  const { releases } = useApplication();
  const state = useSyncExternalStore(releases.subscribe, releases.getSnapshot);
  return (
    <span className="version-badge">
      <a href={releaseUrl} target="_blank" rel="noreferrer">
        v{appVersion}
      </a>
      {['ready', 'available'].includes(state.status) && (
        <span role="status"> · 更新あり（設定）</span>
      )}
    </span>
  );
}
