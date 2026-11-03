import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function finalizeRelease(action) {
  const {
    GITHUB_ACTIONS,
    GITHUB_RUN_ID,
    GITHUB_REPOSITORY,
    RELEASE_TAG,
    RELEASE_SHA,
    RELEASE_BASE,
  } = process.env;
  if (
    GITHUB_ACTIONS !== 'true' ||
    !GITHUB_RUN_ID ||
    !/^v\d+\.\d+\.\d+$/.test(RELEASE_TAG ?? '') ||
    !/^[a-f0-9]{40}$/.test(RELEASE_SHA ?? '') ||
    !/^[a-f0-9]{40}$/.test(RELEASE_BASE ?? '')
  )
    throw new Error('Expected the Release workflow candidate');
  if (!['promote', 'rollback'].includes(action)) throw new Error('Invalid release action');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const ref = `refs/tags/${RELEASE_TAG}`;
  git('fetch', 'origin', 'main', '--tags');
  const remoteTag = git('ls-remote', 'origin', ref).split('\t')[0];
  if (action === 'rollback' && !remoteTag) return;
  if (git('rev-parse', `${ref}^{commit}`) !== RELEASE_SHA)
    throw new Error('Candidate tag does not match the verified source');
  if (
    git('for-each-ref', '--format=%(contents:subject)', ref) !==
    `Release workflow run ${GITHUB_RUN_ID}`
  )
    throw new Error('Tag belongs to a different workflow run');
  const main = git('rev-parse', 'origin/main');
  if (action === 'promote') {
    if (remoteTag) {
      git('merge-base', '--is-ancestor', RELEASE_SHA, main);
      return;
    }
    if (main !== RELEASE_BASE)
      throw new Error('Main advanced during verification; start a new release');
    git('push', '--atomic', 'origin', `${RELEASE_SHA}:refs/heads/main`, `${ref}:${ref}`);
    return;
  }
  // Never discard changes pushed by somebody else, even during failure cleanup.
  if (main !== RELEASE_SHA)
    throw new Error('Cannot roll back: main advanced after promotion. Manual recovery is required');
  if (GITHUB_REPOSITORY) {
    const releases = JSON.parse(
      execFileSync('gh', ['api', `repos/${GITHUB_REPOSITORY}/releases?per_page=100`], {
        encoding: 'utf8',
      }),
    );
    if (!Array.isArray(releases)) throw new Error('Expected a release list');
    const release = releases.find(
      (entry) => entry !== null && typeof entry === 'object' && entry.tag_name === RELEASE_TAG,
    );
    if (release) {
      if (!Number.isSafeInteger(release.id)) throw new Error('Expected a release ID');
      execFileSync('gh', [
        'api',
        '-X',
        'DELETE',
        `repos/${GITHUB_REPOSITORY}/releases/${release.id}`,
      ]);
    }
  }
  git(
    'push',
    '--atomic',
    `--force-with-lease=refs/heads/main:${RELEASE_SHA}`,
    `--force-with-lease=${ref}:${remoteTag}`,
    'origin',
    `${RELEASE_BASE}:refs/heads/main`,
    `:${ref}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  finalizeRelease(process.argv[2]);
