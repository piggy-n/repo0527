import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, KeepAlive, nextTick, type Ref, ref } from 'vue';
import { usePageActive } from './usePageActive';

describe('usePageActive', () => {
  it('KeepAlive 停用时为 false，激活时回到 true', async () => {
    let active: Readonly<Ref<boolean>> | undefined;
    const Child = defineComponent({
      name: 'Child',
      setup() {
        active = usePageActive();
        return () => <span />;
      }
    });
    const shown = ref(true);
    mount(defineComponent(() => () => <KeepAlive>{shown.value ? <Child /> : null}</KeepAlive>));
    expect(active?.value).toBe(true);

    shown.value = false;
    await nextTick();
    expect(active?.value).toBe(false);
    shown.value = true;
    await nextTick();

    expect(active?.value).toBe(true);
  });

  it('不在 KeepAlive 里时一直为 true', () => {
    let active: Readonly<Ref<boolean>> | undefined;
    mount(
      defineComponent(() => {
        active = usePageActive();
        return () => <span />;
      })
    );

    expect(active?.value).toBe(true);
  });
});
