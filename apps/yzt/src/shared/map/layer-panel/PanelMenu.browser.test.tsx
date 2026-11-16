import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { required } from '../../testing/required';
import type { MenuPoint } from './CatalogTree';
import { PanelMenu, type PanelMenuEntry } from './PanelMenu';

// 真实浏览器才拒绝聚焦 visibility:hidden 的元素，jsdom 不管（2026-11-14 审查发现）：
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
      <PanelMenu open={open.value} point={point.value} items={ITEMS} label="图层的菜单" returnFocus={() => origin} />
    )),
    { attachTo: host, global: { config: { errorHandler: error => errors.push(error) } } }
  );
  return {
    origin,
    open,
    point,
    errors,
    menu: () => required(document.querySelector<HTMLElement>('[data-panel-menu]'), '菜单'),
    item: (key: string) => required(document.querySelector<HTMLButtonElement>(`[data-menu-item="${key}"]`), key),
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

const visibility = (element: HTMLElement) => getComputedStyle(element).visibility;

describe('PanelMenu（真实浏览器的聚焦）', () => {
  it('打开以后菜单显示出来，焦点在第一个能用的项上，方向键在能用的项之间移动', async () => {
    using ctx = setup();
    await frames(2);

    expect(visibility(ctx.menu())).toBe('visible');
    expect(document.activeElement).toBe(ctx.item('legend'));
    ctx.menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(ctx.item('remove'));
    ctx.menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(ctx.item('legend'));
  });

  it('开着时换位置（在另一行上再按右键）：重新量过、显示以后焦点仍在第一个能用的项上', async () => {
    using ctx = setup();
    await frames(2);
    ctx.item('remove').focus();

    ctx.point.value = { x: 120, y: 160 };
    await frames(2);
    expect(visibility(ctx.menu())).toBe('visible');
    expect(ctx.menu().style.top).toBe('160px');
    expect(document.activeElement).toBe(ctx.item('legend'));
  });

  it('量尺寸的同时换了位置：上一轮作废，不在菜单重新隐藏时聚焦，显示以后才聚焦', async () => {
    // 每次聚焦时目标看不看得见：作废的那一轮会在菜单重新隐藏以后聚焦
    const seen: string[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- 原来的方法，下面用 call 带上 this 调用
    const focus = HTMLElement.prototype.focus;
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
      seen.push(visibility(this));
      focus.call(this, options);
    });
    // 第一次量菜单时在另一行上再按右键：位置写进去之前，下一轮已经排在显示之前
    // oxlint-disable-next-line typescript/unbound-method -- 原来的方法，下面用 call 带上 this 调用
    const measure = HTMLElement.prototype.getBoundingClientRect;
    let point: ReturnType<typeof setup>['point'] | null = null;
    const measureSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (point && this.matches('[data-panel-menu]')) {
          point.value = { x: 120, y: 160 };
          point = null;
        }
        return measure.call(this);
      });
    try {
      using ctx = setup();
      point = ctx.point;
      await frames(2);

      expect(point).toBeNull();
      expect(seen.filter(value => value === 'hidden')).toStrictEqual([]);
      expect(ctx.menu().style.top).toBe('160px');
      expect(document.activeElement).toBe(ctx.item('legend'));
    } finally {
      focusSpy.mockRestore();
      measureSpy.mockRestore();
    }
  });

  it('刚打开、还没显示就关掉：不报错，焦点留在原处（冒烟）', async () => {
    using ctx = setup();
    await nextTick();
    ctx.open.value = false;
    await frames(2);

    expect(document.querySelector('[data-panel-menu]')).toBeNull();
    expect(document.activeElement).toBe(ctx.origin);
    expect(ctx.errors).toStrictEqual([]);
  });
});
