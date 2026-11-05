import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useLightDismiss } from './useLightDismiss';

const press = (target: Element, x = 10, y = 10) =>
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
const click = (target: Element, x = 10, y = 10, detail = 1) =>
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, detail }));

describe('useLightDismiss', () => {
  let panel: HTMLElement;
  let outside: HTMLElement;

  // 在 effectScope 里创建，用例结束时停止
  function setup(initiallyActive = true) {
    const scope = effectScope();
    const active = ref(initiallyActive);
    const onOutside = vi.fn<() => void>();
    const onEscape = vi.fn<() => void>();
    scope.run(() =>
      useLightDismiss({ active: () => active.value, contains: target => panel.contains(target), onOutside, onEscape })
    );
    return { active, onOutside, onEscape, [Symbol.dispose]: () => scope.stop() };
  }

  beforeEach(() => {
    panel = document.createElement('div');
    outside = document.createElement('div');
    document.body.append(panel, outside);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('单击外部关闭，这次点击照常交给被点的元素', () => {
    using ctx = setup();
    const clicked = vi.fn<() => void>();
    outside.addEventListener('click', clicked);

    press(outside);
    click(outside);

    expect(ctx.onOutside).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('单击浮层里面不关闭', () => {
    using ctx = setup();

    press(panel);
    click(panel);

    expect(ctx.onOutside).not.toHaveBeenCalled();
  });

  it('拖动地图不关闭；手抖几个像素还算单击', () => {
    using ctx = setup();

    press(outside, 100, 100);
    click(outside, 180, 140);
    expect(ctx.onOutside).not.toHaveBeenCalled();

    press(outside, 100, 100);
    click(outside, 103, 102);
    expect(ctx.onOutside).toHaveBeenCalledOnce();
  });

  it('从浮层里按下、拖到外面松手不关闭（拖滑块时常见）', () => {
    using ctx = setup();

    press(panel, 100, 100);
    click(document.body, 101, 100);

    expect(ctx.onOutside).not.toHaveBeenCalled();
  });

  it('按键触发外部的按钮也关闭，之前的按下不算数', () => {
    using ctx = setup();
    press(panel, 100, 100);

    click(outside, 0, 0, 0);

    expect(ctx.onOutside).toHaveBeenCalledOnce();
  });

  it('按 Esc 关闭，不再传给后面的监听（当前工具不会同时结束）；其他按键不管', () => {
    using ctx = setup();
    const heard = vi.fn<() => void>();
    outside.addEventListener('keydown', heard);

    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ctx.onEscape).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledOnce();

    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ctx.onEscape).toHaveBeenCalledOnce();
    expect(heard).toHaveBeenCalledOnce();
  });

  it('浮层没显示时什么都不管：不关闭，Esc 照常传下去', async () => {
    using ctx = setup(false);
    const heard = vi.fn<() => void>();
    outside.addEventListener('keydown', heard);

    press(outside);
    click(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(ctx.onOutside).not.toHaveBeenCalled();
    expect(ctx.onEscape).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledOnce();

    ctx.active.value = true;
    await nextTick();
    press(outside);
    click(outside);
    expect(ctx.onOutside).toHaveBeenCalledOnce();
  });

  it('作用域结束后不再监听', () => {
    const ctx = setup();
    ctx[Symbol.dispose]();

    press(outside);
    click(outside);

    expect(ctx.onOutside).not.toHaveBeenCalled();
  });
});
