import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createMemoryStore } from '../../storage/key-value-store';
import { createTestPreferenceScope } from '../../storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '../../storage/use-preference';
import { useBoundaries } from './useBoundaries';

const KEY = 'zhangsan/boundaries';

function setup(store = createMemoryStore()) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const boundaries = effect.run(() => useBoundaries({ preferences: scope }));
  if (!boundaries) {
    throw new Error('边界的拥有者没有创建');
  }
  return { boundaries, store, [Symbol.dispose]: () => effect.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('边界的偏好', () => {
  it('恢复上次的级别和透明度；推导随之变化', async () => {
    const stored = { version: 1, value: { visible: { province: false, city: true, county: true }, opacity: 0.5 } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.boundaries.visible.value).toStrictEqual({ province: false, city: true, county: true });
    expect(ctx.boundaries.opacity.value).toBe(0.5);
    expect(ctx.boundaries.deriveGroup().layers.map(layer => layer.id)).toStrictEqual([
      'boundaries-county',
      'boundaries-city'
    ]);
  });

  it('打开级别、改透明度后防抖写入', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.boundaries.setVisible('county', true);
    ctx.boundaries.setOpacity(0.8);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: { visible: { province: true, city: false, county: true }, opacity: 0.8 }
    });
  });

  it('格式不对（缺少级别）：当作没有存过，只显示省界', async () => {
    const stored = { version: 1, value: { visible: { province: false, city: true }, opacity: 0.5 } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.boundaries.visible.value).toStrictEqual({ province: true, city: false, county: false });
  });

  it('不传偏好的范围：不读不写，和原来一样', () => {
    const boundaries = useBoundaries();

    expect(boundaries.visible.value).toStrictEqual({ province: true, city: false, county: false });
  });
});
