import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { required } from '../../testing/required';
import { type MapOptionsContext, MapOptionsPopover } from './MapOptionsPopover';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 浮层开关由页面持有；内容拿到的操作留给用例调用
function setup() {
  const open = ref(true);
  const changes: boolean[] = [];
  let context: MapOptionsContext | null = null;
  mount(
    defineComponent(() => {
      provideMap({ groups: [], camera: CAMERA });
      return () => (
        <MapOptionsPopover
          name="sample"
          open={open.value}
          onUpdate:open={(value: boolean) => {
            changes.push(value);
            open.value = value;
          }}
        >
          {{
            reference: () => [<button type="button">入口</button>],
            default: (current: MapOptionsContext) => {
              context = current;
              return [<div data-sample />];
            }
          }}
        </MapOptionsPopover>
      );
    }),
    { attachTo: document.body }
  );
  const hold = (closeLayer: (() => void) | null) => required(context, '浮层的内容还没有显示').hold(closeLayer);
  return { open, changes, hold };
}

// 页面上浮层以外的地方（如盖住整页的大图预览）
function clickOutside() {
  const outside = document.createElement('div');
  document.body.append(outside);
  outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  outside.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  outside.remove();
}

// 从页面里的元素按下，和真实的按键一样经过 document 的捕获和冒泡
const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MapOptionsPopover', () => {
  it('内容打开了盖住整页的一层（hold）时，单击哪里都不关浮层；Esc 只关那一层，页面上别的 Esc 监听收不到；放开后照常关', async () => {
    const { changes, hold } = setup();
    await flushPromises();
    const closeLayer = vi.fn<() => void>();
    // 页面上别的浮层在 document 的冒泡阶段听 Esc（如资源图层面板的 LayerPopover）
    const others: string[] = [];
    const listener = (event: KeyboardEvent) => others.push(event.key);
    document.addEventListener('keydown', listener);

    hold(closeLayer);
    await flushPromises();
    clickOutside();
    pressEscape();
    expect(closeLayer).toHaveBeenCalledTimes(1);
    expect(others).toStrictEqual([]);
    expect(changes).toStrictEqual([]);

    hold(null);
    await flushPromises();
    pressEscape();
    expect(closeLayer).toHaveBeenCalledTimes(1);
    expect(changes).toStrictEqual([false]);
    document.removeEventListener('keydown', listener);
  });

  it('浮层关上时一起放开：再打开后单击外部照常关', async () => {
    const { open, changes, hold } = setup();
    await flushPromises();
    hold(() => undefined);

    open.value = false;
    await flushPromises();
    open.value = true;
    await flushPromises();
    clickOutside();

    expect(changes).toStrictEqual([false]);
  });
});
