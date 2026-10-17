import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { serveMedia } = createRequire(import.meta.url)('../../electron/media-protocol.cjs') as {
  serveMedia(request: Request, filePath: string): Promise<Response>;
};
let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'image-viewer-media-'));
  file = path.join(directory, 'clip.webm');
  await writeFile(file, '0123456789');
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('local media byte ranges', () => {
  it('streams the complete file and advertises seeking support', async () => {
    const response = await serveMedia(new Request('http://localhost/clip'), file);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-type')).toBe('video/webm');
    expect(response.headers.get('content-length')).toBe('10');
    expect(await response.text()).toBe('0123456789');
  });

  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
    ['bytes=-99', '0123456789', 'bytes 0-9/10'],
  ])('serves %s without sending the rest of the file', async (range, body, contentRange) => {
    const response = await serveMedia(
      new Request('http://localhost/clip', { headers: { Range: range } }),
      file,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(contentRange);
    expect(response.headers.get('content-length')).toBe(String(body.length));
    expect(await response.text()).toBe(body);
  });

  it.each([
    'bytes=10-',
    'bytes=5-2',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,4-5',
    'bytes=9007199254740992-',
  ])('rejects unavailable or invalid ranges: %s', async (range) => {
    const response = await serveMedia(
      new Request('http://localhost/clip', { headers: { Range: range } }),
      file,
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    expect(await response.text()).toBe('');
  });

  it('returns metadata without streaming a body for HEAD', async () => {
    const response = await serveMedia(
      new Request('http://localhost/clip', { method: 'HEAD' }),
      file,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.body).toBeNull();
  });

  it('handles empty files and rejects a range into an empty file', async () => {
    await writeFile(file, '');
    const response = await serveMedia(new Request('http://localhost/clip'), file);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('0');
    expect(await response.text()).toBe('');
    const partial = await serveMedia(
      new Request('http://localhost/clip', { headers: { Range: 'bytes=0-' } }),
      file,
    );
    expect(partial.status).toBe(416);
    expect(partial.headers.get('content-range')).toBe('bytes */0');
  });
});
