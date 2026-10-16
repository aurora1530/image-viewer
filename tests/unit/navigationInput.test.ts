import { describe, expect, it, vi } from 'vitest';
import { createNavigationInput } from '../../src/navigationInput';

describe('mouse navigation input', () => {
  it.each(['mouse', 'command'] as const)('accepts %s without the other notification', source => {
    const navigate = vi.fn();
    const input = createNavigationInput(navigate);
    input('back', source);
    input('forward', source);
    expect(navigate.mock.calls).toEqual([['back'], ['forward']]);
  });

  it.each(['mouse', 'command'] as const)('pairs duplicate notifications with %s arriving first', first => {
    const navigate = vi.fn();
    const input = createNavigationInput(navigate, () => 100);
    const second = first === 'mouse' ? 'command' : 'mouse';
    for (let click = 0; click < 2; click++) {
      input('back', first);
      input('back', second);
    }
    expect(navigate.mock.calls).toEqual([['back'], ['back']]);
  });

  it('keeps rapid clicks from the same source and later independent commands', () => {
    const navigate = vi.fn();
    let time = 0;
    const input = createNavigationInput(navigate, () => time);
    input('back', 'mouse');
    input('back', 'mouse');
    time = 300;
    input('back', 'command');
    expect(navigate).toHaveBeenCalledTimes(3);
  });
});
