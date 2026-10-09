import { describe, expect, it } from 'vitest';
import { yieldToEventLoop } from './yield';

describe('yieldToEventLoop', () => {
  it('resolves in a later task rather than with the current microtasks', async () => {
    let resolved = false;
    const waiting = (async () => {
      await yieldToEventLoop();
      resolved = true;
    })();

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    await waiting;
    expect(resolved).toBe(true);
  });
});
