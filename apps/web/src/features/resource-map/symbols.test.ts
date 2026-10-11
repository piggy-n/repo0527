// @vitest-environment node
import { type StyleSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { type ClassItem, type ColorRule, symbolClasses } from './classification';
import {
  classifiedPaint,
  colorOf,
  nextOverride,
  normalizeColor,
  normalizeSize,
  parseSize,
  type ResourceSymbol,
  resolveSymbol,
  sizeCurve,
  sizePixels,
  sizeStops,
  symbolPaint
} from './symbols';
import { paintValueOf } from './test-expression';

const POINT: ResourceSymbol = { geometry: 'circle', size: 'M', fillColor: '#D9433F', strokeColor: '#FFFFFF', strokeWidth: 1 };
const LINE: ResourceSymbol = { geometry: 'line', color: '#2278BE', width: 'M', dash: 'solid' };
const FILL: ResourceSymbol = { geometry: 'fill', fillColor: 'rgba(217,67,63,0.35)', outlineColor: '#D9433F' };

describe('规范化', () => {
  it('颜色统一成 rgba(r, g, b, a)：同一个颜色的不同写法结果相同，透明度保留两位小数', () => {
    expect(['#D9433F', 'rgb(217, 67, 63)', 'rgba(217,67,63,1)'].map(normalizeColor)).toStrictEqual([
      'rgba(217, 67, 63, 1)',
      'rgba(217, 67, 63, 1)',
      'rgba(217, 67, 63, 1)'
    ]);
    expect(normalizeColor('rgba(217, 67, 63, 0.354)')).toBe('rgba(217, 67, 63, 0.35)');
    expect(normalizeColor('不是颜色')).toBeNull();
  });

  it('自定义大小按步长取整，越界、不是有限数时为 null；四档原样返回', () => {
    expect(normalizeSize('circle', 3.3)).toBe(3.5);
    expect(normalizeSize('line', 2.04)).toBe(2);
    expect(normalizeSize('circle', 25)).toBeNull();
    expect(normalizeSize('line', 0.2)).toBeNull();
    expect(normalizeSize('line', Number.NaN)).toBeNull();
    expect(normalizeSize('circle', 'XL')).toBe('XL');
  });
});

describe('parseSize', () => {
  it('去掉首尾空格后按步长取整；空、不是数、越界时为 null', () => {
    expect(parseSize('circle', ' 3.3 ')).toBe(3.5);
    expect(parseSize('line', '2.04')).toBe(2);
    expect(['', '  ', 'abc', '25', '-1'].map(text => parseSize('circle', text))).toStrictEqual([null, null, null, null, null]);
  });
});

describe('colorOf', () => {
  it('取符号的颜色字段；这个几何没有该字段时为 undefined', () => {
    expect(colorOf(POINT, 'strokeColor')).toBe('#FFFFFF');
    expect(colorOf(LINE, 'fillColor')).toBeUndefined();
  });
});

describe('大小', () => {
  it('M 档就是基准曲线；四档按倍率缩放输出值，缩放断点不动', () => {
    expect(sizeCurve('circle', 'M')).toStrictEqual(['interpolate', ['linear'], ['zoom'], 6, 2, 12, 4, 16, 6]);
    expect(sizeCurve('circle', 'L')).toStrictEqual(['interpolate', ['linear'], ['zoom'], 6, 3.2, 12, 6.4, 16, 9.6]);
    expect(sizeCurve('line', 'S')).toStrictEqual(['interpolate', ['linear'], ['zoom'], 6, 0.36, 10, 0.6, 14, 1.08, 17, 1.8]);
  });

  it('自定义像素按参考级别换成倍率：点在 12 级、线在 14 级正好是这个像素', () => {
    expect(sizeCurve('circle', 8)).toStrictEqual(['interpolate', ['linear'], ['zoom'], 6, 4, 12, 8, 16, 12]);
    expect(sizeCurve('line', 3.6)[8]).toBe(3.6);
    expect([sizePixels('circle', 'XL'), sizePixels('line', 'M'), sizePixels('line', 5)]).toStrictEqual([9.6, 1.8, 5]);
  });
});

describe('覆盖', () => {
  it('叠加：只取属于这个几何的字段', () => {
    expect(resolveSymbol(POINT, { size: 'L', color: '#000000', strokeWidth: 3 })).toStrictEqual({
      ...POINT,
      size: 'L',
      strokeWidth: 3
    });
    expect(resolveSymbol(FILL, { fillColor: '#000000', size: 'XL' })).toStrictEqual({ ...FILL, fillColor: '#000000' });
    expect(resolveSymbol(LINE, undefined)).toBe(LINE);
  });

  it('只记和默认不同的字段；规范化后和默认相同（换了写法）的不记；颜色存规范化后的值', () => {
    expect(nextOverride(LINE, undefined, { color: 'rgb(34, 120, 190)', width: 'L' })).toStrictEqual({ width: 'L' });
    expect(nextOverride(POINT, undefined, { fillColor: '#000' })).toStrictEqual({ fillColor: 'rgba(0, 0, 0, 1)' });
  });

  it('在原有覆盖上改动；改回默认值时删掉这个字段；不属于这个几何的字段不记', () => {
    const override = nextOverride(POINT, undefined, { size: 'L', strokeWidth: 3 });

    expect(nextOverride(POINT, override, { strokeWidth: 1 })).toStrictEqual({ size: 'L' });
    expect(nextOverride(POINT, override, { dash: 'dashed' })).toStrictEqual({ size: 'L', strokeWidth: 3 });
    expect(nextOverride(POINT, override, { size: undefined })).toStrictEqual({ size: 'L', strokeWidth: 3 });
  });
});

describe('symbolPaint', () => {
  it('面是填充加描边；线按线型设 dasharray，实线不设；点带描边', () => {
    expect(symbolPaint(FILL)).toStrictEqual({
      type: 'fill',
      paint: { 'fill-color': 'rgba(217,67,63,0.35)', 'fill-outline-color': '#D9433F' }
    });
    expect(symbolPaint(LINE)).toMatchObject({ type: 'line', layout: { 'line-cap': 'round' } });
    expect(symbolPaint(LINE)).not.toHaveProperty(['paint', 'line-dasharray']);
    expect(symbolPaint({ ...LINE, dash: 'dashDot' })).toMatchObject({ paint: { 'line-dasharray': [4, 2, 1, 2] } });
    expect(symbolPaint({ ...POINT, size: 'S', strokeWidth: 0 })).toMatchObject({
      paint: { 'circle-radius': sizeCurve('circle', 'S'), 'circle-stroke-width': 0 }
    });
  });

  it('各种符号放进样式都能通过 MapLibre 的校验', () => {
    const symbols: ResourceSymbol[] = [
      FILL,
      { ...LINE, width: 12, dash: 'dotted' },
      { ...POINT, size: 1, strokeWidth: 3, fillColor: 'rgba(0, 0, 0, 0.5)' }
    ];
    const style: StyleSpecification = {
      version: 8,
      sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: symbols.map((symbol, index) => Object.assign({ id: `l${index}`, source: 's' }, symbolPaint(symbol)))
    };

    expect(validateStyleMin(style)).toStrictEqual([]);
  });
});

// 两个取值加"其他"，按 ccn 匹配
const RULE: ColorRule = {
  kind: 'values',
  property: 'ccn',
  colors: [
    ['河流', '#1E88E5'],
    ['水渠', '#4FC3F7']
  ],
  fallback: '#2F80ED'
};
const CLASSES = symbolClasses(RULE);
const bySymbol = (symbols: Record<string, ResourceSymbol>, base: ResourceSymbol) => (item: ClassItem) =>
  symbols[item.key] ?? base;
const valueAt = (style: ReturnType<typeof classifiedPaint>, property: string, ccn: string, zoom = 12) =>
  paintValueOf(style.type, property, (style.paint as Record<string, unknown>)[property], { ccn }, zoom);

function validate(style: ReturnType<typeof classifiedPaint>) {
  return validateStyleMin({
    version: 8,
    sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [Object.assign({ id: 'l', source: 's' }, style)]
  });
}

describe('classifiedPaint', () => {
  it('所有取值相同的属性直接用这个值，不生成 match', () => {
    expect(classifiedPaint(CLASSES, () => LINE)).toStrictEqual(symbolPaint(LINE));
    expect(classifiedPaint(CLASSES, () => POINT)).toStrictEqual(symbolPaint(POINT));
  });

  it('颜色按取值匹配；大小保留外层的缩放插值，在各断点的输出里匹配，通过校验并按级别和取值求值', () => {
    const style = classifiedPaint(CLASSES, bySymbol({ 河流: { ...LINE, color: '#000000', width: 'XL' } }, LINE));

    expect(valueAt(style, 'line-color', '河流')).toStrictEqual(paintValueOf('line', 'line-color', '#000000', {}));
    expect(valueAt(style, 'line-color', '湖泊')).toStrictEqual(paintValueOf('line', 'line-color', LINE.color, {}));
    const widths = (ccn: string) => sizeStops('line', 'M').map(([zoom]) => valueAt(style, 'line-width', ccn, zoom));
    expect(widths('河流')).toStrictEqual(sizeStops('line', 'XL').map(([, pixels]) => pixels));
    expect(widths('水渠')).toStrictEqual(sizeStops('line', 'M').map(([, pixels]) => pixels));
    // 外层是缩放插值，四个断点的输出都是 match
    const width = style.type === 'line' ? style.paint['line-width'] : undefined;
    expect(Array.isArray(width) && width.slice(0, 4)).toStrictEqual(['interpolate', ['linear'], ['zoom'], 6]);
    const outputs: unknown[] = Array.isArray(width) ? width.slice(4).filter((_, index) => index % 2 === 0) : [];
    expect(outputs.map(output => JSON.stringify(output).startsWith('["match",'))).toStrictEqual([true, true, true, true]);
    expect(validate(style)).toStrictEqual([]);
  });

  it('线型：都是实线时不设，都相同时直接用数组，有的不同时按取值匹配（实线是间隔为 0 的虚线）', () => {
    expect(classifiedPaint(CLASSES, () => LINE).paint).not.toHaveProperty('line-dasharray');
    expect(classifiedPaint(CLASSES, () => ({ ...LINE, dash: 'dotted' })).paint).toMatchObject({
      'line-dasharray': [1, 2]
    });
    const mixed = classifiedPaint(CLASSES, bySymbol({ 水渠: { ...LINE, dash: 'dashed' } }, LINE));

    expect(valueAt(mixed, 'line-dasharray', '水渠')).toStrictEqual([3, 2]);
    expect(valueAt(mixed, 'line-dasharray', '河流')).toStrictEqual([1, 0]);
    expect(validate(mixed)).toStrictEqual([]);
  });

  it('面：各取值的描边和填充同色（换了写法也算）时不设描边，有一个不同就按取值设描边', () => {
    const solid: ResourceSymbol = { geometry: 'fill', fillColor: '#1E88E5', outlineColor: 'rgb(30, 136, 229)' };
    expect(classifiedPaint(CLASSES, () => solid)).toStrictEqual({ type: 'fill', paint: { 'fill-color': '#1E88E5' } });

    const outlined = classifiedPaint(CLASSES, bySymbol({ 河流: { ...solid, outlineColor: '#000000' } }, solid));
    expect(valueAt(outlined, 'fill-outline-color', '河流')).toStrictEqual(paintValueOf('fill', 'fill-color', '#000000', {}));
    expect(valueAt(outlined, 'fill-outline-color', '水渠')).toStrictEqual(paintValueOf('fill', 'fill-color', '#1E88E5', {}));
    expect(validate(outlined)).toStrictEqual([]);
  });

  it('点：半径、填充色、描边色、描边宽度都可以按取值不同', () => {
    const style = classifiedPaint(CLASSES, bySymbol({ $other: { ...POINT, size: 8, strokeWidth: 3 } }, POINT));

    expect(valueAt(style, 'circle-radius', '湖泊')).toBe(8);
    expect(valueAt(style, 'circle-radius', '河流')).toBe(4);
    expect(valueAt(style, 'circle-stroke-width', '湖泊')).toBe(3);
    expect(valueAt(style, 'circle-stroke-width', '水渠')).toBe(1);
    expect(validate(style)).toStrictEqual([]);
  });
});
