import { collectImagesRecursively } from './directoryTraversal';
import type { RecursiveImageItem } from './directoryTraversal';

type CollectionOptions = {
  shouldContinue?: () => boolean;
  onFirstImages?: (images: RecursiveImageItem[]) => void;
};

export function createRecursiveImageCache() {
  let entries = new WeakMap<FileSystemDirectoryHandle, {
    basePath: string;
    items: RecursiveImageItem[];
  }>();

  async function get(
    directory: FileSystemDirectoryHandle,
    basePath = '',
    { shouldContinue = () => true, onFirstImages }: CollectionOptions = {}
  ): Promise<RecursiveImageItem[]> {
    if (!shouldContinue()) return [];
    const cache = entries;
    const cached = cache.get(directory);
    if (cached?.basePath === basePath) {
      return cached.items.map(item => ({ ...item }));
    }

    let readFailed = false;
    const items = await collectImagesRecursively(
      directory, [], basePath, shouldContinue, onFirstImages,
      () => { readFailed = true; }
    );
    // 中断・失敗した部分一覧や、更新前に開始した走査の結果は保存しない。
    if (cache === entries && shouldContinue() && !readFailed) {
      cache.set(directory, { basePath, items });
    }
    // ソートやお気に入り・非表示の更新で収集結果を変更しないようにする。
    return items.map(item => ({ ...item }));
  }

  function clear() {
    // 子フォルダーを更新した場合も、親の再帰一覧をまとめて無効化する。
    entries = new WeakMap();
  }

  return { get, clear };
}
