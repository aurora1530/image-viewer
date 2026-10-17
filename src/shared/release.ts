export const appVersion = __APP_VERSION__;
export const releasesUrl = 'https://github.com/aurora1530/image-viewer/releases';
export const releaseUrl = `${releasesUrl}/tag/v${appVersion}`;

export type UpdateState = {
  status:
    'idle' | 'manual' | 'checking' | 'current' | 'downloading' | 'ready' | 'available' | 'error';
  version: string | null;
};

export function isNewerVersion(candidate: string, current: string) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(candidate) || !stable.test(current)) return false;
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  if (![...a, ...b].every(Number.isSafeInteger)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
