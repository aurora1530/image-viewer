import { cp, mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const executableName = 'ローカル画像ビューワー.exe';
const completeFile = '.complete';

// Never replace an unpacked application: editors and running processes can hold app.asar open.
export async function publishDesktopOutput(stageRoot, releaseRoot, { release = false } = {}) {
  const buildsRoot = path.join(releaseRoot, 'builds');
  await mkdir(buildsRoot, { recursive: true });
  const prefix = new Date().toISOString().replace(/[:.]/g, '-');
  const buildRoot = await mkdtemp(path.join(buildsRoot, `${prefix}-`));
  for (const entry of await readdir(stageRoot)) {
    await cp(path.join(stageRoot, entry), path.join(buildRoot, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  const executable = path.join(buildRoot, 'win-unpacked', executableName);
  if (!(await stat(executable)).isFile())
    throw new Error(`Missing desktop executable: ${executable}`);

  // CI uploads release/*; local builds keep every artifact in their own directory.
  if (release) {
    for (const entry of await readdir(stageRoot, { withFileTypes: true })) {
      if (entry.isFile())
        await cp(path.join(stageRoot, entry.name), path.join(releaseRoot, entry.name));
    }
  }
  await writeFile(path.join(buildRoot, completeFile), '');
  return { buildRoot, executable };
}

export async function findDesktopExecutable(releaseRoot) {
  const buildsRoot = path.join(releaseRoot, 'builds');
  let entries;
  try {
    entries = await readdir(buildsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    entries = [];
  }
  for (const entry of entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))) {
    const buildRoot = path.join(buildsRoot, entry.name);
    try {
      await stat(path.join(buildRoot, completeFile));
      const executable = path.join(buildRoot, 'win-unpacked', executableName);
      if ((await stat(executable)).isFile()) return executable;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(
    '完成したデスクトップ版がありません。npm run desktop:pack または desktop:build を実行してください。',
  );
}
