// @vitest-environment node
import { diffStyle, type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_OPTIONS,
  boundaryGroup,
  boundarySwatch,
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

const width = (...stops: number[]) => ['interpolate', ['linear'], ['zoom'], ...stops];

// 一级边界里的一条线：核心线的 ID 就是 boundaries-<级别>，色带、白边在后面加上部位
function line(level: BoundaryLevel, part: 'band' | 'casing' | 'line', paint: Record<string, unknown>) {
  return {
    id: part === 'line' ? `boundaries-${level}` : `boundaries-${level}-${part}`,
    type: 'line',
    source: `boundaries-${level}`,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint
  };
}

// 设计稿"图例卡、底图卡与行政区线型"的方案一（ADR 0057）
const PROVINCE = [
  line('province', 'band', {
    'line-color': '#597EF7',
    'line-width': width(5, 7, 9, 10, 13, 16),
    'line-opacity': 0.22,
    'line-blur': 1
  }),
  line('province', 'casing', {
    'line-color': '#FFFFFF',
    'line-width': width(5, 3.4, 9, 4.4, 13, 5.6),
    'line-opacity': 0.7
  }),
  line('province', 'line', { 'line-color': '#2F54EB', 'line-width': width(5, 1.8, 9, 2.4, 13, 3.2), 'line-opacity': 1 })
];
const CITY = [
  line('city', 'casing', { 'line-color': '#FFFFFF', 'line-width': width(5, 2.4, 9, 3.2, 13, 4), 'line-opacity': 0.6 }),
  line('city', 'line', { 'line-color': '#597EF7', 'line-width': width(5, 1, 9, 1.4, 13, 2), 'line-opacity': 0.95 })
];
const COUNTY = [
  line('county', 'line', {
    'line-color': '#597EF7',
    'line-width': width(8, 0.8, 11, 1.1, 14, 1.4),
    'line-opacity': 0.8,
    'line-dasharray': [3, 2]
  })
];

// 一条线在各档级别的线宽
function widthStops(group: StyleGroup, id: string): number[] {
  const layer = group.layers.find(candidate => candidate.id === id);
  const value: unknown = layer?.type === 'line' ? layer.paint?.['line-width'] : undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${id} 没有按级别插值的线宽`);
  }
  return value.slice(3).filter((_, index) => index % 2 === 1).map(Number);
}

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
      layers: PROVINCE
    });
  });

  it('三级都打开：从下到上是县、市、省；省界是色带、白边和深蓝的线，市界是白边上的细线，县界是虚线（ADR 0057）', () => {
    expect(boundaryGroup(state(ALL_VISIBLE))).toStrictEqual({
      sources: {
        'boundaries-county': { type: 'geojson', data: countyUrl },
        'boundaries-city': { type: 'geojson', data: cityUrl },
        'boundaries-province': { type: 'geojson', data: provinceUrl }
      },
      layers: [...COUNTY, ...CITY, ...PROVINCE]
    });
  });

  it('共用的边上省界盖住市界：省界的核心线不透明、各级都不比市界的窄，白边也不比市界的窄', () => {
    const group = boundaryGroup(state(ALL_VISIBLE));
    const covers = (upper: string, lower: string) => {
      const lowerStops = widthStops(group, lower);
      return widthStops(group, upper).every((value, index) => value >= (lowerStops[index] ?? Infinity));
    };

    expect(PROVINCE.at(-1)?.paint['line-opacity']).toBe(1);
    expect(covers('boundaries-province', 'boundaries-city')).toBe(true);
    expect(covers('boundaries-province-casing', 'boundaries-city-casing')).toBe(true);
    // 每一级从下到上一条比一条窄，上面的线才露得出下面的白边和色带
    expect(covers('boundaries-province-band', 'boundaries-province-casing')).toBe(true);
    expect(covers('boundaries-province-casing', 'boundaries-province')).toBe(true);
    expect(covers('boundaries-city-casing', 'boundaries-city')).toBe(true);
  });

  it('面板的线型示意从下到上列出每一条线，和地图上同色、同样的不透明度和虚线，线宽取中间一档', () => {
    expect(boundarySwatch('province')).toStrictEqual([
      { color: '#597EF7', width: 10, opacity: 0.22 },
      { color: '#FFFFFF', width: 4.4, opacity: 0.7 },
      { color: '#2F54EB', width: 2.4, opacity: 1 }
    ]);
    expect(boundarySwatch('city')).toStrictEqual([
      { color: '#FFFFFF', width: 3.2, opacity: 0.6 },
      { color: '#597EF7', width: 1.4, opacity: 0.95 }
    ]);
    expect(boundarySwatch('county')).toStrictEqual([{ color: '#597EF7', width: 1.1, opacity: 0.8, dasharray: [3, 2] }]);
  });

  it('透明度乘在每一条线原有的不透明度上', () => {
    const opacities = boundaryGroup(state(ALL_VISIBLE, 0.5)).layers.map(layer =>
      layer.type === 'line' ? layer.paint?.['line-opacity'] : undefined
    );

    expect(opacities).toStrictEqual([0.4, 0.3, 0.475, 0.11, 0.35, 0.5]);
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
      ['setPaintProperty', 'boundaries-city-casing', 'line-opacity', 0.3],
      ['setPaintProperty', 'boundaries-city', 'line-opacity', 0.475],
      ['setPaintProperty', 'boundaries-province-band', 'line-opacity', 0.11],
      ['setPaintProperty', 'boundaries-province-casing', 'line-opacity', 0.35],
      ['setPaintProperty', 'boundaries-province', 'line-opacity', 0.5]
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
