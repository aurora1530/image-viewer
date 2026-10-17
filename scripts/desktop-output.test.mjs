import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findDesktopExecutable, publishDesktopOutput } from './desktop-output.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'image-viewer-output-test-'));
  // root is allocated by mkdtemp inside the OS temporary directory.
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const stage = path.join(root, 'stage');
  const release = path.join(root, 'release');
  await mkdir(path.join(stage, 'win-unpacked', 'resources'), { recursive: true });
  await writeFile(path.join(stage, 'win-unpacked', 'ローカル画像ビューワー.exe'), 'executable');
  await writeFile(path.join(stage, 'win-unpacked', 'resources', 'app.asar'), 'new app');
  await writeFile(path.join(stage, 'setup.exe'), 'new installer');
  await writeFile(path.join(stage, 'latest.yml'), 'release metadata');
  return { stage, release };
}

test('repeated local builds preserve previous outputs and select the latest completed build', async (t) => {
  const { stage, release } = await fixture(t);
  await mkdir(path.join(release, 'win-unpacked', 'resources'), { recursive: true });
  const legacy = path.join(release, 'win-unpacked', 'resources', 'app.asar');
  await writeFile(legacy, 'legacy app');
  await writeFile(path.join(release, 'setup.exe'), 'legacy installer');
  const first = await publishDesktopOutput(stage, release);
  assert.equal(await findDesktopExecutable(release), first.executable);
  await writeFile(path.join(stage, 'win-unpacked', 'resources', 'app.asar'), 'second app');
  const second = await publishDesktopOutput(stage, release);
  assert.notEqual(first.buildRoot, second.buildRoot);
  assert.equal(await findDesktopExecutable(release), second.executable);
  assert.equal(await readFile(legacy, 'utf8'), 'legacy app');
  assert.equal(await readFile(path.join(release, 'setup.exe'), 'utf8'), 'legacy installer');
  assert.equal(
    await readFile(path.join(first.buildRoot, 'win-unpacked', 'resources', 'app.asar'), 'utf8'),
    'new app',
  );
  assert.equal(
    await readFile(path.join(second.buildRoot, 'win-unpacked', 'resources', 'app.asar'), 'utf8'),
    'second app',
  );
  assert.equal(await readFile(path.join(second.buildRoot, 'setup.exe'), 'utf8'), 'new installer');
  // An interrupted newer copy must never be launched by the smoke test.
  await mkdir(path.join(release, 'builds', '9999-incomplete', 'win-unpacked'), { recursive: true });
  await writeFile(
    path.join(release, 'builds', '9999-incomplete', 'win-unpacked', 'ローカル画像ビューワー.exe'),
    'incomplete',
  );
  assert.equal(await findDesktopExecutable(release), second.executable);
});

test('release mode also exports the files expected by the release workflow', async (t) => {
  const { stage, release } = await fixture(t);
  const output = await publishDesktopOutput(stage, release, { release: true });
  assert.equal(await readFile(path.join(release, 'setup.exe'), 'utf8'), 'new installer');
  assert.equal(await readFile(path.join(release, 'latest.yml'), 'utf8'), 'release metadata');
  assert.equal(await findDesktopExecutable(release), output.executable);
});

test('fails clearly when no completed desktop build exists', async (t) => {
  const { release } = await fixture(t);
  await assert.rejects(findDesktopExecutable(release), /desktop:pack/);
});

test(
  'Windows builds succeed while previous app.asar and installer files deny deletion and writing',
  {
    skip: process.platform !== 'win32',
    timeout: 20_000,
  },
  async (t) => {
    const { stage, release } = await fixture(t);
    const first = await publishDesktopOutput(stage, release);
    const locked = [
      path.join(first.buildRoot, 'win-unpacked', 'resources', 'app.asar'),
      path.join(first.buildRoot, 'setup.exe'),
      path.join(release, 'win-unpacked', 'resources', 'app.asar'),
    ];
    await mkdir(path.dirname(locked[2]), { recursive: true });
    await writeFile(locked[2], 'locked legacy app');
    const holder = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
    $ErrorActionPreference = 'Stop'
    $streams = @()
    try {
      foreach ($lockPath in (ConvertFrom-Json $env:IMAGE_VIEWER_TEST_LOCKS)) {
        $streams += [System.IO.File]::Open($lockPath, 'Open', 'Read', 'Read')
      }
      [Console]::WriteLine('locked')
      [Console]::ReadLine() | Out-Null
    } finally {
      foreach ($stream in $streams) { $stream.Dispose() }
    }
  `,
      ],
      {
        env: { ...process.env, IMAGE_VIEWER_TEST_LOCKS: JSON.stringify(locked) },
        windowsHide: true,
      },
    );
    const closed = once(holder, 'close');
    let errors = '';
    holder.stderr.on('data', (data) => {
      errors += data;
    });
    try {
      await Promise.race([
        once(holder.stdout, 'data').then(([data]) => assert.match(String(data), /locked/)),
        closed.then(([code]) => {
          throw new Error(`Lock holder exited: ${code}: ${errors}`);
        }),
      ]);
      for (const file of locked) {
        await assert.rejects(unlink(file), (error) =>
          ['EBUSY', 'EPERM', 'EACCES'].includes(error.code),
        );
      }
      const second = await publishDesktopOutput(stage, release);
      assert.equal(await findDesktopExecutable(release), second.executable);
      assert.equal(await readFile(locked[0], 'utf8'), 'new app');
      assert.equal(await readFile(locked[2], 'utf8'), 'locked legacy app');
    } finally {
      holder.stdin.end('\n');
      await closed;
    }
  },
);
