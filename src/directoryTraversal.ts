import { CONFIG } from './state';
import { isImageFileName, joinRelativePath } from './utils';
import type { SortOrder } from './state';

export type RecursiveImageItem = {
	handle: FileSystemFileHandle;
	name: string;
	parentHandle: FileSystemDirectoryHandle;
	imageIndex: number;
	parentPath: string;
	path: string;
	isFavorite?: boolean;
	displayIndex?: number;
	nameLower?: string;
};

export async function getImageFilesFromDirectory(
	dirHandle: FileSystemDirectoryHandle,
	order: SortOrder = 'asc'
): Promise<FileSystemFileHandle[]> {
	const imageFiles: FileSystemFileHandle[] = [];
	try {
		for await (const entry of dirHandle.values()) {
			if (entry.kind === 'file' && isImageFileName(entry.name, CONFIG.IMAGE_EXTENSIONS)) {
				imageFiles.push(entry);
			}
		}
		imageFiles.sort((a, b) => {
			const nameA = a.name.toLowerCase();
			const nameB = b.name.toLowerCase();
			if (order === 'asc') {
				return nameA.localeCompare(nameB, undefined, { numeric: true });
			} else {
				return nameB.localeCompare(nameA, undefined, { numeric: true });
			}
		});
	} catch (e) {
		console.error(`ディレクトリ内の画像取得エラー (${dirHandle.name}):`, e);
	}
	return imageFiles;
}

export async function collectImagesRecursively(
	dirHandle: FileSystemDirectoryHandle,
	list: RecursiveImageItem[] = [],
	basePath = ''
): Promise<RecursiveImageItem[]> {
	const images = await getImageFilesFromDirectory(dirHandle);
	images.forEach((img, idx) => {
		list.push({
			handle: img,
			name: img.name,
			parentHandle: dirHandle,
			imageIndex: idx,
			parentPath: basePath,
			path: joinRelativePath(basePath, img.name)
		});
	});
	try {
		for await (const entry of dirHandle.values()) {
			if (entry.kind === 'directory') {
				await collectImagesRecursively(entry, list, joinRelativePath(basePath, entry.name));
			}
		}
	} catch (e) {
		console.error('再帰的な画像取得に失敗', e);
	}
	return list;
}
