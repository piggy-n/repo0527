// @vitest-environment node
import type { VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import type { QueryRequest } from './api';
import {
  featureCollection,
  mvtTiles,
  PREVIEW_GROUP,
  previewGroup,
  queryTileBase,
  RESULT_GROUP,
  resultGroup
} from './result-layers';
import { QUERY_TOPICS } from './topics';

const BASE = queryTileBase('/backend', 'http://localhost:5173');
const [SCHOOL_POINTS, SCHOOL_AREAS] = QUERY_TOPICS['space-monitoring'].layers;
const [TOWN] = QUERY_TOPICS['land-change'].layers;

function vectorTiles(group: ReturnType<typeof previewGroup>, id: string): string {
  const source = group.sources[id] as VectorSourceSpecification | undefined;
  return source?.tiles?.[0] ?? '';
}

describe('MVT 地址', () => {
  it('同源的 /backend 换成绝对地址；条件做 URL 编码，瓦片坐标的占位符原样保留', () => {
    expect(BASE).toBe('http://localhost:5173/backend/api/query/mvt');
    const [tiles] = mvtTiles(BASE, 'bgdc_czcdyd_2022', '320100', "CZCLX IN ('201','201A')");
    expect(tiles).toBe(
      'http://localhost:5173/backend/api/query/mvt?layerCode=bgdc_czcdyd_2022&xzqdm=320100' +
        '&conditions=CZCLX+IN+%28%27201%27%2C%27201A%27%29&z={z}&x={x}&y={y}'
    );
    expect(new URL(tiles ?? '').searchParams.get('conditions')).toBe("CZCLX IN ('201','201A')");
  });
});

describe('previewGroup', () => {
  it('没有图层时是空分组', () => {
    expect(previewGroup(null, BASE)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('点层只画灰点，面层画填充和边线；都是全省、不带条件，按图层自己的瓦片图层名', () => {
    expect(previewGroup(SCHOOL_POINTS ?? null, BASE).layers.map(({ id, type }) => [id, type])).toStrictEqual([
      [`${PREVIEW_GROUP}-point`, 'circle']
    ]);
    const town = previewGroup(TOWN ?? null, BASE);
    expect(town.layers.map(({ id }) => id)).toStrictEqual([`${PREVIEW_GROUP}-fill`, `${PREVIEW_GROUP}-line`]);
    expect(town.layers.every(layer => 'source-layer' in layer && layer['source-layer'] === 'czcdyd')).toBe(true);
    const query = new URL(vectorTiles(town, PREVIEW_GROUP)).searchParams;
    expect([query.get('xzqdm'), query.get('conditions')]).toStrictEqual(['320000', '']);
  });
});

describe('resultGroup', () => {
  const attribute: QueryRequest = {
    kind: 'attribute',
    origin: 'attribute',
    layerCode: 'csxhjctb_xxa_2022',
    xzqdm: '320100',
    conditions: "TYPE IN ('小学')"
  };
  const geometry: QueryRequest = { kind: 'geometry', layerCode: 'csxhjctb_xxp_2022', geometry: '{}', bounds: [0, 0, 1, 1] };

  it('属性类按查询的区划和条件出 MVT；面层画边线', () => {
    const group = resultGroup(attribute, SCHOOL_AREAS ?? null, null, BASE);
    expect(group.layers.map(({ id }) => id)).toStrictEqual([`${RESULT_GROUP}-line`]);
    const query = new URL(vectorTiles(group, RESULT_GROUP)).searchParams;
    expect([query.get('layerCode'), query.get('xzqdm'), query.get('conditions')]).toStrictEqual([
      'csxhjctb_xxa_2022',
      '320100',
      "TYPE IN ('小学')"
    ]);
  });

  it('空间类等命中的要素到了才出图层，点、线、面都画；没有命中时是空分组', () => {
    expect(resultGroup(geometry, SCHOOL_POINTS ?? null, null, BASE).layers).toStrictEqual([]);
    expect(resultGroup(geometry, SCHOOL_POINTS ?? null, featureCollection([]), BASE).layers).toStrictEqual([]);
    const collection = featureCollection([{ guid: 'a', geom: { type: 'Point', coordinates: [118, 32] } }]);
    const group = resultGroup(geometry, SCHOOL_POINTS ?? null, collection, BASE);
    expect(group.sources[RESULT_GROUP]).toStrictEqual({ type: 'geojson', data: collection });
    expect(group.layers.map(({ id }) => id)).toStrictEqual([`${RESULT_GROUP}-line`, `${RESULT_GROUP}-point`]);
    expect(group.layers.some(layer => 'source-layer' in layer)).toBe(false);
  });

  it('没有查询时是空分组', () => {
    expect(resultGroup(null, null, null, BASE)).toStrictEqual({ sources: {}, layers: [] });
  });
});
