const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function createThumbnailStore({ cacheDirectory, requireAllowed, maxEntries = 10000, maxBytes = 1024 * 1024 * 1024 }) {
  let writes = 0;
  const cachedFiles = new Map();
  let indexLoaded = false;
  let pruning = null;
  let pruneRequested = false;

  async function describe(filePath) {
    const resolved = requireAllowed(filePath);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('画像ファイルではありません。');
    const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const version = createHash('sha256').update(JSON.stringify([
      'thumbnail-v1-1280-webp', identity, stat.size, stat.mtimeMs, stat.ctimeMs
    ])).digest('hex');
    return { version, file: path.join(cacheDirectory(), `${version}.webp`) };
  }

  async function read(filePath) {
    const { version, file } = await describe(filePath);
    try {
      const bytes = await fs.readFile(file);
      // Track recent use without writing timestamps on every disk cache hit.
      cachedFiles.set(file, { size: bytes.byteLength, time: Date.now() });
      return { version, bytes };
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { version, bytes: null }; }
  }

  async function prune() {
    const directory = cacheDirectory();
    if (!indexLoaded) {
      const files = (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.webp$/.test(name));
      // Read existing metadata once, in bounded batches rather than flooding disk I/O.
      for (let offset = 0; offset < files.length; offset += 32) {
        await Promise.all(files.slice(offset, offset + 32).map(async name => {
          const file = path.join(directory, name);
          if (cachedFiles.has(file)) return;
          try {
            const stat = await fs.stat(file);
            if (!cachedFiles.has(file)) cachedFiles.set(file, { size: stat.size, time: stat.mtimeMs });
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }));
      }
      indexLoaded = true;
    }
    let bytes = 0;
    for (const entry of cachedFiles.values()) bytes += entry.size;
    if (cachedFiles.size <= maxEntries && bytes <= maxBytes) return;
    // Leave room for new thumbnails so eviction does not run on every small batch.
    const targetEntries = Math.ceil(maxEntries * 0.9);
    const targetBytes = Math.ceil(maxBytes * 0.9);
    const oldest = [...cachedFiles.entries()].sort((a, b) => a[1].time - b[1].time);
    for (const [file, entry] of oldest) {
      if (cachedFiles.size <= targetEntries && bytes <= targetBytes) break;
      // A concurrent read/write may have refreshed this file after the snapshot.
      if (cachedFiles.get(file) !== entry) continue;
      cachedFiles.delete(file);
      bytes -= entry.size;
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  function schedulePrune() {
    pruneRequested = true;
    if (pruning) return;
    // Coalesce requests during a busy burst instead of queuing full cache scans.
    pruning = (async () => {
      while (pruneRequested) {
        pruneRequested = false;
        await prune();
      }
    })().catch(console.error).finally(() => { pruning = null; });
  }

  async function write(filePath, version, bytes) {
    const current = await describe(filePath);
    if (current.version !== version) return false;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 8 * 1024 * 1024) throw new Error('不正なサムネイルです。');
    await fs.mkdir(cacheDirectory(), { recursive: true });
    const temporary = `${current.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes);
      // 生成中に元画像が変更された場合は次の生成に任せる。
      if ((await describe(filePath)).version !== version) return false;
      await fs.rename(temporary, current.file);
      cachedFiles.set(current.file, { size: bytes.byteLength, time: Date.now() });
    } finally {
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    if (++writes % 32 === 0) {
      schedulePrune();
    }
    return true;
  }

  return { read, write };
}

module.exports = { createThumbnailStore };
