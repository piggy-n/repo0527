import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import { useResourcePanelLayout } from './useResourcePanelLayout';

const LAYOUT_KEY = 'zhangsan/resource-panel';

function setup(store = createMemoryStore()) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const owners = effect.run(() => ({
    layout: useResourcePanelLayout({ preferences: scope })
  }));
  if (!owners) {
    throw new Error('拥有者没有创建');
  }
  return { ...owners, store, [Symbol.dispose]: () => effect.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// 目录树的顺序就是叠放顺序，随资源图层的偏好记住（ADR 0118），见 resource-layers-preference.test.ts
describe('面板布局的偏好', () => {
  it('恢复上次的收起状态和分割线的位置', async () => {
    using ctx = setup(
      createMemoryStore({
        [LAYOUT_KEY]: { version: 1, value: { collapsed: true, checkedRatio: 0.6 } }
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.layout.collapsed.value).toBe(true);
    expect(ctx.layout.checkedRatio.value).toBe(0.6);
  });

  it('调整后防抖写入', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.layout.setCollapsed(true);
    ctx.layout.setCheckedRatio(0.3);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.store.entries.get(LAYOUT_KEY)).toStrictEqual({
      version: 1,
      value: { collapsed: true, checkedRatio: 0.3 }
    });
  });

  it('格式不对时当作没有存过：越界的比例', async () => {
    using ctx = setup(
      createMemoryStore({
        [LAYOUT_KEY]: { version: 1, value: { collapsed: true, checkedRatio: 1.5 } }
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.layout.collapsed.value).toBe(false);
    expect(ctx.layout.checkedRatio.value).toBe(0.4);
  });

  it('不合法的比例直接抛错，状态不变', () => {
    using ctx = setup();

    expect(() => ctx.layout.setCheckedRatio(1.2)).toThrow(RangeError);
    expect(() => ctx.layout.setCheckedRatio(Number.NaN)).toThrow(RangeError);
    expect(ctx.layout.checkedRatio.value).toBe(0.4);
  });
});
