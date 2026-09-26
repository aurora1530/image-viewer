import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const releaseRoot = path.resolve(projectRoot, 'release');
const stageRoot = await mkdtemp(path.join(tmpdir(), 'image-viewer-build-'));
const targetWin = path.resolve(releaseRoot, 'win-unpacked');
const stagedWin = path.join(stageRoot, 'win-unpacked');
const targetArgs = process.argv.includes('--dir') ? ['--dir'] : ['--win', 'nsis', 'portable'];

function assertInside(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unexpected output path: ${target}`);
  }
}

assertInside(projectRoot, releaseRoot);
assertInside(projectRoot, targetWin);
assertInside(tmpdir(), stageRoot);

async function runBuilder() {
  const cli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');
  const args = [cli, ...targetArgs, `--config.directories.output=${stageRoot}`];
  const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`electron-builder exited with code ${code}`);
}

try {
  await runBuilder();
  await mkdir(releaseRoot, { recursive: true });
  await rm(targetWin, { recursive: true, force: true });
  await cp(stagedWin, targetWin, { recursive: true });
  for (const entry of await readdir(stageRoot)) {
    if (entry === 'win-unpacked') continue;
    const source = path.join(stageRoot, entry);
    if ((await stat(source)).isFile()) {
      await cp(source, path.join(releaseRoot, entry), { force: true });
    }
  }
  console.log(`Desktop build completed: ${releaseRoot}`);
} finally {
  await rm(stageRoot, { recursive: true, force: true }).catch(error => {
    console.warn(`Could not remove temporary build files: ${stageRoot}`, error);
  });
}
