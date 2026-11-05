// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { useCanvasHolder } from './useCanvasHolder';

describe('useCanvasHolder', () => {
  it('换手的那一轮谁都不放，下一轮才交给新的一边', async () => {
    const open = ref(false);
    const holder = useCanvasHolder(open);
    expect(holder.value).toBe('result');

    open.value = true;
    expect(holder.value).toBeNull();
    await nextTick();
    expect(holder.value).toBe('scope');

    open.value = false;
    expect(holder.value).toBeNull();
    await nextTick();
    expect(holder.value).toBe('result');
  });

  it('一开始就开着时是弹窗的', () => {
    expect(useCanvasHolder(ref(true)).value).toBe('scope');
  });

  it('等待期间又开关过：以最新的为准', async () => {
    const open = ref(false);
    const holder = useCanvasHolder(open);
    open.value = true;
    open.value = false;
    await nextTick();
    expect(holder.value).toBe('result');
  });
});
