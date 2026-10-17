import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishDesktopOutput } from './desktop-output.mjs';

const projectRoot = process.cwd();
const releaseRoot = path.resolve(projectRoot, 'release');
const stageRoot = await mkdtemp(path.join(tmpdir(), 'image-viewer-build-'));
const targetArgs = process.argv.includes('--dir')
  ? ['--win', '--dir']
  : ['--win', 'nsis', 'portable'];
targetArgs.push('--x64', '--publish', 'never');
if (!process.argv.includes('--release')) {
  targetArgs.push(
    '--config.nsis.artifactName=image-viewer-windows-${arch}-setup.${ext}',
    '--config.portable.artifactName=image-viewer-windows-${arch}-portable.${ext}',
  );
}

function assertInside(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unexpected output path: ${target}`);
  }
}

assertInside(projectRoot, releaseRoot);
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
  const { buildRoot, executable } = await publishDesktopOutput(stageRoot, releaseRoot, {
    release: process.argv.includes('--release'),
  });
  console.log(`Desktop build completed: ${buildRoot}`);
  console.log(`Desktop executable: ${executable}`);
} finally {
  await rm(stageRoot, { recursive: true, force: true }).catch((error) => {
    console.warn(`Could not remove temporary build files: ${stageRoot}`, error);
  });
}
