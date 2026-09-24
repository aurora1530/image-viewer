import { readFileSync } from 'node:fs';
import { beforeEach, vi } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
if (!body) throw new Error('index.html body not found');
document.body.innerHTML = body;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = body;
  vi.restoreAllMocks();
});
