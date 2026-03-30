import { CONFIG } from './state';
import {
  buildFavoriteKey,
  normalizeDirPathSegments,
  normalizeConfigEntry,
  normalizeFavoriteEntry
} from './utils';

export type ConfigEntry = string | { type?: string; path?: string };
export type FavoriteEntry = ConfigEntry;
export type HiddenEntry = ConfigEntry;

export type ConfigNode = {
  favorites: FavoriteEntry[];
  hiddenItems: HiddenEntry[];
  settings: Record<string, unknown>;
  directories: Record<string, ConfigNode>;
  version?: number;
};

type FavoriteKeyItem = {
  type: 'directory' | 'image' | 'video';
  name: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isConfigEntry = (value: unknown): value is ConfigEntry => {
  if (typeof value === 'string') return true;
  if (!isRecord(value)) return false;
  const typeValue = value.type;
  const pathValue = value.path;
  const typeOk = typeValue === undefined || typeof typeValue === 'string';
  const pathOk = pathValue === undefined || typeof pathValue === 'string';
  return typeOk && pathOk;
};

/**
 * コンフィグノードの形を保証し、欠損フィールドを初期化する。
 */
export function ensureConfigNode(raw: unknown): ConfigNode {
  if (!isRecord(raw)) {
    return {
      favorites: [],
      hiddenItems: [],
      settings: {},
      directories: {}
    };
  }

  const rawFavorites = raw.favorites;
  raw.favorites = Array.isArray(rawFavorites)
    ? rawFavorites.filter(isConfigEntry)
    : [];

  const rawHiddenItems = raw.hiddenItems;
  raw.hiddenItems = Array.isArray(rawHiddenItems)
    ? rawHiddenItems.filter(isConfigEntry)
    : [];

  const rawSettings = raw.settings;
  raw.settings = isRecord(rawSettings) ? rawSettings : {};

  const rawDirectories = raw.directories;
  const directoriesRaw: Record<string, unknown> = isRecord(rawDirectories) ? rawDirectories : {};
  const directories: Record<string, ConfigNode> = {};
  for (const [key, value] of Object.entries(directoriesRaw)) {
    directories[key] = ensureConfigNode(value);
  }
  raw.directories = directories;

  if (typeof raw.version !== 'number') {
    delete raw.version;
  }
  return raw as ConfigNode;
}

/**
 * ルート設定を正規化し、バージョン情報を付与する。
 */
export function normalizeRootConfig(raw: unknown): ConfigNode {
  const node = ensureConfigNode(raw);
  node.version = 3;
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
export async function readRootConfig(rootHandle: FileSystemDirectoryHandle | null): Promise<ConfigNode> {
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
  rootHandle: FileSystemDirectoryHandle | null,
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
 * 非表示一覧からキー集合を作成する。
 */
export function makeHiddenSet(config: ConfigNode | null): Set<string> {
  const set = new Set<string>();
  if (!config || !Array.isArray(config.hiddenItems)) return set;
  config.hiddenItems.forEach(entry => {
    const key = normalizeConfigEntry(entry);
    if (key) set.add(key);
  });
  return set;
}

/**
 * アイテムからお気に入りキーを生成する。
 */
export function getFavoriteKeyForItem(item: FavoriteKeyItem | null | undefined): string | null {
  if (!item) return null;
  if (item.type === 'directory') return buildFavoriteKey('directory', item.name);
  if (item.type === 'image' || item.type === 'video') return buildFavoriteKey('file', item.name);
  return null;
}

/**
 * お気に入りの追加・削除をトグルする。
 */
export async function toggleFavoriteEntry(
  rootHandle: FileSystemDirectoryHandle | null,
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

/**
 * 非表示の追加・削除をトグルする。
 */
export async function toggleHiddenEntry(
  rootHandle: FileSystemDirectoryHandle | null,
  dirPathSegments: unknown,
  entry: HiddenEntry,
  onError?: (message: string, error?: unknown) => void
): Promise<boolean> {
  if (!rootHandle) return false;
  const rootConfig = await readRootConfig(rootHandle);
  const config = getConfigNode(rootConfig, dirPathSegments, { create: true });
  if (!config) return false;
  const hiddenItems = Array.isArray(config.hiddenItems) ? config.hiddenItems.slice() : [];
  const key = normalizeConfigEntry(entry);
  if (!key) return false;
  const index = hiddenItems.findIndex(item => normalizeConfigEntry(item) === key);
  if (index >= 0) {
    hiddenItems.splice(index, 1);
    config.hiddenItems = hiddenItems;
    await writeRootConfig(rootHandle, rootConfig, onError);
    return false;
  }
  hiddenItems.push(entry);
  config.hiddenItems = hiddenItems;
  await writeRootConfig(rootHandle, rootConfig, onError);
  return true;
}
