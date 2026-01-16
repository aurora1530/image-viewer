import { CONFIG } from './state';
import {
  buildFavoriteKey,
  normalizeDirPathSegments,
  normalizeFavoriteEntry
} from './utils';

type FavoriteEntry = string | { type?: string; path?: string };

type ConfigNode = {
  favorites: FavoriteEntry[];
  settings: Record<string, unknown>;
  directories: Record<string, ConfigNode>;
  version?: number;
};

/**
 * コンフィグノードの形を保証し、欠損フィールドを初期化する。
 */
export function ensureConfigNode(raw: unknown): ConfigNode {
  const node = raw && typeof raw === 'object' ? (raw as Partial<ConfigNode>) : {};
  if (!Array.isArray(node.favorites)) node.favorites = [];
  if (!node.settings || typeof node.settings !== 'object') node.settings = {};
  if (!node.directories || typeof node.directories !== 'object') node.directories = {};
  return node as ConfigNode;
}

/**
 * ルート設定を正規化し、バージョン情報を付与する。
 */
export function normalizeRootConfig(raw: unknown): ConfigNode {
  const node = ensureConfigNode(raw && typeof raw === 'object' ? { ...(raw as object) } : {});
  node.version = 2;
  return node;
}

/**
 * パスセグメントに対応する設定ノードを取得する。
 * 存在しない場合は `create` 指定で作成する。
 */
export function getConfigNode(
  rootConfig: ConfigNode,
  pathSegments: unknown,
  { create = false }: { create?: boolean } = {}
): ConfigNode | null {
  let node = ensureConfigNode(rootConfig);
  const segments = normalizeDirPathSegments(pathSegments);
  for (const segment of segments) {
    if (!node.directories[segment]) {
      if (!create) return null;
      node.directories[segment] = ensureConfigNode({});
    }
    node = ensureConfigNode(node.directories[segment]);
  }
  return node;
}

/**
 * ルートディレクトリ内の設定ファイルを読み取る。
 */
export async function readRootConfig(rootHandle: any): Promise<ConfigNode> {
  try {
    if (!rootHandle) return normalizeRootConfig(null);
    const fileHandle = await rootHandle.getFileHandle(CONFIG.CONFIG_FILENAME);
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text) return normalizeRootConfig(null);
    const json = JSON.parse(text);
    return normalizeRootConfig(json);
  } catch (e) {
    if (CONFIG.ENABLE_DEBUG_LOGS) {
      console.warn('ルートコンフィグ読み込みエラー:', e);
    }
    return normalizeRootConfig(null);
  }
}

/**
 * ルート設定を保存する。
 */
export async function writeRootConfig(
  rootHandle: any,
  config: ConfigNode,
  onError?: (message: string, error?: unknown) => void
): Promise<void> {
  try {
    if (!rootHandle) return;
    const fileHandle = await rootHandle.getFileHandle(CONFIG.CONFIG_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    const safeConfig = normalizeRootConfig(config);
    const payload = JSON.stringify(safeConfig, null, 2);
    await writable.write(payload);
    await writable.close();
  } catch (e) {
    console.error('ルートコンフィグ保存エラー:', e);
    if (onError) onError('コンフィグの保存に失敗しました。', e);
  }
}

/**
 * お気に入り一覧からキー集合を作成する。
 */
export function makeFavoriteSet(config: ConfigNode | null): Set<string> {
  const set = new Set<string>();
  if (!config || !Array.isArray(config.favorites)) return set;
  config.favorites.forEach(entry => {
    const key = normalizeFavoriteEntry(entry);
    if (key) set.add(key);
  });
  return set;
}

/**
 * アイテムからお気に入りキーを生成する。
 */
export function getFavoriteKeyForItem(item: any): string | null {
  if (!item) return null;
  if (item.type === 'directory') return buildFavoriteKey('directory', item.name);
  if (item.type === 'image' || item.type === 'video') return buildFavoriteKey('file', item.name);
  return null;
}

/**
 * お気に入りの追加・削除をトグルする。
 */
export async function toggleFavoriteEntry(
  rootHandle: any,
  dirPathSegments: unknown,
  entry: FavoriteEntry,
  onError?: (message: string, error?: unknown) => void
): Promise<boolean> {
  if (!rootHandle) return false;
  const rootConfig = await readRootConfig(rootHandle);
  const config = getConfigNode(rootConfig, dirPathSegments, { create: true });
  if (!config) return false;
  const favorites = Array.isArray(config.favorites) ? config.favorites.slice() : [];
  const key = normalizeFavoriteEntry(entry);
  if (!key) return false;
  const index = favorites.findIndex(item => normalizeFavoriteEntry(item) === key);
  if (index >= 0) {
    favorites.splice(index, 1);
    config.favorites = favorites;
    await writeRootConfig(rootHandle, rootConfig, onError);
    return false;
  }
  favorites.push(entry);
  config.favorites = favorites;
  await writeRootConfig(rootHandle, rootConfig, onError);
  return true;
}
