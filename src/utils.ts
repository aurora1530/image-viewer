/**
 * 指定拡張子リストに一致する画像ファイル名か判定する。
 */
export function isImageFileName(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some(ext => lower.endsWith(ext));
}

/**
 * パス表現をディレクトリセグメント配列に正規化する。
 */
export function normalizeDirPathSegments(path: unknown): string[] {
  if (!path) return [];
  if (Array.isArray(path)) return path.filter(Boolean).map(String);
  return String(path).split('/').filter(Boolean);
}

/**
 * お気に入りの識別キーを生成する。
 */
export function buildFavoriteKey(type: 'file' | 'directory', path: string): string {
  return `${type}:${path}`;
}

/**
 * お気に入りエントリを `type:path` 形式に正規化する。
 */
export function normalizeFavoriteEntry(entry: unknown): string | null {
  if (typeof entry === 'string') {
    if (entry.includes(':')) return entry;
    return buildFavoriteKey('file', entry);
  }
  if (entry && typeof entry === 'object') {
    const maybe = entry as { type?: string; path?: string };
    const type = maybe.type === 'directory' ? 'directory' : 'file';
    if (typeof maybe.path === 'string' && maybe.path.length > 0) {
      return buildFavoriteKey(type, maybe.path);
    }
  }
  return null;
}

/**
 * お気に入りを先頭に安定ソートする。
 */
export function sortByFavorite<T extends { isFavorite?: boolean }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.isFavorite === b.item.isFavorite) return a.index - b.index;
      return a.item.isFavorite ? -1 : 1;
    })
    .map(entry => entry.item);
}

/**
 * ベースパスと名前を相対パスとして結合する。
 */
export function joinRelativePath(basePath: string, name: string): string {
  return basePath ? `${basePath}/${name}` : name;
}
