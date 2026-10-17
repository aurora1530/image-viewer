import { useEffect, useRef, useState } from 'react';
import { useApplication, useAppActions, useAppState } from '../../app/ApplicationProvider';
import { sizeOptions } from '../../app/store';
import { MiB, type AppConfig } from '../../shared/appConfig';

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
  const fields: [keyof AppConfig, string, number][] = [
    ['thumbnailMemoryMiB', 'サムネイルのメモリ', usage.thumbnail],
    ['originalMemoryMiB', '元画像のメモリ', usage.original],
    ...(capabilities.desktop
      ? [
          ['thumbnailDiskMiB', 'サムネイルのディスク', usage.disk] as [
            keyof AppConfig,
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
        disabled={!ready && !error}
        onClick={() => {
          setDraft(config);
          setSaved(false);
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        設定
      </button>
      <dialog
        ref={dialog}
        className="settings-dialog"
        aria-labelledby="settings-title"
        onClose={() => setOpen(false)}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <h2 id="settings-title">設定</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            setSaved(false);
            void actions.saveConfig(draft).then((success) => {
              setSaving(false);
              setSaved(success);
              void actions.refreshCacheUsage();
            });
          }}
        >
          <h3>キャッシュ</h3>
          <p>容量上限は MiB 単位です。0 は保持なし。古いキャッシュから自動で解放します。</p>
          {fields.map(([key, label, bytes]) => (
            <label className="settings-field" key={key}>
              <span>
                {label}
                <small>使用中: {(bytes / MiB).toFixed(2)} MiB</small>
              </span>
              <input
                aria-label={`${label}の最大容量（MiB）`}
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
          <p className="settings-note">設定保存先: {usage.configPath}</p>
          <p role="status">{error || (saved ? '保存しました。' : '')}</p>
          <button type="submit" disabled={saving || !ready}>
            {saving ? '保存中…' : '容量設定を保存'}
          </button>
        </form>
        <h3>表示</h3>
        <label className="settings-field">
          サムネイルサイズ
          <select
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
          単一ページ表示
          <input type="checkbox" checked={single} onChange={() => actions.toggleSinglePage()} />
        </label>
        <p className="settings-note">
          表示設定は変更時に保存します。フォルダーを開くと、そのフォルダーのサムネイル設定が優先されます。
        </p>
        <button type="button" disabled={saving} onClick={() => dialog.current?.close()}>
          閉じる
        </button>
      </dialog>
    </>
  );
}
