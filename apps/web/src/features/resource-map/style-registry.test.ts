// @vitest-environment node
import { type StyleSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import type { Resource, ResourceGeometry } from './catalog';
import { valueColors } from './classification';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { paletteColor, RESOURCE_PALETTE } from './palette';
import { classDefaultSymbol, defaultSymbol, resourceStyle, resourceStyleLayers, sourceLayerOf } from './style-registry';
import { type ResourceSymbol, sizeCurve, sizePixels, symbolLayers } from './symbols';
import {
  colorOf,
  defaultColorExpression as colorExpression,
  normalizeColor as color,
  paintValueOf,
  parsesAsColor
} from './test-expression';

function resource(code: string, geometry: ResourceGeometry, index = 0): Resource {
  return { code, name: code, geometry, years: [2025], categoryId: '测试', index };
}

// 主图层：没有拆层时就是唯一的图层
const mainLayer = (...args: Parameters<typeof resourceStyleLayers>) => resourceStyleLayers(...args).parts[0];
const mainOf = (symbol: ResourceSymbol) => symbolLayers(symbol).parts[0];

function colorRuleOf(code: string) {
  const rule = resourceStyle(code).color;
  if (!rule) {
    throw new Error(`${code} 没有按属性配色`);
  }
  return rule;
}

describe('配色板', () => {
  it('10 种颜色互不相同，按目录顺序循环取', () => {
    expect(new Set(RESOURCE_PALETTE).size).toBe(10);
    expect([0, 1, 9, 10, 13].map(paletteColor)).toStrictEqual([
      RESOURCE_PALETTE[0],
      RESOURCE_PALETTE[1],
      RESOURCE_PALETTE[9],
      RESOURCE_PALETTE[0],
      RESOURCE_PALETTE[3]
    ]);
  });
});

describe('按属性配色', () => {
  it('按取值对照（水域线层的 ccn）：命中用对照的颜色，其他值和缺少属性用兜底色', () => {
    const expression = colorExpression(colorRuleOf('csxhjctb_hydl'));

    expect(colorOf(expression, { ccn: '河流' })).toBe(color('#1E88E5'));
    expect(colorOf(expression, { ccn: '水渠' })).toBe(color('#4FC3F7'));
    expect(colorOf(expression, { ccn: '湖泊' })).toBe(color('#2F80ED'));
    expect(colorOf(expression, {})).toBe(color('#2F80ED'));
  });

  it('按取值的顺序取色（城镇村等用地的 czclx）：每次一样，8 个取值颜色互不相同，包括旧项目漏掉的 201A、202A', () => {
    const rule = colorRuleOf('bgdc_czcdyd');
    if (rule.kind !== 'ordered') {
      throw new Error('城镇村等用地应按取值的顺序取色');
    }

    expect(valueColors(rule)).toStrictEqual(rule.values.map((value, index) => [value, RESOURCE_PALETTE[index]]));
    expect(new Set(valueColors(rule).map(([, value]) => value)).size).toBe(8);
    const expression = colorExpression(rule);
    expect(colorOf(expression, { czclx: '201A' })).toBe(color(paletteColor(1)));
    expect(colorOf(expression, { czclx: '205' })).toBe(color(paletteColor(7)));
    expect(colorOf(expression, { czclx: '206' })).toBe(color(LANDUSE_FALLBACK_COLOR));
  });

  it('登记的规则都能被 MapLibre 解析', () => {
    const codes = ['bgdc_dltb', 'bgdc_dltb_czc', 'bgdc_czcdyd', 'csxhjctb_hydl', 'csxhjctb_lvll'];

    expect(codes.filter(code => !parsesAsColor(colorExpression(colorRuleOf(code))))).toStrictEqual([]);
  });
});

describe('登记表', () => {
  it('只有地类图斑默认勾选，它带 promoteId、不限制最小级别', () => {
    expect(resourceStyle('bgdc_dltb')).toMatchObject({ checked: true, promoteId: 'bsm' });
    expect(resourceStyle('bgdc_dltb').minzoom).toBeUndefined();
    expect(resourceStyle('bgdc_cjdcq').checked).toBeUndefined();
  });

  it('重的资源有最小显示级别', () => {
    const minzooms = ['csxhjctb_hyda', 'bgdc_cjdcq', 'bgdc_xzq'].map(code => resourceStyle(code).minzoom);
    expect(minzooms).toStrictEqual([10, 9, 8]);
  });

  it('没登记的资源（包括和原型上的属性同名的）没有特别的样式', () => {
    expect(resourceStyle('szy_kt')).toStrictEqual({});
    expect(resourceStyle('constructor')).toStrictEqual({});
  });

  it('瓦片里的图层名默认是"code_年份"，两个例外只对那一年生效', () => {
    expect(sourceLayerOf('bgdc_dltb', 2022)).toBe('bgdc_dltb_2022');
    expect(sourceLayerOf('bgdc_czcdyd', 2022)).toBe('czcdyd');
    expect(sourceLayerOf('bgdc_dltb_czc', 2021)).toBe('dltb_czc_2021');
    expect(sourceLayerOf('bgdc_czcdyd', 2023)).toBe('bgdc_czcdyd_2023');
  });
});

describe('默认样式', () => {
  it('单一配色的面：半透明填充加同色描边，颜色按目录顺序取', () => {
    expect(mainLayer(resource('szy_kt', 'fill', 1))).toStrictEqual({
      type: 'fill',
      paint: { 'fill-color': 'rgba(22,179,179,0.35)', 'fill-outline-color': RESOURCE_PALETTE[1] }
    });
  });

  it('按属性配色的面用实色，不另设描边', () => {
    expect(mainLayer(resource('bgdc_dltb', 'fill'))).toStrictEqual({
      type: 'fill',
      paint: { 'fill-color': colorExpression(colorRuleOf('bgdc_dltb')) }
    });
  });

  it('线是实色；点是实色加白描边；按属性配色时颜色换成表达式', () => {
    expect(mainLayer(resource('bgdc_cjdcqjx', 'line', 2))).toMatchObject({
      type: 'line',
      paint: { 'line-color': RESOURCE_PALETTE[2] }
    });
    expect(mainLayer(resource('csxhjctb_hydl', 'line', 2))).toMatchObject({
      paint: { 'line-color': colorExpression(colorRuleOf('csxhjctb_hydl')) }
    });
    expect(mainLayer(resource('csxhjctb_gyssp', 'circle', 3))).toMatchObject({
      type: 'circle',
      paint: { 'circle-color': RESOURCE_PALETTE[3], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1 }
    });
  });

  it('覆盖叠加到默认符号上（ADR 0044）：线宽、线型、颜色都换成覆盖的值', () => {
    const line = resource('bgdc_cjdcqjx', 'line', 2);

    const uniform = { width: 'L', dash: 'dashed', color: 'rgba(0, 0, 0, 1)' } as const;
    expect(mainLayer(line, undefined, { uniform })).toMatchObject({
      paint: { 'line-color': 'rgba(0, 0, 0, 1)', 'line-width': sizeCurve('line', 'L'), 'line-dasharray': [3, 2] }
    });
    expect(defaultSymbol(line)).toStrictEqual({ geometry: 'line', color: RESOURCE_PALETTE[2], width: 'M', dash: 'solid' });
  });

  it('面的默认符号（ADR 0045）：均匀填充、1 像素实线描边；统一样式的纹理颜色是不透明的配色板颜色，分类样式是取值的颜色', () => {
    const pond = resource('szy_kt', 'fill', 1);

    expect(defaultSymbol(pond)).toStrictEqual({
      geometry: 'fill',
      fillColor: 'rgba(22,179,179,0.35)',
      fillStyle: 'solid',
      patternColor: RESOURCE_PALETTE[1],
      outlineColor: RESOURCE_PALETTE[1],
      outlineWidth: 'M',
      outlineDash: 'solid'
    });
    expect(classDefaultSymbol(pond, { key: '0101', label: '水田', color: '#F8D072' })).toStrictEqual({
      geometry: 'fill',
      fillColor: '#F8D072',
      fillStyle: 'solid',
      patternColor: '#F8D072',
      outlineColor: '#F8D072',
      outlineWidth: 'M',
      outlineDash: 'solid'
    });
  });

  it('按属性配色的资源：分类样式用各取值的覆盖、不受统一样式的覆盖影响；选了统一样式时用统一样式', () => {
    const hydl = resource('csxhjctb_hydl', 'line', 2);
    const items = { 水渠: { width: 'XL' } } as const;
    const override = { uniform: { color: 'rgba(0, 0, 0, 1)' }, items };

    const classified = mainLayer(hydl, undefined, override);
    expect(classified).toStrictEqual(mainLayer(hydl, undefined, { items }));
    const width = classified.type === 'line' ? classified.paint['line-width'] : undefined;
    expect(paintValueOf('line', 'line-width', width, { ccn: '水渠' }, 14)).toBe(sizePixels('line', 'XL'));
    expect(paintValueOf('line', 'line-width', width, { ccn: '河流' }, 14)).toBe(sizePixels('line', 'M'));

    expect(mainLayer(hydl, undefined, { ...override, mode: 'uniform' })).toStrictEqual(
      mainOf({ geometry: 'line', color: 'rgba(0, 0, 0, 1)', width: 'M', dash: 'solid' })
    );
  });

  it('各种组合放进样式都能通过 MapLibre 的校验', () => {
    const resources = [
      resource('szy_kt', 'fill'),
      resource('bgdc_dltb', 'fill'),
      resource('bgdc_dltb_czc', 'fill'),
      resource('bgdc_czcdyd', 'fill'),
      resource('bgdc_cjdcqjx', 'line'),
      resource('csxhjctb_hydl', 'line'),
      resource('csxhjctb_lvll', 'line'),
      resource('csxhjctb_gyssp', 'circle')
    ];
    const style: StyleSpecification = {
      version: 8,
      sources: { tiles: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] } },
      layers: resources.map(item =>
        Object.assign({ id: item.code, source: 'tiles', 'source-layer': item.code }, mainLayer(item))
      )
    };

    expect(validateStyleMin(style)).toStrictEqual([]);
  });
});
