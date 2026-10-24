import { useEffect, useRef, useState } from 'react';
import { useApplication, useAppActions, useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
import {
  MiB,
  defaultAppConfig,
  isDirectoryThumbnailName,
  type CapacityConfigKey,
} from '../../shared/appConfig';
import { ReleaseInfo } from './ReleaseInfo';

export function Settings() {
  const dialog = useRef<HTMLDialogElement>(null);
  const config = useAppState((s) => s.config);
  const ready = useAppState((s) => s.configReady);
  const error = useAppState((s) => s.configError);
  const usage = useAppState((s) => s.cacheUsage);
  const size = useAppState((s) => s.thumbnailSizeIndex);
  const single = useAppState((s) => s.isSinglePageView);
  const { capabilities } = useApplication();
  const actions = useAppActions();
  const [draft, setDraft] = useState(config);
  const [namesText, setNamesText] = useState(config.directoryThumbnailNames.join('\n'));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open) return;
    void actions.refreshCacheUsage();
    const timer = setInterval(() => {
      void actions.refreshCacheUsage();
    }, 2000);
    return () => clearInterval(timer);
  }, [open, actions]);
  const fields: [CapacityConfigKey, string, number][] = [
    ['thumbnailMemoryMiB', 'サムネイルのメモリ', usage.thumbnail],
    ['originalMemoryMiB', '元画像のメモリ', usage.original],
    ...(capabilities.desktop
      ? [
          ['thumbnailDiskMiB', 'サムネイルのディスク', usage.disk] as [
            CapacityConfigKey,
            string,
            number,
          ],
        ]
      : []),
  ];
  return (
    <>
      <button
        type="button"
        className="ui-btn ghost"
        disabled={!ready && !error}
        onClick={() => {
          setDraft(config);
          dialog.current?.querySelector('textarea')?.setCustomValidity('');
          setNamesText(config.directoryThumbnailNames.join('\n'));
          setSaved(false);
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
        設定
      </button>
      <dialog
        ref={dialog}
        className="settings-dialog"
        aria-labelledby="settings-title"
        onClose={() => setOpen(false)}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-title">設定</h2>
          <button
            type="button"
            className="ui-btn ghost"
            disabled={saving}
            onClick={() => dialog.current?.close()}
          >
            閉じる
          </button>
        </div>
        <form
          className="settings-section"
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            setSaved(false);
            const names = namesText
              .split('\n')
              .map((name) => name.trim())
              .filter(Boolean);
            void actions
              .saveConfig({ ...draft, directoryThumbnailNames: names })
              .then((success) => {
                setSaving(false);
                setSaved(success);
                void actions.refreshCacheUsage();
              });
          }}
        >
          <h3>キャッシュ</h3>
          <p className="settings-desc">
            容量上限は MiB 単位です。0 は保持なし。古いキャッシュから自動で解放します。
          </p>
          {fields.map(([key, label, bytes]) => (
            <label className="settings-field" key={key}>
              <span>
                {label}
                <small>使用中: {(bytes / MiB).toFixed(2)} MiB</small>
              </span>
              <input
                aria-label={`${label}の最大容量（MiB）`}
                className="ui-input"
                type="number"
                min="0"
                max="1048576"
                step="1"
                required
                value={draft[key]}
                onChange={(e) => {
                  setDraft({ ...draft, [key]: e.currentTarget.valueAsNumber });
                  setSaved(false);
                }}
              />
            </label>
          ))}
          <p className="settings-note">
            使用量は保持中の画像データです。表示・デコード中の画像やアプリ全体のメモリは含みません。
          </p>
          {usage.path && <p className="settings-note">キャッシュ保存先: {usage.path}</p>}
          <h3>フォルダーの代表画像</h3>
          <p className="settings-desc" id="thumbnail-names-help">
            拡張子を除いた名前を1行に1つ入力します。上の行から優先します。
            すべて削除すると優先名による選択を行いません。
          </p>
          <label className="settings-names">
            <span>代表画像の優先名</span>
            <textarea
              className="ui-input"
              rows={4}
              value={namesText}
              aria-describedby="thumbnail-names-help"
              onChange={(event) => {
                const text = event.currentTarget.value;
                const valid = text
                  .split('\n')
                  .every((name) => !name.trim() || isDirectoryThumbnailName(name.trim()));
                event.currentTarget.setCustomValidity(
                  valid
                    ? ''
                    : 'ファイル名に使える名前を入力してください（パスや記号は指定できません）。',
                );
                setNamesText(text);
                setSaved(false);
              }}
            />
          </label>
          <button
            type="button"
            className="ui-btn ghost"
            onClick={() => {
              setNamesText(defaultAppConfig.directoryThumbnailNames.join('\n'));
              dialog.current?.querySelector('textarea')?.setCustomValidity('');
              setSaved(false);
            }}
          >
            既定の優先名に戻す
          </button>
          <p className="settings-note">
            保存後、表示中のフォルダーには「再読み込み」で反映します。
          </p>
          <p className="settings-note">設定保存先: {usage.configPath}</p>
          <div className="settings-footer">
            <p role="status" aria-label="設定の保存状況" className="settings-status">
              {error || (saved ? '保存しました。' : '')}
            </p>
            <button type="submit" className="ui-btn primary" disabled={saving || !ready}>
              {saving ? '保存中…' : '設定を保存'}
            </button>
          </div>
        </form>
        <div className="settings-section">
          <h3>表示</h3>
          <label className="settings-field">
            <span>サムネイルサイズ</span>
            <select
              className="ui-select"
              value={size}
              onChange={(e) => actions.setThumbnailSize(Number(e.currentTarget.value))}
            >
              {sizeOptions.map((option, index) => (
                <option key={index} value={index}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>単一ページ表示</span>
            <input
              type="checkbox"
              className="settings-checkbox"
              checked={single}
              onChange={() => actions.toggleSinglePage()}
            />
          </label>
          <p className="settings-note">
            表示設定は変更時に保存します。フォルダーを開くと、そのフォルダーのサムネイル設定が優先されます。
          </p>
        </div>
        <ReleaseInfo />
      </dialog>
    </>
  );
}
