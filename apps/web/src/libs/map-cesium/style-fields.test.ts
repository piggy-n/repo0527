// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FillLayerSpecification, VectorSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { styleFields } from './style-fields';

const source: VectorSourceSpecification = { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] };
const layer: FillLayerSpecification = { id: 'area', type: 'fill', source: 'data', 'source-layer': 'land' };

describe('MVT 样式字段', () => {
  it('从规范库树提取属性、旧过滤与身份字段的并集', () => {
    expect(styleFields({ ...layer, paint: { 'fill-color': ['match', ['get', 'kind'], 'a', '#fff', '#000'] },
      filter: ['all', ['==', 'year', 2022], ['has', 'name']] }, { ...source, promoteId: 'bsm' }))
      .toEqual(['bsm', 'kind', 'name', 'year']);
  });

  it('常量和 literal 数据不误作要素字段，按 source-layer 选择身份字段', () => {
    expect(styleFields({ ...layer, filter: ['in', ['id'], ['literal', ['get', 'fake']]] },
      { ...source, promoteId: { land: 'guid', other: 'unused' } })).toEqual(['guid']);
  });

  it('动态字段和整属性对象不能裁剪，常量字段不依赖数据', () => {
    expect(styleFields({ ...layer, filter: ['has', ['string', ['get', 'field']]] }, source)).toBeNull();
    expect(styleFields({ ...layer, filter: ['has', 'name', ['properties']] }, source)).toBeNull();
    expect(styleFields({ ...layer, paint: { 'fill-color': '#00ff00' } }, source)).toEqual([]);
  });
});
