// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import type { ResourceTreeLayer } from '../api';
import { buildCatalog, type ResourceCatalog } from '../catalog';
import { defaultSymbol } from '../style-registry';
import type { ColorField, LineDash, SymbolField } from '../symbols';
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

    symbols.setUniform('csxhjctb_gyssp', { fillColor: '#000', size: 'L' });
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({
      uniform: { size: 'L', fillColor: 'rgba(0, 0, 0, 1)' }
    });
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(true);
    expect(symbols.isCustomized('szy_kt')).toBe(false);

    symbols.setUniform('csxhjctb_gyssp', { size: 'M' });
    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { fillColor: 'rgba(0, 0, 0, 1)' } });

    // 默认颜色换一种写法也算改回默认
    symbols.setUniform('csxhjctb_gyssp', { fillColor: defaultColor('csxhjctb_gyssp', 'fillColor').toLowerCase() });
    expect(symbols.overrides.value.has('csxhjctb_gyssp')).toBe(false);
    expect(symbols.isCustomized('csxhjctb_gyssp')).toBe(false);
  });

  it('值为 undefined 的字段不算改动；自定义大小按步长取整', () => {
    using ctx = setup();
    const { symbols } = ctx;

    symbols.setUniform('csxhjctb_gyssp', { size: 4.26, strokeWidth: 3 });
    symbols.setUniform('bgdc_cjdcqjx', { width: 0.64, dash: 'dotted' });
    symbols.setUniform('csxhjctb_gyssp', { strokeWidth: undefined });

    expect(symbols.overrides.value.get('csxhjctb_gyssp')).toStrictEqual({ uniform: { size: 4.5, strokeWidth: 3 } });
    expect(symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { width: 0.6, dash: 'dotted' } });
  });

  it('值没变时不替换覆盖', () => {
    using ctx = setup();
    const { symbols } = ctx;
    const empty = symbols.overrides.value;

    symbols.resetUniform('szy_kt');
    symbols.resetAll();
    symbols.setUniform('szy_kt', { outlineColor: defaultColor('szy_kt', 'outlineColor') });
    expect(symbols.overrides.value).toBe(empty);

    symbols.setUniform('szy_kt', { fillColor: 'rgba(0, 0, 255, 0.5)' });
    const changed = symbols.overrides.value;
    symbols.setUniform('szy_kt', { fillColor: '#0000FF80' });
    expect(symbols.overrides.value).toBe(changed);
  });

  it('参数不合法时抛错，覆盖不变', () => {
    using ctx = setup();
    const { symbols } = ctx;
    const before = symbols.overrides.value;

    expect(() => symbols.setUniform('nope', { size: 'L' })).toThrow('不在目录里');
    expect(() => symbols.setUniform('csxhjctb_hydl', { color: '#000' })).toThrow('不是统一符号');
    expect(() => symbols.setUniform('csxhjctb_gyssp', { color: '#000' })).toThrow('没有 color');
    expect(() => symbols.setUniform('szy_kt', { fillColor: '不是颜色' })).toThrow('不是颜色');
    expect(() => symbols.setUniform('csxhjctb_gyssp', { size: 25 })).toThrow(RangeError);
    expect(() => symbols.setUniform('bgdc_cjdcqjx', { width: 0.2 })).toThrow(RangeError);
    expect(() => symbols.setUniform('csxhjctb_gyssp', { strokeWidth: 1.5 })).toThrow('描边宽度');
    // 类型不允许，模拟界面传来的脏值
    expect(() => symbols.setUniform('bgdc_cjdcqjx', { dash: 'wavy' as LineDash })).toThrow('没有线型');
    expect(() => symbols.previewColor('csxhjctb_gyssp', 'color', '#000')).toThrow('没有 color');
    expect(() => symbols.previewColor('szy_kt', 'fillColor', '不是颜色')).toThrow('不是颜色');
    expect(symbols.overrides.value).toBe(before);
    expect(symbols.preview.value).toBeNull();
  });

  it('目录还没加载时操作抛错', () => {
    using ctx = setup(null);

    expect(() => ctx.symbols.setUniform('szy_kt', { fillColor: '#000' })).toThrow('不在目录里');
    expect(ctx.symbols.symbolOf('szy_kt')).toBeNull();
  });

  it('预览参与推导、不写入覆盖；同一时间只有一个；确认时写入并清掉预览，丢弃时回到原来的颜色', () => {
    using ctx = setup();
    const { symbols } = ctx;

    symbols.previewColor('csxhjctb_gyssp', 'fillColor', '#00FF00');
    expect(symbols.overrides.value.size).toBe(0);
    expect(symbols.overrideOf('csxhjctb_gyssp')).toStrictEqual({ fillColor: 'rgba(0, 255, 0, 1)' });
    expect(symbols.symbolOf('csxhjctb_gyssp')).toMatchObject({ fillColor: 'rgba(0, 255, 0, 1)' });

    symbols.previewColor('bgdc_cjdcqjx', 'color', '#0000FF');
    expect(symbols.overrideOf('csxhjctb_gyssp')).toBeUndefined();

    // 确认别的资源不影响这个预览
    symbols.setUniform('szy_kt', { outlineColor: '#000' });
    expect(symbols.preview.value).toStrictEqual({ code: 'bgdc_cjdcqjx', field: 'color', color: 'rgba(0, 0, 255, 1)' });

    symbols.setUniform('bgdc_cjdcqjx', { color: '#0000FF' });
    expect(symbols.preview.value).toBeNull();
    expect(symbols.overrides.value.get('bgdc_cjdcqjx')).toStrictEqual({ uniform: { color: 'rgba(0, 0, 255, 1)' } });

    symbols.previewColor('bgdc_cjdcqjx', 'color', '#FF0000');
    expect(symbols.overrideOf('bgdc_cjdcqjx')).toStrictEqual({ color: 'rgba(255, 0, 0, 1)' });
    symbols.clearPreview();
    expect(symbols.overrideOf('bgdc_cjdcqjx')).toStrictEqual({ color: 'rgba(0, 0, 255, 1)' });
  });

  it('叠加后的统一符号：目录里没有的、按属性配色的资源为 null', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setUniform('bgdc_cjdcqjx', { dash: 'dashDot' });

    expect(symbols.symbolOf('bgdc_cjdcqjx')).toStrictEqual({ ...defaultOf('bgdc_cjdcqjx'), dash: 'dashDot' });
    expect(symbols.symbolOf('szy_kt')).toStrictEqual(defaultOf('szy_kt'));
    expect(symbols.symbolOf('csxhjctb_hydl')).toBeNull();
    expect(symbols.symbolOf('nope')).toBeNull();
  });

  it('恢复默认：单个资源连同它的预览；全部资源连同预览', () => {
    using ctx = setup();
    const { symbols } = ctx;
    symbols.setUniform('csxhjctb_gyssp', { size: 'XL' });
    symbols.setUniform('szy_kt', { fillColor: '#000' });
    symbols.previewColor('szy_kt', 'outlineColor', '#FFF');

    symbols.resetUniform('csxhjctb_gyssp');
    expect([...symbols.overrides.value.keys()]).toStrictEqual(['szy_kt']);
    expect(symbols.preview.value).not.toBeNull();

    symbols.resetUniform('szy_kt');
    expect(symbols.overrides.value.size).toBe(0);
    expect(symbols.preview.value).toBeNull();

    symbols.setUniform('szy_kt', { fillColor: '#000' });
    symbols.previewColor('bgdc_cjdcqjx', 'color', '#FFF');
    symbols.resetAll();
    expect(symbols.overrides.value.size).toBe(0);
    expect(symbols.preview.value).toBeNull();
  });
});
