import { originalImageCache } from './originalImageCache';

export type PdfDocument = {
  pageCount: number;
  renderPage: (page: number, maxEdge?: number) => Promise<Blob>;
  destroy: () => void;
};

// Import only when needed: ordinary image browsing does not load PDF.js.
export async function openPdfDocument(
  handle: FileSystemFileHandle,
  shouldContinue: () => boolean = () => true,
): Promise<PdfDocument> {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerSrc;
  const blob = await originalImageCache.get(handle);
  if (!shouldContinue()) throw new Error('PDFの読み込みを中止しました。');
  const assetBase = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
  });
  // No password dialog is available; fail promptly instead of leaving loading pending.
  task.onPassword = (updatePassword: (error: Error) => void) => {
    updatePassword(new Error('パスワードで保護されたPDFには対応していません。'));
  };
  let pdf;
  try {
    pdf = await task.promise;
    if (!shouldContinue()) throw new Error('PDFの読み込みを中止しました。');
  } catch (error) {
    await task.destroy();
    throw error;
  }
  let destroyed = false;
  return {
    pageCount: pdf.numPages,
    async renderPage(number, maxEdge = 2560) {
      if (destroyed) throw new Error('PDFは閉じられています。');
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: maxEdge / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      try {
        await page.render({ canvas, viewport, background: 'white' }).promise;
        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('PDFの描画に失敗しました。'))),
            maxEdge <= 1280 ? 'image/webp' : 'image/png',
            0.92,
          );
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      void task.destroy();
    },
  };
}

export async function renderPdfThumbnail(
  handle: FileSystemFileHandle,
  shouldContinue: () => boolean,
) {
  const document = await openPdfDocument(handle, shouldContinue);
  try {
    return shouldContinue() ? await document.renderPage(1, 1280) : null;
  } finally {
    document.destroy();
  }
}
