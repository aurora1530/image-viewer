import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function nextVersion(version, bump, tags = []) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(`Expected a stable semantic version: ${version}`);
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version is too large');
  if (bump === 'initial') {
    if (version !== '1.0.0' || tags.some((tag) => /^v\d+\./.test(tag)))
      throw new Error('Initial release is only available for 1.0.0 before any version tag exists');
    return version;
  }
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  if (index < 0) throw new Error(`Invalid bump: ${bump}`);
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version is too large');
  return parts.join('.');
}

export function prepareRelease(bump) {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    !process.env.GITHUB_OUTPUT ||
    !process.env.GITHUB_RUN_ID
  )
    throw new Error('Run this through the Release workflow, not in a local checkout.');
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Release must run on main');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  git('fetch', 'origin', 'main', '--tags');
  const marker = `Release workflow run ${process.env.GITHUB_RUN_ID}`;
  // Re-running a failed workflow must reuse its version and exact source commit.
  const previous = git('for-each-ref', '--format=%(refname:short)|%(contents:subject)', 'refs/tags')
    .split('\n')
    .find((line) => line.endsWith(`|${marker}`))
    ?.split('|')[0];
  let tag = previous;
  if (!tag) {
    git('switch', '--detach', 'origin/main');
    if (git('status', '--porcelain')) throw new Error('Release checkout must be clean');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const version = nextVersion(pkg.version, bump, git('tag', '--list').split('\n'));
    tag = `v${version}`;
    if (git('tag', '--list', tag)) throw new Error(`Tag already exists: ${tag}`);
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    if (bump === 'initial') {
      if (lock.version !== version || lock.packages[''].version !== version)
        throw new Error('Initial release requires matching package and lockfile versions');
    } else {
      pkg.version = lock.version = lock.packages[''].version = version;
      writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
      writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
      git('add', 'package.json', 'package-lock.json');
      // Verification is performed by the pinned verify job, without local commit hooks.
      execFileSync('git', ['commit', '-m', `chore: release ${tag}`], {
        env: { ...process.env, HUSKY: '0' },
        stdio: 'inherit',
      });
    }
    git('tag', '-a', tag, '-m', marker);
    // Reject a concurrent main update; never force-push either the branch or tag.
    git('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);
  }
  const sha = git('rev-parse', `${tag}^{commit}`);
  git('merge-base', '--is-ancestor', sha, 'origin/main');
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nsha=${sha}\n`);
  return { tag, sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  prepareRelease(process.argv[2]);
