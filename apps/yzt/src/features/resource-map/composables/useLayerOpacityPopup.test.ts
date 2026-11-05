import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useLayerOpacityPopup } from './useLayerOpacityPopup';

// 直接检查关闭规则，不依赖 Element 的过渡动画
function setup() {
  const scope = effectScope();
  const active = ref(true);
  const popup = scope.run(() => useLayerOpacityPopup(active));
  if (!popup) {
    throw new Error('没有创建透明度浮层状态');
  }
  return { popup, active, [Symbol.dispose]: () => scope.stop() };
}

afterEach(() => vi.useRealTimers());

describe('useLayerOpacityPopup', () => {
  it('离开 2 秒才关闭；在按钮和浮层之间移动会取消旧计时，再次离开重新计时', () => {
    vi.useFakeTimers();
    using ctx = setup();
    ctx.popup.setOpen(true);
    ctx.popup.leave();
    vi.advanceTimersByTime(1999);
    expect(ctx.popup.open.value).toBe(true);

    ctx.popup.enter();
    vi.advanceTimersByTime(3000);
    expect(ctx.popup.open.value).toBe(true);
    ctx.popup.leave();
    vi.advanceTimersByTime(1999);
    expect(ctx.popup.open.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctx.popup.open.value).toBe(false);
  });

  it('捕获容器不冒泡的滚动事件，立即关闭并取消计时', async () => {
    vi.useFakeTimers();
    using ctx = setup();
    const list = document.body.appendChild(document.createElement('div'));
    try {
      ctx.popup.setOpen(true);
      await nextTick();
      ctx.popup.leave();
      list.dispatchEvent(new Event('scroll'));
      expect(ctx.popup.open.value).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      list.remove();
    }
  });

  it.each(['pointerup', 'pointercancel'])('拖动中移出不关闭，%s 后在外部重新计时', async eventName => {
    vi.useFakeTimers();
    using ctx = setup();
    ctx.popup.setOpen(true);
    await nextTick();
    ctx.popup.enter();
    ctx.popup.beginPointer(new PointerEvent('pointerdown', { pointerId: 1, button: 0 }));
    ctx.popup.leave();
    vi.advanceTimersByTime(3000);
    expect(ctx.popup.open.value).toBe(true);

    window.dispatchEvent(new PointerEvent(eventName, { pointerId: 1 }));
    vi.advanceTimersByTime(1999);
    expect(ctx.popup.open.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ctx.popup.open.value).toBe(false);
  });

  it('页面停用立即关闭；重新打开不会被之前的计时器关闭', () => {
    vi.useFakeTimers();
    using ctx = setup();
    ctx.popup.setOpen(true);
    ctx.popup.leave();
    vi.advanceTimersByTime(1000);
    ctx.active.value = false;
    expect(ctx.popup.open.value).toBe(false);
    ctx.popup.setOpen(true);
    expect(ctx.popup.open.value).toBe(false);

    ctx.active.value = true;
    ctx.popup.setOpen(true);
    vi.advanceTimersByTime(3000);
    expect(ctx.popup.open.value).toBe(true);
  });

  it('卸载清理计时器与滚动监听', async () => {
    vi.useFakeTimers();
    const ctx = setup();
    ctx.popup.setOpen(true);
    await nextTick();
    ctx.popup.leave();
    ctx[Symbol.dispose]();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event('scroll'));
    expect(ctx.popup.open.value).toBe(true);
  });
});
