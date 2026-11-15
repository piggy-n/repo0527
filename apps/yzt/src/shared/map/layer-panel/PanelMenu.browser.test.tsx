import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import type { MenuPoint } from './CatalogTree';
import { PanelMenu, type PanelMenuEntry } from './PanelMenu';

// 真实浏览器才拒绝聚焦 visibility:hidden 的元素，jsdom 不管（2026-11-14 审查发现，F09）：
// 菜单先隐藏着量尺寸，显示以后焦点才能进去

const ITEMS: PanelMenuEntry[] = [
  { key: 'locate', label: '定位', disabled: true, hint: '切换到三维后可用' },
  { key: 'legend', label: '图例' },
  'divider',
  { key: 'remove', label: '移除', danger: true }
];

// 页面上有一个打开菜单的按钮（焦点先在它上面），菜单的开关和位置由用例改
function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const origin = host.appendChild(document.createElement('button'));
  origin.textContent = '打开菜单的行';
  origin.focus();
  const open = ref(true);
  const point = ref<MenuPoint>({ x: 40, y: 40 });
  const errors: unknown[] = [];
  const wrapper = mount(
    defineComponent(() => () => (
      <PanelMenu open={open.value} point={point.value} items={ITEMS} label="当前图层的菜单" returnFocus={() => origin} />
    )),
    { attachTo: host, global: { config: { errorHandler: error => errors.push(error) } } }
  );
  return {
    origin,
    open,
    point,
    errors,
    menu: () => document.querySelector<HTMLElement>('[data-panel-menu]'),
    item: (key: string) => document.querySelector<HTMLButtonElement>(`[data-menu-item="${key}"]`),
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 等若干个动画帧：之前排下的 DOM 更新和微任务都已经完成
function frames(count: number): Promise<void> {
  return new Promise(resolve => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}

const visibility = (element: HTMLElement | null) => (element ? getComputedStyle(element).visibility : null);

describe('PanelMenu（真实浏览器的聚焦）', () => {
  it('打开以后菜单显示出来，焦点在第一个能用的项上，方向键在能用的项之间移动', async () => {
    using ctx = setup();
    await frames(2);

    expect(visibility(ctx.menu())).toBe('visible');
    expect(document.activeElement).toBe(ctx.item('legend'));
    ctx.menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(ctx.item('remove'));
    ctx.menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(ctx.item('legend'));
  });

  it('开着时换位置（在另一行上再按右键）：重新量过、显示以后焦点仍在第一个能用的项上', async () => {
    using ctx = setup();
    await frames(2);
    ctx.item('remove')?.focus();

    ctx.point.value = { x: 120, y: 160 };
    await frames(2);
    expect(visibility(ctx.menu())).toBe('visible');
    expect(ctx.menu()?.style.top).toBe('160px');
    expect(document.activeElement).toBe(ctx.item('legend'));
  });

  it('刚打开、还没显示就关掉：不报错，焦点留在原处', async () => {
    using ctx = setup();
    await nextTick();
    ctx.open.value = false;
    await frames(2);

    expect(ctx.menu()).toBeNull();
    expect(document.activeElement).toBe(ctx.origin);
    expect(ctx.errors).toStrictEqual([]);
  });
});
