const fs = require('node:fs/promises');
const path = require('node:path');

async function findFirstFile(directory, names, requireAllowed) {
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    !Array.isArray(names) ||
    names.length > 7 ||
    !names.every(
      (name) =>
        typeof name === 'string' &&
        name.length > 0 &&
        name !== '.' &&
        name !== '..' &&
        !/[\\/\0:]/.test(name),
    )
  )
    throw new Error('不正な候補ファイルです。');

  const parent = requireAllowed(directory);
  async function exists(name) {
    const file = requireAllowed(path.join(parent, name));
    try {
      return (await fs.stat(file)).isFile();
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
  }
  if (!names.length) return null;
  // Keep the common first-candidate hit fast; batch only after it misses.
  if (await exists(names[0])) return names[0];
  const results = await Promise.allSettled(names.slice(1).map(exists));
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'rejected') throw result.reason;
    if (result.value) return names[index + 1];
  }
  return null;
}

module.exports = { findFirstFile };
