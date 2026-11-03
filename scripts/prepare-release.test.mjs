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
  test(`${mode} only promotes after verification and rolls back failures`, () => {
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
      const base = git('rev-parse', 'HEAD');
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
              GITHUB_SHA: base,
              RELEASE_BUNDLE: path.join(root, 'source.bundle'),
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
      assert.equal(git('rev-parse', 'origin/main'), base);
      assert.equal(git('ls-remote', 'origin', `refs/tags/${tag}`), '');
      // A separate runner can consume the candidate without any published ref.
      const consumer = path.join(root, 'consumer');
      git('clone', path.join(root, 'source.bundle'), consumer);
      assert.equal(git('-C', consumer, 'rev-parse', `${tag}^{commit}`), released);
      git('-C', consumer, 'checkout', '--detach', released);
      assert.equal(JSON.parse(readFileSync(path.join(consumer, 'package.json'))).version, version);
      const finalize = (action, runId = '12345') =>
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL('./finalize-release.mjs', import.meta.url)), action],
          {
            cwd: checkout,
            stdio: 'pipe',
            env: {
              ...process.env,
              GITHUB_ACTIONS: 'true',
              GITHUB_RUN_ID: runId,
              GITHUB_REPOSITORY: '',
              RELEASE_BASE: base,
              RELEASE_SHA: released,
              RELEASE_TAG: tag,
              GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'),
            },
          },
        );
      // A failed verify/build requires no cleanup: neither ref has been published.
      finalize('rollback');
      assert.equal(git('rev-parse', 'origin/main'), base);
      git('tag', '-d', tag);
      run();
      assert.equal(git('rev-parse', `${tag}^{commit}`), released);
      finalize('promote');
      assert.equal(git('rev-parse', 'origin/main'), released);
      assert.throws(() => finalize('rollback', 'another-run'));
      finalize('rollback');
      assert.equal(git('rev-parse', 'origin/main'), base);
      assert.equal(git('ls-remote', 'origin', `refs/tags/${tag}`), '');
      // Simulate a fresh retry after publication failure, including tag cleanup.
      git('tag', '-d', tag);
      run();
      finalize('promote');
      finalize('promote');
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
      assert.throws(() => finalize('rollback'));
      assert.equal(git('rev-parse', 'origin/main'), latest);
      // With no published tag, a changed main must also prevent promotion.
      git('push', 'origin', `:refs/tags/${tag}`);
      assert.throws(() => finalize('promote'));
      assert.equal(git('ls-remote', 'origin', `refs/tags/${tag}`), '');
      assert.equal(git('rev-parse', 'origin/main'), latest);
      assert.equal(
        readFileSync(output, 'utf8'),
        `tag=${tag}\nsha=${released}\nbase=${base}\n`.repeat(4),
      );
      if (mode === 'initial') assert.throws(() => run('67890'));
    } finally {
      // Only the freshly-created test directory under the OS temporary directory.
      assert.equal(path.dirname(root), path.resolve(tmpdir()));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
