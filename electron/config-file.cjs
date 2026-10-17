const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

// Keep the previous config intact if writing the replacement fails.
async function writeConfigFile(filePath, data) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT')
        console.error('設定の一時ファイルを削除できませんでした:', error);
    });
  }
}

module.exports = { writeConfigFile };
