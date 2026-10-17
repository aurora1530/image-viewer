import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// Keep PDF.js resources local, with stable names required by its resource loaders.
const pdfAssets = ['cmaps', 'standard_fonts', 'wasm'].flatMap((directory) => {
  const root = new URL(`./node_modules/pdfjs-dist/${directory}/`, import.meta.url);
  return readdirSync(root).map((name) => ({
    name: `pdfjs/${directory}/${name}`,
    path: fileURLToPath(new URL(name, root)),
  }));
});

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    {
      name: 'local-pdf-resources',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const asset = pdfAssets.find((asset) => `/${asset.name}` === request.url);
          if (!asset) return next();
          response.setHeader(
            'Content-Type',
            asset.name.endsWith('.wasm')
              ? 'application/wasm'
              : asset.name.endsWith('.js')
                ? 'text/javascript'
                : 'application/octet-stream',
          );
          response.end(readFileSync(asset.path));
        });
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version }),
        });
        for (const asset of pdfAssets)
          this.emitFile({ type: 'asset', fileName: asset.name, source: readFileSync(asset.path) });
      },
    },
  ],
});
