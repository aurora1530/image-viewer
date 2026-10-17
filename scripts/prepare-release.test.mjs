import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { nextVersion } from './prepare-release.mjs';

test('increments stable semantic versions and rejects malformed versions', () => {
  assert.equal(nextVersion('1.9.9', 'patch'), '1.9.10');
  assert.equal(nextVersion('1.9.9', 'minor'), '1.10.0');
  assert.equal(nextVersion('1.9.9', 'major'), '2.0.0');
  for (const version of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta.1', '9007199254740992.0.0'])
    assert.throws(() => nextVersion(version, 'patch'));
  assert.throws(() => nextVersion('1.0.0', 'invalid'));
  assert.equal(nextVersion('1.0.0', 'initial'), '1.0.0');
  assert.throws(() => nextVersion('1.0.1', 'initial'));
  assert.throws(() => nextVersion('1.0.0', 'initial', ['v0.9.0']));
  assert.throws(() => nextVersion('1.0.0', 'initial', ['v1.0.0']));
});

for (const mode of ['minor', 'initial']) {
  test(`re-running ${mode} reuses its tag, even after main has advanced`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'image-viewer-release-test-'));
    const checkout = path.join(root, 'checkout');
    const remote = path.join(root, 'remote.git');
    mkdirSync(checkout);
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: checkout,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HUSKY: '0', GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config') },
      }).trim();
    try {
      git('init', '--bare', remote);
      git('init', '-b', 'main');
      git('config', 'user.name', 'Release test');
      git('config', 'user.email', 'test@example.invalid');
      const pkg = { name: 'test', version: mode === 'initial' ? '1.0.0' : '1.2.3' };
      const version = mode === 'initial' ? '1.0.0' : '1.3.0';
      const tag = `v${version}`;
      writeFileSync(path.join(checkout, 'package.json'), JSON.stringify(pkg));
      writeFileSync(
        path.join(checkout, 'package-lock.json'),
        JSON.stringify({
          version: pkg.version,
          packages: { '': pkg },
        }),
      );
      git('add', '.');
      git('commit', '-m', 'initial');
      git('remote', 'add', 'origin', remote);
      git('push', '-u', 'origin', 'main');
      const output = path.join(root, 'output');
      const run = (runId = '12345') =>
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL('./prepare-release.mjs', import.meta.url)), mode],
          {
            cwd: checkout,
            stdio: 'pipe',
            env: {
              ...process.env,
              HUSKY: '0',
              GITHUB_ACTIONS: 'true',
              GITHUB_RUN_ID: runId,
              GITHUB_REF: 'refs/heads/main',
              GITHUB_OUTPUT: output,
              GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'),
            },
          },
        );
      run();
      const released = git('rev-parse', `${tag}^{commit}`);
      assert.equal(git('rev-list', '--count', released), mode === 'initial' ? '1' : '2');
      assert.equal(JSON.parse(readFileSync(path.join(checkout, 'package.json'))).version, version);
      assert.equal(
        JSON.parse(readFileSync(path.join(checkout, 'package-lock.json'))).packages[''].version,
        version,
      );
      assert.equal(git('rev-parse', 'origin/main'), released);
      git('switch', 'main');
      git('merge', '--ff-only', 'origin/main');
      writeFileSync(path.join(checkout, 'later.txt'), 'newer main');
      git('add', '.');
      git('commit', '-m', 'later main');
      git('push', 'origin', 'main');
      const latest = git('rev-parse', 'origin/main');
      run();
      assert.equal(git('rev-parse', 'origin/main'), latest);
      assert.equal(git('tag', '--list'), tag);
      assert.equal(
        readFileSync(output, 'utf8'),
        `tag=${tag}\nsha=${released}\ntag=${tag}\nsha=${released}\n`,
      );
      if (mode === 'initial') assert.throws(() => run('67890'));
    } finally {
      // Only the freshly-created test directory under the OS temporary directory.
      assert.equal(path.dirname(root), path.resolve(tmpdir()));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
