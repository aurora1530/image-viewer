const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function createThumbnailStore({ cacheDirectory, requireAllowed, maxEntries = 2000 }) {
  let writes = 0;
  let pruning = Promise.resolve();

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
    try { return { version, bytes: await fs.readFile(file) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { version, bytes: null }; }
  }

  async function prune() {
    const directory = cacheDirectory();
    const files = (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.webp$/.test(name));
    if (files.length <= maxEntries) return;
    const dated = await Promise.all(files.map(async name => ({ name, time: (await fs.stat(path.join(directory, name))).mtimeMs })));
    dated.sort((a, b) => a.time - b.time);
    await Promise.all(dated.slice(0, dated.length - maxEntries).map(item => fs.unlink(path.join(directory, item.name))));
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
    } finally {
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    if (++writes % 32 === 0) {
      pruning = pruning.then(prune).catch(console.error);
    }
    return true;
  }

  return { read, write };
}

module.exports = { createThumbnailStore };
