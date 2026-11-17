// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { required } from '../../testing/required';
import { DASHBOARD_CITIES } from '../cities';
import type { City } from '../model';
import { DEFAULT_DETAIL_SIZE, useChartDetail } from './useChartDetail';

type CardKey = 'domain' | 'sub';

function createDetail() {
  const legends = shallowRef<Record<CardKey, Readonly<Record<string, boolean>>>>({
    domain: { 2025: true },
    sub: { 2025: false }
  });
  const cities = shallowRef<readonly City[]>(DASHBOARD_CITIES.slice(0, 3));
  const filters = shallowRef({ categoryId: 'a', cityCodes: ['320100'] });
  const scope = effectScope();
  const detail = required(
    scope.run(() => useChartDetail<CardKey>({
      legend: key => legends.value[key],
      cities: () => cities.value,
      reset: () => filters.value,
      closeOn: () => filters.value.categoryId
    })),
    '详情状态'
  );
  return { detail, legends, cities, filters, scope };
}

describe('useChartDetail', () => {
  it('打开时记下目标和聚焦的城市，复制这张卡的图例，并说明城市在不在筛选里', () => {
    const { detail, legends, cities, scope } = createDetail();
    expect(detail.visible.value).toBe(false);
    expect(detail.target.value).toBeNull();
    expect(detail.size.value).toEqual(DEFAULT_DETAIL_SIZE);
    detail.open('sub', '320100');
    expect(detail.visible.value).toBe(true);
    expect(detail.target.value).toBe('sub');
    expect(detail.cityCode.value).toBe('320100');
    expect(detail.focusedCity.value?.name).toBe('南京市');
    expect(detail.focusText.value).toBe('南京市 · 当前查看城市');
    expect(detail.legend.value).toEqual({ 2025: false });
    expect(detail.legend.value).not.toBe(legends.value.sub);
    cities.value = DASHBOARD_CITIES.slice(1);
    expect(detail.focusText.value).toBe('南京市 · 未纳入当前城市筛选');
    detail.open('domain');
    expect(detail.cityCode.value).toBeNull();
    expect(detail.focusText.value).toBe('');
    scope.stop();
  });

  it('关闭时清掉悬停的城市，目标留着给弹窗淡出', () => {
    const { detail, scope } = createDetail();
    detail.open('sub', '320200');
    detail.setHover('320100');
    expect(detail.hoveredCity.value?.name).toBe('南京市');
    detail.close();
    expect(detail.visible.value).toBe(false);
    expect(detail.hoveredCity.value).toBeUndefined();
    expect(detail.target.value).toBe('sub');
    expect(detail.cityCode.value).toBe('320200');
    scope.stop();
  });

  it('详情里的图例单独维护，切换或再次打开时重新复制卡片的图例', () => {
    const { detail, legends, scope } = createDetail();
    const domainLegend = legends.value.domain;
    detail.open('domain');
    detail.setLegend({ 2025: false });
    expect(detail.legend.value).toEqual({ 2025: false });
    expect(legends.value.domain).toBe(domainLegend);
    expect(domainLegend).toEqual({ 2025: true });
    detail.open('sub');
    expect(detail.legend.value).toEqual({ 2025: false });
    legends.value = { ...legends.value, domain: { 2025: true, 2024: false } };
    detail.open('domain');
    expect(detail.legend.value).toEqual({ 2025: true, 2024: false });
    scope.stop();
  });

  it('reset 变化时清掉悬停的城市，closeOn 变化时关闭；记下图表区尺寸', async () => {
    const { detail, filters, scope } = createDetail();
    detail.open('domain');
    detail.setHover('320100');
    filters.value = { ...filters.value, cityCodes: [] };
    await nextTick();
    expect(detail.hoveredCity.value).toBeUndefined();
    expect(detail.visible.value).toBe(true);
    filters.value = { ...filters.value, categoryId: 'b' };
    await nextTick();
    expect(detail.visible.value).toBe(false);
    detail.setSize({ width: 900, height: 500 });
    expect(detail.size.value).toEqual({ width: 900, height: 500 });
    scope.stop();
  });
});
