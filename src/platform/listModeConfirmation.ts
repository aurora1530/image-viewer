export async function confirmListMode(mode: 'recursive' | 'favorites'): Promise<boolean> {
  // Electron's synchronous JavaScript dialogs can leave Windows text inputs
  // without keyboard focus after dismissal. Use the main-process async dialog.
  if (window.desktopApi) return window.desktopApi.confirmListMode(mode);
  return window.confirm(
    mode === 'recursive'
      ? 'このフォルダ配下の画像・動画・PDFをすべて読み込みます。続行しますか？'
      : 'ルート設定の .image-viewer.json からお気に入りファイルをすべて読み込みます。続行しますか？',
  );
}
