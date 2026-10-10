// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { BOUNDARY_SOURCES } from './boundaries.ts';

function source(output: string) {
  const found = BOUNDARY_SOURCES.find(candidate => candidate.output === output);
  if (!found) {
    throw new Error(`没有 ${output}`);
  }
  return found;
}

const SQUARE = [
  [
    [118.123456789012, 32.987654321098],
    [118.2, 32.9],
    [118.3000004, 33.0000006],
    [118.123456789012, 32.987654321098]
  ]
];

function polygonCollection(properties: object) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: SQUARE } }]
  };
}

describe('行政区边界的转换', () => {
  it('三级边界的输入和输出文件', () => {
    expect(BOUNDARY_SOURCES.map(({ input, output }) => [input, output])).toStrictEqual([
      ['江苏省界.json', 'jiangsu-province.json'],
      ['江苏省市界.json', 'jiangsu-city.json'],
      ['江苏省县界.json', 'jiangsu-county.json']
    ]);
  });

  it('坐标保留 6 位小数，去掉高程；只留名称和代码，去掉 crs', () => {
    const converted = source('jiangsu-county.json').convert({
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4490' } },
      features: [
        {
          type: 'Feature',
          properties: { name: '邳州市', gb: '156320382', extra: 1 },
          geometry: { type: 'MultiPolygon', coordinates: [[[[118.1234567, 34.7654321, 12], ...SQUARE[0]]]] }
        }
      ]
    });

    expect(converted).toStrictEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: '邳州市', code: '156320382' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [118.123457, 34.765432],
                  [118.123457, 32.987654],
                  [118.2, 32.9],
                  [118.3, 33.000001],
                  [118.123457, 32.987654]
                ]
              ]
            ]
          }
        }
      ]
    });
  });

  it('省界取 Name 和 adcode，市界取 Name 和 code；Polygon 也照样转换', () => {
    const province = source('jiangsu-province.json').convert(
      polygonCollection({ Name: '江苏省', adcode: '320000', code: '112320000000000' })
    );
    const city = source('jiangsu-city.json').convert(polygonCollection({ Name: '南京市', code: '320100000000' }));

    expect(province.features[0]?.properties).toStrictEqual({ name: '江苏省', code: '320000' });
    expect(city.features[0]?.properties).toStrictEqual({ name: '南京市', code: '320100000000' });
    expect(city.features[0]?.geometry).toStrictEqual({
      type: 'Polygon',
      coordinates: [
        [
          [118.123457, 32.987654],
          [118.2, 32.9],
          [118.3, 33.000001],
          [118.123457, 32.987654]
        ]
      ]
    });
  });

  it.each([
    ['缺少名称字段', { gb: '156320382' }, { type: 'Polygon', coordinates: SQUARE }],
    ['代码不是字符串', { name: '邳州市', gb: 156320382 }, { type: 'Polygon', coordinates: SQUARE }],
    ['不是面', { name: '邳州市', gb: '156320382' }, { type: 'LineString', coordinates: SQUARE[0] }]
  ])('原始文件的结构不符合时报错（%s）', (_, properties, geometry) => {
    const convert = () =>
      source('jiangsu-county.json').convert({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties, geometry }]
      });

    expect(convert).toThrow(ZodError);
  });

  it('没有要素时报错', () => {
    expect(() => source('jiangsu-county.json').convert({ type: 'FeatureCollection', features: [] })).toThrow(ZodError);
  });
});
