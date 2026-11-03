export async function confirmRemoval(kind: 'favorite' | 'history', name: string): Promise<boolean> {
  if (window.desktopApi) return window.desktopApi.confirmRemoval(kind, name);
  return window.confirm(
    kind === 'favorite'
      ? `「${name}」をお気に入りから外しますか？`
      : `「${name}」を履歴から削除しますか？`,
  );
}
