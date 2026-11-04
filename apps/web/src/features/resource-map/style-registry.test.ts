// @vitest-environment node
import { type StyleSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import type { Resource, ResourceGeometry } from './catalog';
import { classItems, OTHER_ITEM } from './classification';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { paletteColor, RESOURCE_PALETTE } from './palette';
import {
  classDefaultSymbol,
  defaultSymbol,
  resourceStyle,
  resourceStyleLayers,
  sourceLayerOf,
  symbolModeOf
} from './style-registry';
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

// 登记表里按属性配色的全部资源（ADR 0123）：加了规则要加到这里
const RULE_CODES = [
  'bgdc_dltb',
  'bgdc_dltb_czc',
  'bgdc_czcdyd',
  'lcsh_sltb',
  'lcsh_cdtb',
  'lcsh_sdtb',
  'lcsh_hmtb',
  'csxhjctb_xxa',
  'csxhjctb_xxp',
  'csxhjctb_yljga',
  'csxhjctb_yljgp',
  'csxhjctb_fljga',
  'csxhjctb_fljgp',
  'csxhjctb_gyssa',
  'csxhjctb_gyssp',
  'csxhjctb_gyylda',
  'csxhjctb_jtfwcza',
  'csxhjctb_jtysyda',
  'csxhjctb_jtysydp',
  'csxhjctb_syfwya',
  'csxhjctb_syfwyp',
  'csxhjctb_czzza',
  'csxhjctb_xzcsgxgzyda',
  'csxhjctb_yjbna',
  'csxhjctb_hydl',
  'csxhjctb_hyda',
  'csxhjctb_lvll',
  'csxhjctb_lrdl',
  'csxhjctb_lctl',
  'csxhjctb_llkl',
  'csxhjctb_llkp',
  'csxhjctb_lrrl',
  'gtkjgh_czkfbj',
  'gtkjgh_stbhhx',
  'gtkjgh_gdbhmb',
  'gtkjgh_yjjbntbhtb',
  'csxhjctb_wycga',
  'csxhjctb_wycgp',
  'csxhjctb_bzssa',
  'szy_hl_fs',
  'szy_hl_ks',
  'szy_sk_fs',
  'szy_sk_ks',
  'szy_hp_fs',
  'szy_hp_ks',
  'szy_kt',
  'bgdc_gddb',
  'bgdc_pzwjstd',
  'bgdc_xzqjx',
  'bgdc_cjdcqjx',
  'bgdc_yjjbnttb'
];

function repeated(list: readonly string[]) {
  return new Set(list).size !== list.length;
}

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

  it('城镇村等用地按 czclx：8 个取值的颜色和换成字典之前相同，图例写名称', () => {
    const rule = colorRuleOf('bgdc_czcdyd');
    if (rule.kind !== 'values') {
      throw new Error('城镇村等用地应按取值配色');
    }

    expect(rule.entries.map(({ color: value }) => value)).toStrictEqual(RESOURCE_PALETTE.slice(0, 8));
    expect(rule.entries.map(({ value, label }) => [value, label])).toStrictEqual([
      ['201', '201 城市用地'],
      ['201A', '201A 城市用地'],
      ['202', '202 建制镇用地'],
      ['202A', '202A 建制镇用地'],
      ['203', '203 村庄用地'],
      ['203A', '203A 村庄用地'],
      ['204', '204 采矿及盐田用地'],
      ['205', '205 风景名胜及特殊用地']
    ]);
    const expression = colorExpression(rule);
    expect(colorOf(expression, { czclx: '201A' })).toBe(color(paletteColor(1)));
    expect(colorOf(expression, { czclx: '205' })).toBe(color(paletteColor(7)));
    expect(colorOf(expression, { czclx: '206' })).toBe(color(LANDUSE_FALLBACK_COLOR));
  });

  it('登记的规则都能被 MapLibre 解析', () => {
    expect(RULE_CODES.filter(code => !parsesAsColor(colorExpression(colorRuleOf(code))))).toStrictEqual([]);
  });

  it('每条规则里的取值、名称、颜色都不重复：取值是符号覆盖的键，颜色相同分不清类别', () => {
    const problems = RULE_CODES.flatMap(code => {
      const rule = colorRuleOf(code);
      if (rule.kind !== 'values') {
        return [];
      }
      return repeated(rule.entries.map(item => item.value)) ||
        repeated(rule.entries.map(item => item.label)) ||
        repeated(rule.entries.map(item => item.color))
        ? [code]
        : [];
    });

    expect(problems).toStrictEqual([]);
  });

  it('按字段和字典分类：编码按 cc、学校的点层比面层少的取值只列实际有的，同一取值在点层、面层同色', () => {
    const entriesOf = (code: string) => {
      const rule = colorRuleOf(code);
      return rule.kind === 'values' ? rule.entries : [];
    };
    const schoolAreas = colorRuleOf('csxhjctb_xxa');
    const schoolPoints = entriesOf('csxhjctb_xxp');

    expect(schoolAreas).toMatchObject({ property: 'cc', fallback: LANDUSE_FALLBACK_COLOR });
    expect(schoolPoints.map(item => item.value)).toStrictEqual(['08H212', '08H213', '08H214', '08H215']);
    expect(schoolPoints.every(item => entriesOf('csxhjctb_xxa').includes(item))).toBe(true);
    const expression = colorExpression(colorRuleOf('csxhjctb_yljgp'));
    expect(colorOf(expression, { cc: '08H222' })).toBe(color(RESOURCE_PALETTE[2]));
    expect(colorOf(expression, { cc: '-9999' })).toBe(color(LANDUSE_FALLBACK_COLOR));
    // 早期年份缺字段的（福利机构 2022）全部归入"其他"，不按年份调整规则（ADR 0123）
    expect(colorOf(colorExpression(colorRuleOf('csxhjctb_fljga')), {})).toBe(color(LANDUSE_FALLBACK_COLOR));
  });

  it('cc 只有一个取值的资源不分类，保持统一样式', () => {
    const uniform = ['csxhjctb_tyhda', 'csxhjctb_tyhdp', 'csxhjctb_whhda', 'csxhjctb_jgtta', 'csxhjctb_sdza'];
    uniform.push('csxhjctb_dltbbha', 'csxhjctb_dltbbhp', 'bgdc_xzq', 'bgdc_cjdcq', 'bgdc_ccwjq');

    expect(uniform.filter(code => resourceStyle(code).color)).toStrictEqual([]);
  });

  it('水域面层多出湖泊、水库、坑塘、海面', () => {
    const expression = colorExpression(colorRuleOf('csxhjctb_hyda'));
    expect(colorOf(expression, { ccn: '河流' })).toBe(color('#1E88E5'));
    expect(colorOf(expression, { ccn: '坑塘' })).toBe(color('#80CBC4'));
  });
});

const FOREST = 'lcsh_sltb';
const GRASS = 'lcsh_cdtb';
const WETLAND = 'lcsh_sdtb';
const DESERT = 'lcsh_hmtb';

function keysOf(code: string) {
  return classItems(colorRuleOf(code)).map(item => item.key);
}

function labelOf(code: string, key: string) {
  return classItems(colorRuleOf(code)).find(item => item.key === key)?.label;
}

// 地图上这个取值的要素的属性
function propertiesOf(code: string, key: string, label: string): Record<string, string> {
  if (code === FOREST) {
    return { lin_zhong: key };
  }
  if (code === DESERT) {
    return { tu_rang_lx: key };
  }
  return key.startsWith('legacy:') ? { dlbm: '1208', dlmc: label } : { dlbm: key };
}

describe('林、草、湿、荒的分类（ADR 0124）', () => {
  it('字段按后端提供的：林按 lin_zhong，荒按 tu_rang_lx，草、湿按地类编码', () => {
    expect(colorRuleOf(FOREST)).toMatchObject({ kind: 'values', property: 'lin_zhong' });
    expect(colorRuleOf(DESERT)).toMatchObject({ kind: 'values', property: 'tu_rang_lx' });
    expect(colorRuleOf(GRASS).kind).toBe('landuse-code');
    expect(colorRuleOf(WETLAND).kind).toBe('landuse-code');
  });

  it('每个资源只列实际有的类别，不是地类的全表', () => {
    expect(keysOf(FOREST)).toHaveLength(19);
    expect(keysOf(DESERT)).toHaveLength(14);
    // 枚举的结果：草地 59 个、湿地 48 个地类，都有后备耕地（编码 1208 不在表 A.2，按名称匹配）
    expect(keysOf(GRASS)).toHaveLength(60);
    expect(keysOf(WETLAND)).toHaveLength(49);
    expect(keysOf(GRASS)).toEqual(expect.arrayContaining(['0404', '1107A', '1206', 'legacy:后备耕地', OTHER_ITEM]));
    expect(keysOf(WETLAND)).toEqual(expect.arrayContaining(['1106', '1105', '1001', 'legacy:后备耕地', OTHER_ITEM]));
    // 湿地里没有这些
    expect(keysOf(WETLAND)).not.toContain('1107A');
    expect(keysOf(WETLAND)).not.toContain('0103K');
    expect(keysOf(WETLAND)).not.toContain('1002');
  });

  it('名称按代码表；代码表里没有的 120、122 先显示编码', () => {
    expect(labelOf(FOREST, '233')).toBe('一般用材林');
    expect(labelOf(FOREST, '126')).toBe('名胜古迹和革命纪念林');
    expect(labelOf(DESERT, '111')).toBe('黄棕壤');
    expect(labelOf(DESERT, '211')).toBe('水稻土');
    expect(labelOf(DESERT, '120')).toBe('120');
    expect(labelOf(DESERT, '122')).toBe('122');
  });

  it('图例和地图一致：图例上每一项的颜色，就是地图上这个取值画出的颜色', () => {
    for (const code of [FOREST, GRASS, WETLAND, DESERT]) {
      const rule = colorRuleOf(code);
      const expression = colorExpression(rule);
      const drawn = classItems(rule).filter(item => item.key !== OTHER_ITEM);
      const expected = drawn.map(item => [item.key, color(item.color)]);

      expect(drawn.map(item => [item.key, colorOf(expression, propertiesOf(code, item.key, item.label))])).toStrictEqual(
        expected
      );
    }
  });

  it('图例没有的取值在地图上归入"其他"：不会出现图例里找不到的颜色', () => {
    const fallback = color(LANDUSE_FALLBACK_COLOR);

    // 林种有约四分之一是空字符串
    expect(colorOf(colorExpression(colorRuleOf(FOREST)), { lin_zhong: '' })).toBe(fallback);
    expect(colorOf(colorExpression(colorRuleOf(DESERT)), { tu_rang_lx: '999' })).toBe(fallback);
    expect(colorOf(colorExpression(colorRuleOf(WETLAND)), { dlbm: '1002', dlmc: '轨道交通用地' })).toBe(fallback);
  });
});

// 规则的字段（地类规则写种类）和不含兜底的取值数
function fieldOf(code: string) {
  const rule = colorRuleOf(code);
  return rule.kind === 'values' ? [rule.property, rule.entries.length] : [rule.kind, classItems(rule).length - 1];
}

function colorAt(code: string, properties: Record<string, string>) {
  return colorOf(colorExpression(colorRuleOf(code)), properties);
}

describe('其余资源的分类', () => {
  it('字段和取值数', () => {
    const expected = {
      bgdc_xzqjx: ['jxlx', 6],
      bgdc_cjdcqjx: ['jxlx', 5],
      bgdc_pzwjstd: ['ywlx', 5],
      bgdc_gddb: ['lyd', 4],
      bgdc_yjjbnttb: ['dlmc', 10],
      szy_hl_fs: ['hldj', 9],
      szy_hl_ks: ['hldj', 9],
      szy_sk_fs: ['skdb', 4],
      szy_sk_ks: ['skdb', 4],
      szy_hp_fs: ['lymc', 2],
      szy_hp_ks: ['lymc', 2],
      szy_kt: ['lymc', 2],
      csxhjctb_wycga: ['type', 9],
      csxhjctb_wycgp: ['type', 9],
      csxhjctb_bzssa: ['type', 4],
      gtkjgh_gdbhmb: ['landuse-code', 3],
      gtkjgh_yjjbntbhtb: ['landuse-code', 3]
    };

    expect(Object.fromEntries(Object.keys(expected).map(code => [code, fieldOf(code)]))).toStrictEqual(expected);
  });

  it('复合值和"其他"归入"其他"，不单独成类；水库的 N/A 同样', () => {
    const fallback = color(LANDUSE_FALLBACK_COLOR);
    const venue = colorExpression(colorRuleOf('csxhjctb_wycga'));

    expect(colorOf(venue, { type: '博物馆' })).not.toBe(fallback);
    expect(colorOf(venue, { type: '博物馆/展览馆' })).toBe(fallback);
    expect(colorOf(venue, { type: '其他' })).toBe(fallback);
    expect(colorOf(colorExpression(colorRuleOf('szy_sk_fs')), { skdb: 'N/A' })).toBe(fallback);
  });

  it('同一个字典在几个资源上同色：行政区界线和村级调查区界线的县级界线、丰水期和枯水期的河流', () => {
    expect(colorAt('bgdc_cjdcqjx', { jxlx: '650200' })).toBe(colorAt('bgdc_xzqjx', { jxlx: '650200' }));
    expect(colorAt('szy_hl_ks', { hldj: '8' })).toBe(colorAt('szy_hl_fs', { hldj: '8' }));
    // 村级调查区界线没有岛屿岸线
    expect(colorAt('bgdc_cjdcqjx', { jxlx: '250202' })).toBe(color(LANDUSE_FALLBACK_COLOR));
  });

  it('永久基本农田图斑按名称，颜色取地类表：表外的旧名称也有颜色', () => {
    const expression = colorExpression(colorRuleOf('bgdc_yjjbnttb'));

    expect(colorOf(expression, { dlmc: '水田', dlbm: '011' })).toBe(color('rgb(248, 208, 114)'));
    expect(colorOf(expression, { dlmc: '有林地' })).toBe(color('rgb(49, 173, 105)'));
    expect(colorOf(expression, { dlmc: '村庄' })).toBe(color('rgb(236, 137, 138)'));
  });

  it('加了分类的重资源仍有最小显示级别', () => {
    expect(resourceStyle('bgdc_yjjbnttb').minzoom).toBe(8);
    expect(resourceStyle('csxhjctb_lrdl').minzoom).toBe(9);
  });
});

describe('登记表', () => {
  it('只有地类图斑默认勾选，它带 promoteId、不限制最小级别', () => {
    expect(resourceStyle('bgdc_dltb')).toMatchObject({ checked: true, promoteId: 'bsm' });
    expect(resourceStyle('bgdc_dltb').minzoom).toBeUndefined();
    expect(resourceStyle('bgdc_cjdcq').checked).toBeUndefined();
  });

  it('最小显示级别是单张瓦片 6 MB 的实测结果（ADR 0132）', () => {
    const limited = {
      csxhjctb_lrdl: 9,
      csxhjctb_lctl: 9,
      csxhjctb_lvll: 8,
      bgdc_yjjbnttb: 8,
      bgdc_lmfw: 8,
      szy_hl_fs: 8,
      szy_hl_ks: 8
    };
    const levels = Object.keys(limited).map(code => [code, resourceStyle(code).minzoom]);
    expect(Object.fromEntries(levels)).toStrictEqual(limited);
    // 旧环境上要限制，新环境实测不用了
    const freed = ['csxhjctb_hyda', 'bgdc_cjdcq', 'bgdc_cjdcqjx', 'bgdc_ttq', 'bgdc_xzq'];
    expect(freed.filter(code => resourceStyle(code).minzoom !== undefined)).toStrictEqual([]);
  });

  it('开关打开时按登记表；关闭时都没有最小显示级别，别的样式不变（ADR 0132）', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', 'true');
    const enabled = await import('./style-registry');
    expect(enabled.resourceStyle('csxhjctb_lrdl').minzoom).toBe(9);

    vi.resetModules();
    vi.stubEnv('VITE_RESOURCE_MIN_ZOOM_ENABLED', 'false');
    const disabled = await import('./style-registry');
    expect(disabled.resourceStyle('csxhjctb_lrdl')).not.toHaveProperty('minzoom');
    expect(disabled.resourceStyle('csxhjctb_lrdl').color).toStrictEqual(enabled.resourceStyle('csxhjctb_lrdl').color);
    expect(disabled.resourceStyle('bgdc_lmfw')).toStrictEqual({});
  });

  it('没登记的资源（包括和原型上的属性同名的）没有特别的样式', () => {
    expect(resourceStyle('bgdc_ccwjq')).toStrictEqual({});
    expect(resourceStyle('constructor')).toStrictEqual({});
  });

  it('瓦片里的图层名默认是"code_年份"，例外只对那一年生效', () => {
    expect(sourceLayerOf('bgdc_dltb', 2022)).toBe('bgdc_dltb_2022');
    expect(sourceLayerOf('bgdc_czcdyd', 2022)).toBe('bgdc_czcdyd_2022');
    expect(sourceLayerOf('bgdc_dltb_czc', 2021)).toBe('dltb_czc_2021');
    expect(sourceLayerOf('bgdc_dltb_czc', 2022)).toBe('bgdc_dltb_czc_2022');
  });
});

describe('默认样式', () => {
  it('单一配色的面：半透明填充加同色描边，颜色按目录顺序取', () => {
    expect(mainLayer(resource('bgdc_ccwjq', 'fill', 1))).toStrictEqual({
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
    expect(mainLayer(resource('csxhjctb_csnljsl', 'line', 2))).toMatchObject({
      type: 'line',
      paint: { 'line-color': RESOURCE_PALETTE[2] }
    });
    expect(mainLayer(resource('csxhjctb_hydl', 'line', 2))).toMatchObject({
      paint: { 'line-color': colorExpression(colorRuleOf('csxhjctb_hydl')) }
    });
    expect(mainLayer(resource('csxhjctb_tyhdp', 'circle', 3))).toMatchObject({
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

  it('面的默认符号（ADR 0045、0046）：均匀填充、1 像素实线描边；统一样式的纹理颜色是不透明的配色板颜色，分类样式是取值的颜色加深', () => {
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
      patternColor: 'rgba(141,119,69,1)',
      outlineColor: '#F8D072',
      outlineWidth: 'M',
      outlineDash: 'solid'
    });
  });

  it('按属性配色的资源：分类样式用各取值的覆盖、不受统一样式的覆盖影响；选了统一样式时用统一样式', () => {
    const hydl = resource('csxhjctb_hydl', 'line', 2);
    const items = { 水渠: { width: 'XL' } } as const;
    const uniform = { color: 'rgba(0, 0, 0, 1)' };
    const override = { uniform, items };

    const classified = mainLayer(hydl, undefined, { ...override, mode: 'classified' });
    expect(classified).toStrictEqual(mainLayer(hydl, undefined, { items }));
    const width = classified.type === 'line' ? classified.paint['line-width'] : undefined;
    expect(paintValueOf('line', 'line-width', width, { ccn: '水渠' }, 14)).toBe(sizePixels('line', 'XL'));
    expect(paintValueOf('line', 'line-width', width, { ccn: '河流' }, 14)).toBe(sizePixels('line', 'M'));

    expect(mainLayer(hydl, undefined, { ...override, mode: 'uniform' })).toStrictEqual(
      mainOf({ geometry: 'line', color: 'rgba(0, 0, 0, 1)', width: 'M', dash: 'solid' })
    );
  });

  it('没选过方式时：调过统一样式的资源按统一样式，否则按分类样式（ADR 0123 第 3 节）', () => {
    const style = resourceStyle('csxhjctb_xxa');
    const uniform = { fillColor: 'rgba(0, 0, 0, 1)' };

    expect(symbolModeOf(style)).toBe('classified');
    expect(symbolModeOf(style, { items: { '08H211': uniform } })).toBe('classified');
    expect(symbolModeOf(style, { uniform })).toBe('uniform');
    expect(symbolModeOf(style, { uniform, mode: 'classified' })).toBe('classified');
    expect(symbolModeOf(style, { mode: 'uniform' })).toBe('uniform');
    // 不按属性配色的资源只有统一样式
    expect(symbolModeOf(resourceStyle('csxhjctb_tyhda'), { mode: 'classified' })).toBe('uniform');
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
      resource('csxhjctb_tyhdp', 'circle')
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
