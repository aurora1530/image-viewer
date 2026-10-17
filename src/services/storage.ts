import { ConfigStore } from './configStore';
import { CONFIG } from '../shared/model';
import {
  buildFavoriteKey,
  joinRelativePath,
  normalizeDirPathSegments,
  normalizeConfigEntry,
  normalizeFavoriteEntry,
} from '../shared/utils';

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

export type FavoriteFileHandleEntry = {
  handle: FileSystemFileHandle;
  parentHandle: FileSystemDirectoryHandle;
  name: string;
  parentPath: string;
  path: string;
  isHidden: boolean;
};

type FavoriteKeyItem = {
  type: 'directory' | 'image' | 'video' | 'pdf';
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
      directories: {},
    };
  }

  const rawFavorites = raw.favorites;
  raw.favorites = Array.isArray(rawFavorites) ? rawFavorites.filter(isConfigEntry) : [];

  const rawHiddenItems = raw.hiddenItems;
  raw.hiddenItems = Array.isArray(rawHiddenItems) ? rawHiddenItems.filter(isConfigEntry) : [];

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
 * 読み込み時に正規化されたツリーを参照し、全体の再正規化は行わない。
 * 存在しない場合は `create` 指定で作成する。
 */
export function getConfigNode(
  rootConfig: ConfigNode,
  pathSegments: unknown,
  { create = false }: { create?: boolean } = {},
): ConfigNode | null {
  let node = rootConfig;
  const segments = normalizeDirPathSegments(pathSegments);
  for (const segment of segments) {
    if (!node.directories[segment]) {
      if (!create) return null;
      node.directories[segment] = ensureConfigNode({});
    }
    node = node.directories[segment];
  }
  return node;
}

const configStores = new WeakMap<FileSystemDirectoryHandle, ConfigStore<ConfigNode>>();

type ErrorReporter = (message: string, error?: unknown) => void;

function getConfigStore(rootHandle: FileSystemDirectoryHandle): ConfigStore<ConfigNode> {
  let store = configStores.get(rootHandle);
  if (!store) {
    store = new ConfigStore(
      async () => {
        let fileHandle: FileSystemFileHandle;
        try {
          fileHandle = await rootHandle.getFileHandle(CONFIG.CONFIG_FILENAME);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            return normalizeRootConfig(null);
          }
          throw error;
        }
        const text = await (await fileHandle.getFile()).text();
        const raw: unknown = JSON.parse(text);
        if (!isRecord(raw) || Array.isArray(raw)) throw new Error('設定ファイルの形式が不正です。');
        if (typeof raw.version === 'number' && raw.version > 3) {
          throw new Error('この設定ファイルは新しいバージョンのアプリで作成されています。');
        }
        return normalizeRootConfig(raw);
      },
      async (payload) => {
        const fileHandle = await rootHandle.getFileHandle(CONFIG.CONFIG_FILENAME, { create: true });
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(payload);
          await writable.close();
        } catch (error) {
          await writable.abort?.().catch(() => undefined);
          throw error;
        }
      },
    );
    configStores.set(rootHandle, store);
  }
  return store;
}

/** Reads and normalizes once per root; rendering never reads the disk again. */
export async function readRootConfig(
  rootHandle: FileSystemDirectoryHandle | null,
): Promise<ConfigNode> {
  return rootHandle ? getConfigStore(rootHandle).read() : normalizeRootConfig(null);
}

/** Explicit refresh: persist local changes before loading external edits. */
export async function reloadRootConfig(
  rootHandle: FileSystemDirectoryHandle | null,
): Promise<ConfigNode> {
  return rootHandle ? getConfigStore(rootHandle).reload() : normalizeRootConfig(null);
}

export async function flushRootConfig(rootHandle: FileSystemDirectoryHandle | null): Promise<void> {
  if (rootHandle) await configStores.get(rootHandle)?.flush();
}

/** Compatibility entry point for whole-document writes; normal edits use update. */
export async function writeRootConfig(
  rootHandle: FileSystemDirectoryHandle | null,
  config: ConfigNode,
  onError?: ErrorReporter,
): Promise<boolean> {
  if (!rootHandle) return false;
  try {
    const store = getConfigStore(rootHandle);
    await store.update((current) => {
      if (current !== config) {
        for (const key of Object.keys(current)) delete (current as Record<string, unknown>)[key];
        Object.assign(current, normalizeRootConfig(config));
      }
    });
    await store.flush();
    return true;
  } catch (error) {
    onError?.('コンフィグの保存に失敗しました。', error);
    return false;
  }
}

/** Capture the root, path and values at the time of the UI action. */
export async function saveDirectorySettings(
  rootHandle: FileSystemDirectoryHandle,
  pathSegments: unknown,
  settings: Record<string, unknown>,
  onError?: ErrorReporter,
): Promise<void> {
  const path = normalizeDirPathSegments(pathSegments);
  const snapshot = { ...settings };
  try {
    const store = getConfigStore(rootHandle);
    await store.update((root) => {
      const node = getConfigNode(root, path, { create: true })!;
      node.settings = { ...node.settings, ...snapshot };
    });
    store.scheduleSave((error) => onError?.('コンフィグの保存に失敗しました。', error));
  } catch (error) {
    onError?.('コンフィグの読み込みに失敗しました。', error);
  }
}

/**
 * お気に入り一覧からキー集合を作成する。
 */
export function makeFavoriteSet(config: ConfigNode | null): Set<string> {
  const set = new Set<string>();
  if (!config || !Array.isArray(config.favorites)) return set;
  config.favorites.forEach((entry) => {
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
  config.hiddenItems.forEach((entry) => {
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
  return buildFavoriteKey('file', item.name);
}

async function collectFavoriteFilesFromNode(
  dirHandle: FileSystemDirectoryHandle,
  node: ConfigNode,
  parentPath: string,
  list: FavoriteFileHandleEntry[],
  favoriteBranches: WeakSet<ConfigNode>,
): Promise<void> {
  const hiddenSet = makeHiddenSet(node);
  for (const entry of node.favorites) {
    const key = normalizeFavoriteEntry(entry);
    if (!key || !key.startsWith('file:')) continue;
    const fileName = key.slice('file:'.length);
    if (!fileName) continue;
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName);
      list.push({
        handle: fileHandle,
        parentHandle: dirHandle,
        name: fileName,
        parentPath,
        path: joinRelativePath(parentPath, fileName),
        isHidden: hiddenSet.has(key),
      });
    } catch (e) {
      if (CONFIG.ENABLE_DEBUG_LOGS) {
        console.warn(
          `お気に入りファイルを読み込めませんでした: ${joinRelativePath(parentPath, fileName)}`,
          e,
        );
      }
    }
  }

  for (const [dirName, childNode] of Object.entries(node.directories)) {
    if (!favoriteBranches.has(childNode)) continue;
    try {
      const childHandle = await dirHandle.getDirectoryHandle(dirName);
      await collectFavoriteFilesFromNode(
        childHandle,
        childNode,
        joinRelativePath(parentPath, dirName),
        list,
        favoriteBranches,
      );
    } catch (e) {
      if (CONFIG.ENABLE_DEBUG_LOGS) {
        console.warn(
          `お気に入りディレクトリを読み込めませんでした: ${joinRelativePath(parentPath, dirName)}`,
          e,
        );
      }
    }
  }
}

/**
 * ルート設定からお気に入りファイルのハンドル一覧を収集する。
 * rootConfig は readRootConfig または normalizeRootConfig で正規化して渡す。
 */
export async function collectFavoriteFilesFromConfig(
  rootHandle: FileSystemDirectoryHandle | null,
  rootConfig: ConfigNode | null,
): Promise<FavoriteFileHandleEntry[]> {
  if (!rootHandle || !rootConfig) return [];
  const list: FavoriteFileHandleEntry[] = [];
  const favoriteBranches = new WeakSet<ConfigNode>();
  const markBranches = (node: ConfigNode): boolean => {
    let hasFavorites = node.favorites.some((entry) =>
      normalizeFavoriteEntry(entry)?.startsWith('file:'),
    );
    for (const child of Object.values(node.directories)) {
      if (markBranches(child)) hasFavorites = true;
    }
    if (hasFavorites) favoriteBranches.add(node);
    return hasFavorites;
  };
  if (markBranches(rootConfig)) {
    await collectFavoriteFilesFromNode(rootHandle, rootConfig, '', list, favoriteBranches);
  }
  return list;
}

async function toggleEntry(
  rootHandle: FileSystemDirectoryHandle | null,
  pathSegments: unknown,
  entry: ConfigEntry,
  field: 'favorites' | 'hiddenItems',
  onError?: ErrorReporter,
): Promise<boolean> {
  if (!rootHandle) return false;
  const key = normalizeConfigEntry(entry);
  if (!key) return false;
  const path = normalizeDirPathSegments(pathSegments);
  const snapshot = typeof entry === 'string' ? entry : { ...entry };
  try {
    const store = getConfigStore(rootHandle);
    const enabled = await store.update((root) => {
      const entries = getConfigNode(root, path, { create: true })![field];
      const index = entries.findIndex((item) => normalizeConfigEntry(item) === key);
      if (index >= 0) entries.splice(index, 1);
      else entries.push(snapshot);
      return index < 0;
    });
    await store.flush();
    return enabled;
  } catch (error) {
    onError?.('コンフィグの保存に失敗しました。', error);
    throw error;
  }
}

export function toggleFavoriteEntry(
  rootHandle: FileSystemDirectoryHandle | null,
  dirPathSegments: unknown,
  entry: FavoriteEntry,
  onError?: ErrorReporter,
): Promise<boolean> {
  return toggleEntry(rootHandle, dirPathSegments, entry, 'favorites', onError);
}

export function toggleHiddenEntry(
  rootHandle: FileSystemDirectoryHandle | null,
  dirPathSegments: unknown,
  entry: HiddenEntry,
  onError?: ErrorReporter,
): Promise<boolean> {
  return toggleEntry(rootHandle, dirPathSegments, entry, 'hiddenItems', onError);
}
