import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useDashboardTooltip } from './useDashboardTooltip';

const scopes: ReturnType<typeof effectScope>[] = [];

/** 在真实 Vue 作用域内登记监听，并允许用例验证卸载后的清理 */
function createTooltip() {
  const scope = effectScope();
  scopes.push(scope);
  const created = scope.run(() => {
    // 筛选状态的替身：每次变化相当于用户改了一次筛选
    const filters = ref(0);
    const visibility = ref<DocumentVisibilityState>('visible');
    const tooltip = useDashboardTooltip({ reset: filters, visibility });
    const target = { indicatorId: 'A-15', cityCode: '320100' };
    return { filters, visibility, tooltip, target, stop: () => scope.stop() };
  });
  if (!created) {
    throw new Error('提示没有创建');
  }
  return created;
}

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.useRealTimers();
});

describe('驾驶舱共享提示', () => {
  it('移入表格取消关闭，离开表格后延迟关闭', () => {
    vi.useFakeTimers();
    const { tooltip, target } = createTooltip();
    tooltip.show('map', target);
    tooltip.show('map', null);
    vi.advanceTimersByTime(100);
    tooltip.keepOpen();
    vi.advanceTimersByTime(200);
    expect(tooltip.context.value).toMatchObject(target);
    tooltip.leave();
    vi.advanceTimersByTime(179);
    expect(tooltip.context.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(tooltip.context.value).toBeNull();
  });

  it('快速从地图移到图表时，旧来源的定时器和移出事件不关闭新提示', () => {
    vi.useFakeTimers();
    const { tooltip, target } = createTooltip();
    tooltip.show('map', target);
    tooltip.show('map', null);
    tooltip.show('chart', { ...target, cityCode: '320200' });
    tooltip.show('map', null);
    vi.advanceTimersByTime(200);
    expect(tooltip.context.value).toMatchObject({ source: 'chart', cityCode: '320200' });
  });

  it('筛选变化、页面隐藏和外部滚动立即关闭提示', async () => {
    const { filters, visibility, tooltip, target } = createTooltip();
    tooltip.show('map', target);
    filters.value += 1;
    await nextTick();
    expect(tooltip.context.value).toBeNull();
    tooltip.show('chart', target);
    visibility.value = 'hidden';
    await nextTick();
    expect(tooltip.context.value).toBeNull();
    tooltip.show('map', target);
    window.dispatchEvent(new Event('scroll'));
    expect(tooltip.context.value).toBeNull();
  });

  it('作用域卸载关闭提示并清理尚未触发的定时器', () => {
    vi.useFakeTimers();
    const { tooltip, target, stop } = createTooltip();
    tooltip.show('map', target);
    tooltip.leave();
    stop();
    expect(tooltip.context.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
