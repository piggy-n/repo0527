// @vitest-environment node
import { diffStyle, type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_OPTIONS,
  boundaryGroup,
  type BoundaryLevel,
  type BoundaryState,
  INITIAL_BOUNDARY_STATE
} from './boundary-style';
import cityUrl from './data/jiangsu-city.json?url';
import countyUrl from './data/jiangsu-county.json?url';
import provinceUrl from './data/jiangsu-province.json?url';

const ALL_VISIBLE = { province: true, city: true, county: true };

function state(visible: Partial<Record<BoundaryLevel, boolean>>, opacity = 1): BoundaryState {
  return { visible: { province: false, city: false, county: false, ...visible }, opacity };
}

function line(level: BoundaryLevel, width: unknown[], opacity: number, dasharray?: number[]) {
  return {
    id: `boundaries-${level}`,
    type: 'line',
    source: `boundaries-${level}`,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#597EF7',
      'line-width': width,
      'line-opacity': opacity,
      ...(dasharray ? { 'line-dasharray': dasharray } : {})
    }
  };
}

const PROVINCE_WIDTH = ['interpolate', ['linear'], ['zoom'], 5, 1.8, 9, 2.4, 13, 3.2];
const CITY_WIDTH = ['interpolate', ['linear'], ['zoom'], 5, 1.1, 9, 1.6, 13, 2.3];
const COUNTY_WIDTH = ['interpolate', ['linear'], ['zoom'], 8, 0.6, 11, 0.95, 14, 1.25];

// 放进只有 boundaries 一个分组的样式模型：ID 重复、引用不存在的数据源时抛错
function compose(group: StyleGroup) {
  const model = new StyleModel({ groups: ['boundaries'] });
  model.setGroups({ boundaries: group });
  return model.current;
}

describe('行政区边界的推导', () => {
  it('面板里是省界、市界、县界；进入页面时只显示省界，透明度 1', () => {
    expect(BOUNDARY_OPTIONS).toStrictEqual([
      { id: 'province', label: '省界' },
      { id: 'city', label: '市界' },
      { id: 'county', label: '县界' }
    ]);
    expect(INITIAL_BOUNDARY_STATE).toStrictEqual({
      visible: { province: true, city: false, county: false },
      opacity: 1
    });
  });

  it('数据源直接写三份数据文件的地址', () => {
    expect([provinceUrl, cityUrl, countyUrl]).toStrictEqual([
      expect.stringMatching(/jiangsu-province\.json$/) as unknown,
      expect.stringMatching(/jiangsu-city\.json$/) as unknown,
      expect.stringMatching(/jiangsu-county\.json$/) as unknown
    ]);
    expect(boundaryGroup(INITIAL_BOUNDARY_STATE)).toStrictEqual({
      sources: { 'boundaries-province': { type: 'geojson', data: provinceUrl } },
      layers: [line('province', PROVINCE_WIDTH, 0.94)]
    });
  });

  it('三级都打开：从下到上是县、市、省，县界是虚线', () => {
    expect(boundaryGroup(state(ALL_VISIBLE))).toStrictEqual({
      sources: {
        'boundaries-county': { type: 'geojson', data: countyUrl },
        'boundaries-city': { type: 'geojson', data: cityUrl },
        'boundaries-province': { type: 'geojson', data: provinceUrl }
      },
      layers: [
        line('county', COUNTY_WIDTH, 0.62, [2.2, 1.6]),
        line('city', CITY_WIDTH, 0.78),
        line('province', PROVINCE_WIDTH, 0.94)
      ]
    });
  });

  it('透明度乘在各级原有的不透明度上', () => {
    const opacities = boundaryGroup(state(ALL_VISIBLE, 0.5)).layers.map(layer =>
      layer.type === 'line' ? layer.paint?.['line-opacity'] : undefined
    );

    expect(opacities).toStrictEqual([0.31, 0.39, 0.47]);
  });

  it('关闭的级别不在样式里；都关闭时是空分组', () => {
    expect(Object.keys(boundaryGroup(state({ city: true })).sources)).toStrictEqual(['boundaries-city']);
    expect(boundaryGroup(state({}))).toStrictEqual({ sources: {}, layers: [] });
  });

  it('ID 以分组名为前缀，组合后通过样式模型的校验', () => {
    const group = boundaryGroup(state(ALL_VISIBLE));

    for (const id of [...Object.keys(group.sources), ...group.layers.map(layer => layer.id)]) {
      expect(id).toMatch(/^boundaries-/);
    }
    expect(() => compose(group)).not.toThrow();
  });

  it('改透明度只产生 setPaintProperty，不重新加载数据', () => {
    const commands = diffStyle(
      compose(boundaryGroup(state({ province: true, city: true }))),
      compose(boundaryGroup(state({ province: true, city: true }, 0.5)))
    );

    expect(commands.map(({ command, args }) => [command, args[0], args[1], args[2]])).toStrictEqual([
      ['setPaintProperty', 'boundaries-city', 'line-opacity', 0.39],
      ['setPaintProperty', 'boundaries-province', 'line-opacity', 0.47]
    ]);
  });

  it('打开、关闭一级时只增删这一级，不动其他级别', () => {
    const before = compose(boundaryGroup(state({ province: true })));
    const after = compose(boundaryGroup(state({ province: true, county: true })));

    const added = diffStyle(before, after).map(({ command, args }) => [command, args[0]]);
    const removed = diffStyle(after, before).map(({ command, args }) => [command, args[0]]);

    expect(added).toStrictEqual([
      ['addSource', 'boundaries-county'],
      ['addLayer', expect.objectContaining({ id: 'boundaries-county' }) as unknown]
    ]);
    expect(removed).toStrictEqual([
      ['removeLayer', 'boundaries-county'],
      ['removeSource', 'boundaries-county']
    ]);
  });
});
