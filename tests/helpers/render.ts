import { afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const mounted: Array<() => void> = [];
export function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const update = (next: ReactNode) => flushSync(() => root.render(next));
  const unmount = () => {
    flushSync(() => root.unmount());
    container.remove();
  };
  mounted.push(unmount);
  update(node);
  return { container, update };
}
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});
