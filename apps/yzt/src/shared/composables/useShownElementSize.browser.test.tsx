import { useElementSize } from '@vueuse/core';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, KeepAlive, nextTick, onActivated, ref } from 'vue';
import { useShownElementSize } from './useShownElementSize';

// 并行地图测试会占用浏览器渲染线程，给真实 ResizeObserver 留出调度时间
const resizeWait = { timeout: 3000 };

// 被 KeepAlive 缓存的页面：同时用两种方式量同一个元素，激活钩子里记下当时读到的宽度
function setup() {
  const shown = ref(true);
  const root = ref<HTMLElement>();
  const onActivatedWidths: { shown: number; native: number }[] = [];
  const read = { shown: (): number => -1, native: (): number => -1 };
  const Cached = defineComponent({
    name: 'CachedSizedPage',
    setup() {
      const shownSize = useShownElementSize(root);
      const nativeSize = useElementSize(root);
      read.shown = () => shownSize.width.value;
      read.native = () => nativeSize.width.value;
      onActivated(() => onActivatedWidths.push({ shown: read.shown(), native: read.native() }));
      return () => <div ref={root} style={{ width: '100%', height: '100%' }} />;
    }
  });
  const host = document.body.appendChild(document.createElement('div'));
  const wrapper = mount(
    defineComponent(() => () => (
      <div style={{ width: '375px', height: '700px' }}>
        <KeepAlive>{shown.value ? <Cached /> : null}</KeepAlive>
      </div>
    )),
    { attachTo: host }
  );
  return {
    shown,
    root,
    read,
    onActivatedWidths,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

describe('useShownElementSize（真实的 ResizeObserver）', () => {
  it('页面停用期间元素离开文档，量到的 0 不采用；再次激活时读到的仍是原来的尺寸（ADR 0063）', async () => {
    using env = setup();
    await expect.poll(() => env.read.shown(), resizeWait).toBe(375);

    env.shown.value = false;
    await nextTick();
    // 等原生的 useElementSize 量到 0：ResizeObserver 已经报过离开文档后的尺寸
    await expect.poll(() => env.read.native(), resizeWait).toBe(0);
    expect(env.root.value?.isConnected).toBe(false);
    expect(env.read.shown()).toBe(375);
    env.shown.value = true;
    await nextTick();

    // 再次激活的那一刻，ResizeObserver 还没重新量：原生的仍是 0，这里是原来的 375
    expect(env.onActivatedWidths.at(-1)).toStrictEqual({ shown: 375, native: 0 });
    await expect.poll(() => env.read.native(), resizeWait).toBe(375);
    expect(env.read.shown()).toBe(375);
  }, 10000);
});
