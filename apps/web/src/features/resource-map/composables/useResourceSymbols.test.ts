// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog, type ResourceCatalog } from '../catalog';
import { defaultSymbol } from '../style-registry';
import type { ColorField, FillStyle, LineDash, SymbolField } from '../symbols';
import { useResourceSymbols } from './useResourceSymbols';

function layer(code: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name: code, geoType, yearList: [2022] as [number] };
}

// 点、线、面各一个统一符号，水域线层按取值配色
const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('csxhjctb_gyssp', 'Point'),
      layer('bgdc_cjdcqjx', 'Line'),
      layer('szy_kt', 'Polygon'),
      layer('csxhjctb_hydl', 'Line')
    ]
  }
]);

function defaultOf(code: string) {
  const resource = CATALOG.resources.get(code);
  if (!resource) {
    throw new Error(`目录里没有 ${code}`);
  }
  return defaultSymbol(resource);
}

function defaultColor(code: string, field: ColorField): string {
  const symbol: Partial<Record<SymbolField, unknown>> = defaultOf(code);
  const color = symbol[field];
  if (typeof color !== 'string') {
    throw new Error(`${code} 的默认符号没有 ${field}`);
  }
  return color;
}

// 目录为 null 表示还没加载
function setup(catalog: ResourceCatalog | null = CATALOG) {
  const scope = effectScope();
  const source = shallowRef(catalog ?? undefined);
  const symbols = scope.run(() => useResourceSymbols({ catalog: source }));
  if (!symbols) {
    throw new Error('拥有者没有创建');
  }
  return { symbols, catalog: source, [Symbol.dispose]: () => scope.stop() };
}

describe('useResourceSymbols', () => {
  it('改统一样式：只记和默认不同的字段，颜色规范化；改回默认的字段删掉，都改回时删掉这个资源', () => {
    using ctx = setup();
    const { symbols } = ctx;

    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { fillColor: '#000', size: 'L' });
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({
      uniform: { size: 'L', fillColor: 'rgba(0, 0, 0, 1)' }
    });
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(true);
    expect(symbols.isCustomized('szy_kt')).toBe(false);

    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 'M' });
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { fillColor: 'rgba(0, 0, 0, 1)' } });

    // 默认颜色换一种写法也算改回默认
    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { fillColor: defaultColor('csxhjctb_gyssp', 'fillColor').toLowerCase() });
    expect(symbols.overrides.value.has('csxhjctb_gyssp')).toBe(false);
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(false);
  });

  it('值为 undefined 的字段不算改动；自定义大小按步长取整', () => {
    using ctx = setup();
    const { symbols } = ctx;

    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 4.26, strokeWidth: 3 });
    symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { width: 0.64, dash: 'dotted' });
    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { strokeWidth: undefined });

    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { size: 4.5, strokeWidth: 3 } });
    expect(symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { width: 0.6, dash: 'dotted' } });
  });

  it('值没变时不替换覆盖', () => {
    using ctx = setup();
    const { symbols } = ctx;
    const empty = symbols.overrides.value;

    symbols.resetSymbol({ code: 'szy_kt' });
    symbols.resetAll();
    symbols.setSymbol({ code: 'szy_kt' }, { outlineColor: defaultColor('szy_kt', 'outlineColor') });
    expect(symbols.overrides.value).toBe(empty);

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: 'rgba(0, 0, 255, 0.5)' });
    const changed = symbols.overrides.value;
    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#0000FF80' });
    expect(symbols.overrides.value).toBe(changed);
  });

  it('参数不合法时抛错，覆盖不变', () => {
    using ctx = setup();
    const { symbols } = ctx;
    const before = symbols.overrides.value;

    expect(() => symbols.setSymbol({ code: 'nope' }, { size: 'L' })).toThrow('不在目录里');
    expect(() => symbols.setSymbol({ code: 'csxhjctb_hydl', item: '湖泊' }, { color: '#000' })).toThrow('没有取值 湖泊');
    expect(() => symbols.setSymbol({ code: 'szy_kt', item: '河流' }, { fillColor: '#000' })).toThrow('没有取值 河流');
    expect(() => symbols.setMode('szy_kt', 'uniform')).toThrow('不按属性配色');
    expect(() => symbols.setMode('nope', 'uniform')).toThrow('不在目录里');
    expect(() => symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { color: '#000' })).toThrow('没有 color');
    expect(() => symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '不是颜色' })).toThrow('不是颜色');
    expect(() => symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 25 })).toThrow(RangeError);
    expect(() => symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { width: 0.2 })).toThrow(RangeError);
    expect(() => symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { strokeWidth: 1.5 })).toThrow('描边宽度');
    // 类型不允许，模拟界面传来的脏值
    expect(() => symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { dash: 'wavy' as LineDash })).toThrow('没有线型');
    expect(() => symbols.previewColor({ code: 'csxhjctb_gyssp' }, 'color', '#000')).toThrow('没有 color');
    expect(() => symbols.previewColor({ code: 'szy_kt' }, 'fillColor', '不是颜色')).toThrow('不是颜色');
    expect(symbols.overrides.value).toBe(before);
    expect(symbols.preview.value).toBeNull();
  });

  it('面的描边与纹理（ADR 0045）：描边宽度按 0.1 取整、0～8，0 也可以；填充方式、描边线型要在范围里；纹理颜色规范化、可以预览', () => {
    using ctx = setup();
    const { symbols } = ctx;
    const pond = { code: 'szy_kt' };

    symbols.setSymbol(pond, { outlineWidth: 2.34, fillStyle: 'dot', patternColor: '#000', outlineDash: 'dashed' });
    expect(symbols.overrides.value.get('szy_kt')).toStrictEqual({
      uniform: { fillStyle: 'dot', patternColor: 'rgba(0, 0, 0, 1)', outlineWidth: 2.3, outlineDash: 'dashed' }
    });
    symbols.setSymbol(pond, { outlineWidth: 0 });
    expect(symbols.symbolOf(pond)).toMatchObject({ outlineWidth: 0 });

    expect(() => symbols.setSymbol(pond, { outlineWidth: 8.5 })).toThrow(RangeError);
    // 类型不允许，模拟界面传来的脏值
    expect(() => symbols.setSymbol(pond, { fillStyle: 'wave' as FillStyle })).toThrow('没有填充方式');
    expect(() => symbols.setSymbol(pond, { outlineDash: 'wavy' as LineDash })).toThrow('没有线型');
    expect(() => symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { outlineWidth: 2 })).toThrow('没有 outlineWidth');

    symbols.previewColor(pond, 'patternColor', '#F00');
    expect(symbols.overrideOf('szy_kt')?.uniform).toMatchObject({ patternColor: 'rgba(255, 0, 0, 1)' });
  });

  it('目录还没加载时操作抛错', () => {
    using ctx = setup(null);

    expect(() => ctx.symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' })).toThrow('不在目录里');
    expect(ctx.symbols.symbolOf({ code: 'szy_kt' })).toBeNull();
  });

  it('预览参与推导、不写入覆盖；同一时间只有一个；确认时写入并清掉预览，丢弃时回到原来的颜色', () => {
    using ctx = setup();
    const { symbols } = ctx;

    symbols.previewColor({ code: 'csxhjctb_gyssp' }, 'fillColor', '#00FF00');
    expect(symbols.overrides.value.size).toBe(0);
    expect(symbols.overrideOf('csxhjctb_gyssp')).toStrictEqual({ uniform: { fillColor: 'rgba(0, 255, 0, 1)' } });
    // 编辑器显示确认过的符号，取色器的值不跟着预览走（否则取消时会重置成预览的颜色）
    expect(symbols.symbolOf({ code: 'csxhjctb_gyssp' })).toStrictEqual(defaultOf('csxhjctb_gyssp'));

    symbols.previewColor({ code: 'bgdc_cjdcqjx' }, 'color', '#0000FF');
    expect(symbols.overrideOf('csxhjctb_gyssp')).toBeUndefined();

    // 确认别的资源不影响这个预览
    symbols.setSymbol({ code: 'szy_kt' }, { outlineColor: '#000' });
    expect(symbols.preview.value).toStrictEqual({ code: 'bgdc_cjdcqjx', field: 'color', color: 'rgba(0, 0, 255, 1)' });

    symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { color: '#0000FF' });
    expect(symbols.preview.value).toBeNull();
    expect(symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { color: 'rgba(0, 0, 255, 1)' } });

    symbols.previewColor({ code: 'bgdc_cjdcqjx' }, 'color', '#FF0000');
    expect(symbols.overrideOf('bgdc_cjdcqjx')).toStrictEqual({ uniform: { color: 'rgba(255, 0, 0, 1)' } });
    symbols.clearPreview();
    expect(symbols.overrideOf('bgdc_cjdcqjx')).toStrictEqual({ uniform: { color: 'rgba(0, 0, 255, 1)' } });
  });

  it('取色器报回确认的颜色（取消、打开时）：清掉这个字段的预览，不设新的预览；别的字段的预览不动', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setSymbol({ code: 'szy_kt' }, { outlineColor: '#000' });

    // 打开时报一次换了写法的确认值
    symbols.previewColor({ code: 'szy_kt' }, 'outlineColor', 'rgb(0, 0, 0)');
    symbols.previewColor({ code: 'szy_kt' }, 'fillColor', defaultColor('szy_kt', 'fillColor'));
    expect(symbols.preview.value).toBeNull();

    symbols.previewColor({ code: 'szy_kt' }, 'outlineColor', '#F00');
    symbols.previewColor({ code: 'szy_kt' }, 'fillColor', defaultColor('szy_kt', 'fillColor'));
    expect(symbols.preview.value).toStrictEqual({ code: 'szy_kt', field: 'outlineColor', color: 'rgba(255, 0, 0, 1)' });

    // 取消时重置回确认的值
    symbols.previewColor({ code: 'szy_kt' }, 'outlineColor', 'rgba(0, 0, 0, 1)');
    expect(symbols.preview.value).toBeNull();
    expect(symbols.overrideOf('szy_kt')).toStrictEqual({ uniform: { outlineColor: 'rgba(0, 0, 0, 1)' } });
  });

  it('确认过的符号：统一样式对任何资源都有，取值用取值的颜色作默认；目录里没有的资源、规则里没有的取值为 null', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setSymbol({ code: 'bgdc_cjdcqjx' }, { dash: 'dashDot' });

    expect(symbols.symbolOf({ code: 'bgdc_cjdcqjx' })).toStrictEqual({ ...defaultOf('bgdc_cjdcqjx'), dash: 'dashDot' });
    expect(symbols.symbolOf({ code: 'szy_kt' })).toStrictEqual(defaultOf('szy_kt'));
    expect(symbols.symbolOf({ code: 'csxhjctb_hydl' })).toStrictEqual(defaultOf('csxhjctb_hydl'));
    expect(symbols.symbolOf({ code: 'csxhjctb_hydl', item: '水渠' })).toStrictEqual({
      geometry: 'line',
      color: '#4FC3F7',
      width: 'M',
      dash: 'solid'
    });
    expect(symbols.symbolOf({ code: 'csxhjctb_hydl', item: '湖泊' })).toBeNull();
    expect(symbols.symbolOf({ code: 'nope' })).toBeNull();
  });

  it('分类样式：按取值改符号，只记和取值默认不同的字段；取值的预览只叠加在这个取值上，确认别的取值不清掉它', () => {
    using ctx = setup();
    const { symbols } = ctx;
    const canal = { code: 'csxhjctb_hydl', item: '水渠' };
    const river = { code: 'csxhjctb_hydl', item: '河流' };

    symbols.setSymbol(canal, { color: '#4FC3F7', width: 'L' });
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ items: { 水渠: { width: 'L' } } });
    expect(symbols.hasOverride(canal)).toBe(true);
    expect(symbols.hasOverride(river)).toBe(false);
    expect(symbols.hasOverride({ code: 'csxhjctb_hydl' })).toBe(false);

    symbols.previewColor(river, 'color', '#000');
    symbols.setSymbol(canal, { dash: 'dotted' });
    expect(symbols.preview.value).toStrictEqual({ code: 'csxhjctb_hydl', item: '河流', field: 'color', color: 'rgba(0, 0, 0, 1)' });
    expect(symbols.overrideOf('csxhjctb_hydl')).toStrictEqual({
      items: { 水渠: { width: 'L', dash: 'dotted' }, 河流: { color: 'rgba(0, 0, 0, 1)' } }
    });

    symbols.setSymbol(river, { width: 'S' });
    expect(symbols.preview.value).toBeNull();
  });

  it('样式方式：默认分类；换成统一样式时各取值的覆盖保留，换回分类时不再记方式；只选了统一样式也算改过', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '水渠' }, { width: 'L' });
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('classified');
    expect(symbols.modeOf('szy_kt')).toBeNull();
    expect(symbols.modeOf('nope')).toBeNull();
    // 按属性配色，但不在目录里
    expect(symbols.modeOf('bgdc_dltb')).toBeNull();

    symbols.previewColor({ code: 'csxhjctb_hydl', item: '河流' }, 'color', '#000');
    symbols.setMode('csxhjctb_hydl', 'uniform');
    expect(symbols.preview.value).toBeNull();
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('uniform');
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ mode: 'uniform', items: { 水渠: { width: 'L' } } });

    symbols.resetSymbol({ code: 'csxhjctb_hydl', item: '水渠' });
    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ mode: 'uniform' });
    expect(symbols.isCustomized('csxhjctb_hydl')).toBe(true);

    const before = symbols.overrides.value;
    symbols.setMode('csxhjctb_hydl', 'uniform');
    expect(symbols.overrides.value).toBe(before);
    symbols.setMode('csxhjctb_hydl', 'classified');
    expect(symbols.overrides.value.has('csxhjctb_hydl')).toBe(false);
  });

  it('恢复一个资源：样式方式、统一样式、各取值和它的预览一起去掉，别的资源不动', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setMode('csxhjctb_hydl', 'uniform');
    symbols.setSymbol({ code: 'csxhjctb_hydl' }, { color: '#000' });
    symbols.setSymbol({ code: 'csxhjctb_hydl', item: '河流' }, { width: 'XL' });
    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    symbols.previewColor({ code: 'csxhjctb_hydl', item: '水渠' }, 'color', '#F00');

    symbols.resetResource('csxhjctb_hydl');
    expect([...symbols.overrides.value.keys()]).toStrictEqual(['szy_kt']);
    expect(symbols.preview.value).toBeNull();
  });

  it('恢复默认：单个资源连同它的预览；全部资源连同预览', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 'XL' });
    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    symbols.previewColor({ code: 'szy_kt' }, 'outlineColor', '#FFF');

    symbols.resetSymbol({ code: 'csxhjctb_gyssp' });
    expect([...symbols.overrides.value.keys()]).toStrictEqual(['szy_kt']);
    expect(symbols.preview.value).not.toBeNull();

    symbols.resetSymbol({ code: 'szy_kt' });
    expect(symbols.overrides.value.size).toBe(0);
    expect(symbols.preview.value).toBeNull();

    symbols.setSymbol({ code: 'szy_kt' }, { fillColor: '#000' });
    symbols.previewColor({ code: 'bgdc_cjdcqjx' }, 'color', '#FFF');
    symbols.resetAll();
    expect(symbols.overrides.value.size).toBe(0);
    expect(symbols.preview.value).toBeNull();
  });
});
