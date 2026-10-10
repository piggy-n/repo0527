// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { BOUNDARY_OPTIONS } from './boundary-style';
import { useBoundaries } from './useBoundaries';

function layerIds(boundaries: ReturnType<typeof useBoundaries>) {
  return boundaries.deriveGroup().layers.map(layer => layer.id);
}

describe('useBoundaries', () => {
  it('进入页面时只显示省界，透明度 1', () => {
    const boundaries = useBoundaries();

    expect(boundaries.options).toBe(BOUNDARY_OPTIONS);
    expect(boundaries.visible.value).toStrictEqual({ province: true, city: false, county: false });
    expect(boundaries.opacity.value).toBe(1);
    expect(layerIds(boundaries)).toStrictEqual(['boundaries-province']);
  });

  it('打开、关闭某一级后推导随之变化，其他级别不变', () => {
    const boundaries = useBoundaries();

    boundaries.setVisible('county', true);
    expect(boundaries.visible.value).toStrictEqual({ province: true, city: false, county: true });
    expect(layerIds(boundaries)).toStrictEqual(['boundaries-county', 'boundaries-province']);

    boundaries.setVisible('province', false);
    expect(layerIds(boundaries)).toStrictEqual(['boundaries-county']);
  });

  it('透明度作用于所有打开的级别', () => {
    const boundaries = useBoundaries();
    boundaries.setVisible('city', true);

    boundaries.setOpacity(0.5);

    expect(boundaries.opacity.value).toBe(0.5);
    expect(
      boundaries.deriveGroup().layers.map(layer => (layer.type === 'line' ? layer.paint?.['line-opacity'] : undefined))
    ).toStrictEqual([0.39, 0.47]);
  });

  it('包进 computed 时只在状态变化后重新推导；相同的显隐和透明度不触发', () => {
    const boundaries = useBoundaries();
    boundaries.setOpacity(0.6);
    const group = computed(() => boundaries.deriveGroup());
    const initial = group.value;

    boundaries.setVisible('province', true);
    boundaries.setVisible('city', false);
    boundaries.setOpacity(0.6);

    expect(group.value).toBe(initial);

    boundaries.setVisible('city', true);

    expect(group.value).not.toBe(initial);
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('透明度为 %s 时抛错，状态不变', value => {
    const boundaries = useBoundaries();
    boundaries.setOpacity(0.3);

    expect(() => boundaries.setOpacity(value)).toThrow(RangeError);
    expect(boundaries.opacity.value).toBe(0.3);
  });

  it('透明度可以是 0 和 1', () => {
    const boundaries = useBoundaries();

    expect(() => boundaries.setOpacity(0)).not.toThrow();
    expect(boundaries.opacity.value).toBe(0);
    expect(() => boundaries.setOpacity(1)).not.toThrow();
    expect(boundaries.opacity.value).toBe(1);
  });

  it('每次调用各有一份状态', () => {
    const first = useBoundaries();
    const second = useBoundaries();

    first.setVisible('city', true);

    expect(second.visible.value.city).toBe(false);
  });
});
