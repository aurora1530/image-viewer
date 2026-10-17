import { spawnSync } from 'node:child_process';

const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump) || process.argv.length !== 3) {
  console.error('Usage: npm run release -- patch|minor|major');
  process.exit(1);
}
const result = spawnSync(
  'gh',
  [
    'workflow',
    'run',
    'release.yml',
    '--repo',
    'aurora1530/image-viewer',
    '--ref',
    'main',
    '-f',
    `bump=${bump}`,
  ],
  { stdio: 'inherit', shell: false },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  'Release requested: https://github.com/aurora1530/image-viewer/actions/workflows/release.yml',
);
