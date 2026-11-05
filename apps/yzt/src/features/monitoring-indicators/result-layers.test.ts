// @vitest-environment node
import { type LayerSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  type IndicatorResult,
  indicatorResultGroup,
  isRecolorable,
  pointSymbolOf,
  RANGE_COLOR,
  type ResultLayerSource,
  resultLayersOf,
  resultTileBase,
  sameColor
} from './result-layers';

// 南京 2025 年"社区小学步行10分钟覆盖率"的子图层，按接口的顺序
const PRIMARY_SCHOOL: readonly ResultLayerSource[] = [
  { key: 'xxp', name: '社区小学', geometry: 'point' },
  { key: 'roads', name: '路网', geometry: 'line' },
  { key: 'dltb_location', name: '已覆盖城镇住宅及宅基地', geometry: 'fill' },
  { key: 'cqjcfwa', name: '城区范围面', geometry: 'fill' },
  { key: 'dltb', name: '未覆盖城镇住宅及宅基地', geometry: 'fill' },
  { key: 'service_final', name: '覆盖范围', geometry: 'fill' }
];

const TILE_BASE = 'http://localhost:5173/backend/api/analysis/mvt/';

const result = (sources: readonly ResultLayerSource[]): IndicatorResult => ({
  analysisId: 'e3472ce215e0420baec22477cb48721b',
  value: '40.04%',
  layers: resultLayersOf(sources)
});

const valid = (group: ReturnType<typeof indicatorResultGroup>) =>
  validateStyleMin({ version: 8, sources: group.sources, layers: group.layers.slice() });

const visibility = (layer: LayerSpecification | undefined) =>
  layer !== undefined && 'layout' in layer ? layer.layout?.visibility : undefined;

describe('成果的子图层', () => {
  it('按点、线、面、区划范围排好，配上旧页面的默认色', () => {
    expect(resultLayersOf(PRIMARY_SCHOOL).map(({ key, color, range }) => [key, color, range])).toEqual([
      ['xxp', '#3D6FB4', false],
      ['roads', '#90966F', false],
      ['dltb_location', '#FAB100', false],
      ['dltb', '#AFEFB4', false],
      ['service_final', '#99D8EA', false],
      ['cqjcfwa', RANGE_COLOR, true]
    ]);
  });

  it('区划范围是以"范围面"结尾的面，"覆盖范围"不是', () => {
    const layers = resultLayersOf([
      { key: 'xxa', name: '学校面', geometry: 'fill' },
      { key: 'xzq', name: '城市范围面', geometry: 'fill' },
      { key: 'service_final', name: '覆盖范围', geometry: 'fill' }
    ]);
    expect(layers.filter(layer => layer.range).map(layer => layer.key)).toEqual(['xzq']);
  });

  it('只有一个点图层时画旗子、不能改色；多个点图层用不同颜色的圆点', () => {
    const single = resultLayersOf(PRIMARY_SCHOOL);
    expect(pointSymbolOf(single)).toBe('flag');
    expect(single.map(layer => isRecolorable(layer, 'flag'))).toEqual([false, true, true, true, true, true]);

    const parks = resultLayersOf([
      { key: 'gyylda', name: '公园绿地面', geometry: 'fill' },
      { key: 'entrance', name: '出入口', geometry: 'point' },
      { key: 'square', name: '广场中心点', geometry: 'point' }
    ]);
    expect(pointSymbolOf(parks)).toBe('circle');
    expect(parks.slice(0, 2).map(layer => layer.color)).toEqual(['#3D6FB4', '#C9823E']);
    expect(parks.every(layer => isRecolorable(layer, 'circle'))).toBe(true);
  });

  it('取色器的 rgb() 和默认的 #RRGGBB 写法不同也算同一个颜色', () => {
    expect(sameColor('rgb(61, 111, 180)', '#3D6FB4')).toBe(true);
    expect(sameColor('rgba(61, 111, 180, 1)', '#3d6fb4')).toBe(true);
    expect(sameColor('rgba(61, 111, 180, 0.5)', '#3D6FB4')).toBe(false);
    expect(sameColor('不是颜色', '#3D6FB4')).toBe(false);
  });
});

describe('成果分组', () => {
  it('瓦片地址是绝对地址：MapLibre 在 Worker 里请求', () => {
    expect(resultTileBase('/backend', 'http://localhost:5173')).toBe(TILE_BASE);
  });

  it('没有要显示的成果时是空分组', () => {
    expect(indicatorResultGroup(null, TILE_BASE)).toEqual({ sources: {}, layers: [] });
  });

  it('从下到上是区划范围、面、线、点；每个子图层一个数据源，面另有同色的边线；单个点图层带旗子图片', () => {
    const group = indicatorResultGroup(
      { result: result(PRIMARY_SCHOOL), hidden: new Set(), colors: new Map() },
      TILE_BASE
    );

    expect(valid(group)).toStrictEqual([]);
    expect(group.layers.map(layer => `${layer.type}:${layer.id}`)).toEqual([
      'fill:indicator-result-cqjcfwa',
      'line:indicator-result-cqjcfwa-outline',
      'fill:indicator-result-service_final',
      'line:indicator-result-service_final-outline',
      'fill:indicator-result-dltb',
      'line:indicator-result-dltb-outline',
      'fill:indicator-result-dltb_location',
      'line:indicator-result-dltb_location-outline',
      'line:indicator-result-roads',
      'symbol:indicator-result-xxp'
    ]);
    expect(group.sources['indicator-result-roads']).toEqual({
      type: 'vector',
      tiles: [`${TILE_BASE}e3472ce215e0420baec22477cb48721b/roads/{z}/{x}/{y}.pbf`],
      maxzoom: 14
    });
    expect(Object.keys(group.images ?? {})).toEqual(['indicator-result-flag']);
    expect(group.images?.['indicator-result-flag']).toMatchObject({ width: 48, height: 48, pixelRatio: 2 });
  });

  it('隐藏的子图层设为不可见，改过的颜色画在填充和边线上', () => {
    const group = indicatorResultGroup(
      {
        result: result(PRIMARY_SCHOOL),
        hidden: new Set(['roads']),
        colors: new Map([['dltb', '#FF0000']])
      },
      TILE_BASE
    );
    const byId = new Map(group.layers.map(layer => [layer.id, layer]));

    expect(visibility(byId.get('indicator-result-roads'))).toBe('none');
    expect(visibility(byId.get('indicator-result-dltb'))).toBe('visible');
    expect(byId.get('indicator-result-dltb')).toMatchObject({
      paint: { 'fill-color': '#FF0000', 'fill-outline-color': '#FF0000' }
    });
    expect(byId.get('indicator-result-dltb-outline')).toMatchObject({ paint: { 'line-color': '#FF0000' } });
  });

  it('多个点图层画成各自颜色的圆点，不带旗子图片', () => {
    const group = indicatorResultGroup(
      {
        result: result([
          { key: 'yljgp', name: '医疗机构', geometry: 'point' },
          { key: 'fljgp', name: '养老设施', geometry: 'point' }
        ]),
        hidden: new Set(),
        colors: new Map()
      },
      TILE_BASE
    );

    expect(valid(group)).toStrictEqual([]);
    expect(group.images).toBeUndefined();
    expect(group.layers.map(layer => [layer.type, layer.id])).toEqual([
      ['circle', 'indicator-result-fljgp'],
      ['circle', 'indicator-result-yljgp']
    ]);
    expect(group.layers[1]).toMatchObject({ paint: { 'circle-color': '#3D6FB4' } });
  });
});
