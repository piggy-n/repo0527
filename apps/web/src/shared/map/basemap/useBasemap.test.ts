// @vitest-environment node
import type { StyleGroup } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { appConfig } from '../../config/app-config';
import { basemapOptions } from './basemap-style';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: '0123456789abcdef0123456789abcdef' };

// 分组里各图层的透明度，按图层 ID
function opacities(group: StyleGroup) {
  return Object.fromEntries(
    group.layers.flatMap(layer => (layer.type === 'raster' ? [[layer.id, layer.paint?.['raster-opacity']]] : []))
  );
}

describe('useBasemap', () => {
  it('默认读取 appConfig.tianditu', () => {
    expect(useBasemap().options).toStrictEqual(basemapOptions(appConfig.tianditu));
  });

  it('开启天地图：三种底图可选，进入时是矢量底图，透明度 1', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    expect(basemap.options.map(option => option.id)).toStrictEqual(['vector', 'imagery', 'none']);
    expect(basemap.selected.value).toBe('vector');
    expect(basemap.opacity.value).toBe(1);
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-vector']);
    expect(JSON.stringify([basemap.deriveGroup(), basemap.deriveLabelsGroup()])).toContain(`tk=${TIANDITU.key}`);
  });

  it('关闭天地图：只有无底图，没有透明度，推导结果里没有天地图', () => {
    const basemap = useBasemap({ tianditu: null });

    expect(basemap.options.map(option => option.id)).toStrictEqual(['none']);
    expect(basemap.selected.value).toBe('none');
    expect(basemap.opacity.value).toBeNull();
    expect(JSON.stringify([basemap.deriveGroup(), basemap.deriveLabelsGroup()])).not.toContain('tianditu');
  });

  it('切换底图后，推导出所选底图和配套的注记', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    basemap.select('imagery');

    expect(basemap.selected.value).toBe('imagery');
    expect(Object.keys(basemap.deriveGroup().sources)).toStrictEqual(['basemap-imagery']);
    expect(Object.keys(basemap.deriveLabelsGroup().sources)).toStrictEqual(['basemap-labels-imagery']);

    basemap.select('none');

    expect(basemap.opacity.value).toBeNull();
    expect(basemap.deriveGroup().sources).toStrictEqual({});
    expect(basemap.deriveLabelsGroup().layers).toStrictEqual([]);
  });

  it('透明度作用于当前底图的底图和注记，每种底图各自记住', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    basemap.setOpacity(0.5);

    expect(basemap.opacity.value).toBe(0.5);
    expect(opacities(basemap.deriveGroup())).toStrictEqual({ 'basemap-vector': 0.5 });
    expect(opacities(basemap.deriveLabelsGroup())).toStrictEqual({ 'basemap-labels-vector': 0.5 });

    basemap.select('imagery');
    expect(basemap.opacity.value).toBe(1);
    basemap.setOpacity(0.2);

    basemap.select('vector');
    expect(basemap.opacity.value).toBe(0.5);
    basemap.select('imagery');
    expect(basemap.opacity.value).toBe(0.2);
    expect(opacities(basemap.deriveGroup())).toStrictEqual({ 'basemap-imagery': 0.2 });
  });

  it('包进 computed 时只在状态变化后重新推导；相同的选择和透明度不触发', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.setOpacity(0.6);
    const group = computed(() => basemap.deriveGroup());
    const labels = computed(() => basemap.deriveLabelsGroup());
    const initial = group.value;
    const initialLabels = labels.value;

    basemap.select('vector');
    basemap.setOpacity(0.6);

    expect(group.value).toBe(initial);
    expect(labels.value).toBe(initialLabels);

    basemap.setOpacity(0.4);

    expect(group.value).not.toBe(initial);
    expect(labels.value).not.toBe(initialLabels);
  });

  it('选择不可用的底图时抛错，状态不变', () => {
    const basemap = useBasemap({ tianditu: null });

    expect(() => basemap.select('vector')).toThrow('底图 vector 不可用');
    expect(basemap.selected.value).toBe('none');
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('透明度为 %s 时抛错，状态不变', value => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.setOpacity(0.3);

    expect(() => basemap.setOpacity(value)).toThrow(RangeError);
    expect(basemap.opacity.value).toBe(0.3);
  });

  it('透明度可以是 0 和 1', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });

    expect(() => basemap.setOpacity(0)).not.toThrow();
    expect(basemap.opacity.value).toBe(0);
    expect(() => basemap.setOpacity(1)).not.toThrow();
    expect(basemap.opacity.value).toBe(1);
  });

  it('无底图时修改透明度抛错，状态不变', () => {
    const basemap = useBasemap({ tianditu: TIANDITU });
    basemap.select('none');

    expect(() => basemap.setOpacity(0.5)).toThrow('无底图时没有透明度');
    basemap.select('vector');
    expect(basemap.opacity.value).toBe(1);
  });
});
