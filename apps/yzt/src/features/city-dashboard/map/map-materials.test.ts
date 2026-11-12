import { gsap } from 'gsap';
import { Color } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { getMapColor } from './config';
import { createRegionMaterials, updateRegionMaterials } from './map-materials';

function materials(value: number | null) {
  return createRegionMaterials(value, { uSweepPosition: { value: 0 }, uSweepStrength: { value: 0 } });
}

const created: ReturnType<typeof materials>[] = [];

afterEach(() => {
  created.splice(0).forEach(item => {
    gsap.killTweensOf(item.top.color);
    item.top.dispose();
    item.side.dispose();
  });
});

describe('updateRegionMaterials', () => {
  it('颜色不同时按时长过渡到目标值', () => {
    const region = materials(null);
    created.push(region);
    updateRegionMaterials(region, 80, 0.85);
    const tween = required(gsap.getTweensOf(region.top.color)[0], '颜色过渡');
    expect(tween.duration()).toBe(0.85);
    tween.progress(1);
    expect(region.top.color.getHex()).toBe(new Color(getMapColor(80)).getHex());
    expect(region.sideColor.equals(region.top.color)).toBe(true);
  });

  // 入场时着色过渡结束后数值才出现，再次更新同样的值不能让地图又逐帧重画一遍
  it('过渡结束后再更新到同一颜色，不再起过渡', () => {
    const region = materials(null);
    created.push(region);
    updateRegionMaterials(region, 80, 0.85);
    required(gsap.getTweensOf(region.top.color)[0], '颜色过渡').progress(1);
    updateRegionMaterials(region, 80, 0.85);
    expect(gsap.getTweensOf(region.top.color)).toHaveLength(0);
    expect(region.top.color.equals(new Color(getMapColor(80)))).toBe(true);
    expect(region.sideColor.equals(region.top.color)).toBe(true);
  });
});
