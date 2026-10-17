import { afterEach } from 'vitest';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { ApplicationProvider } from '../../src/app/ApplicationProvider';
import type { Application } from '../../src/app/createApplication';
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

export function renderApplication(node: ReactNode, application: Application) {
  const wrap = (child: ReactNode) =>
    createElement(ApplicationProvider, { application, children: child });
  const mounted = render(wrap(node));
  return { ...mounted, update: (next: ReactNode) => mounted.update(wrap(next)) };
}
