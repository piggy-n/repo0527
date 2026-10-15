// @vitest-environment node
import { featureFilter, type StyleSpecification, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { type ClassItem, type ColorRule, legacyItem, symbolClasses } from './classification';
import { BLANK_PATTERN_IMAGE_ID, patternImageId } from './fill-patterns';
import {
  classifiedLayers,
  colorLabel,
  colorOf,
  darkenColor,
  nextOverride,
  normalizeColor,
  normalizeSize,
  parseSize,
  type ResourceSymbol,
  resolveSymbol,
  sizeCurve,
  sizePixels,
  type ResourceLayerPart,
  type ResourceStyleLayers,
  sizeStops,
  symbolLayers
} from './symbols';
import { paintValueOf } from './test-expression';

const POINT: ResourceSymbol = { geometry: 'circle', size: 'M', fillColor: '#D9433F', strokeColor: '#FFFFFF', strokeWidth: 1 };
const LINE: ResourceSymbol = { geometry: 'line', color: '#2278BE', width: 'M', dash: 'solid' };
const FILL: ResourceSymbol = {
  geometry: 'fill',
  fillColor: 'rgba(217,67,63,0.35)',
  fillStyle: 'solid',
  patternColor: '#D9433F',
  outlineColor: '#D9433F',
  outlineWidth: 'M',
  outlineDash: 'solid'
};

// 主图层，以及按后缀找纹理图层、描边图层
const main = (layers: ResourceStyleLayers) => layers.parts[0];
const partOf = (layers: ResourceStyleLayers, suffix: 'pattern' | 'outline') =>
  layers.parts.find(part => part.suffix === suffix);
// 统一样式的主图层
const mainOf = (symbol: ResourceSymbol) => main(symbolLayers(symbol));
// 颜色按 MapLibre 求值后的形式，便于和图层上的值比较
const color = (value: string) => paintValueOf('fill', 'fill-color', value, {});

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

  it('编辑器写出的色值：#RRGGBB，半透明时带百分比；解析不了时原样（设计稿 5D.5）', () => {
    expect(colorLabel('rgba(217, 67, 63, 1)')).toBe('#D9433F');
    expect(colorLabel('rgb(248, 208, 114)')).toBe('#F8D072');
    expect(colorLabel('#ffffff')).toBe('#FFFFFF');
    expect(colorLabel('rgba(176, 58, 107, 0.35)')).toBe('#B03A6B 35%');
    expect(colorLabel('不是颜色')).toBe('不是颜色');
  });

  it('加深（ADR 0046）：Lab 空间往黑色插值，透明度不变；透明和不透明的颜色加深后 RGB 相同', () => {
    expect(normalizeColor(darkenColor('#F8D072', 0.4))).toBe('rgba(141, 119, 69, 1)');
    expect(normalizeColor(darkenColor('rgba(248, 208, 114, 0.35)', 0.4))).toBe('rgba(141, 119, 69, 0.35)');
    expect(normalizeColor(darkenColor('#F8D072', 0))).toBe('rgba(248, 208, 114, 1)');
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

describe('parseSize：面的描边', () => {
  it('0 是无描边，范围 0～8；空的输入不算 0', () => {
    expect(['0', ' 2.34 ', '8', '', '  ', '8.5'].map(text => parseSize('outline', text))).toStrictEqual([
      0,
      2.3,
      8,
      null,
      null,
      null
    ]);
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

describe('symbolLayers', () => {
  it('面是填充加描边；线按线型设 dasharray，实线不设；点带描边', () => {
    expect(symbolLayers(FILL)).toStrictEqual({
      parts: [{ type: 'fill', paint: { 'fill-color': 'rgba(217,67,63,0.35)', 'fill-outline-color': '#D9433F' } }],
      images: {}
    });
    expect(mainOf(LINE)).toMatchObject({ type: 'line', layout: { 'line-cap': 'round' } });
    expect(mainOf(LINE)).not.toHaveProperty(['paint', 'line-dasharray']);
    expect(mainOf({ ...LINE, dash: 'dashDot' })).toMatchObject({ paint: { 'line-dasharray': [4, 2, 1, 2] } });
    expect(mainOf({ ...POINT, size: 'S', strokeWidth: 0 })).toMatchObject({
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
      layers: symbols.map((symbol, index) => Object.assign({ id: `l${index}`, source: 's' }, mainOf(symbol)))
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
const valueAt = (part: ResourceLayerPart | undefined, property: string, ccn: string, zoom = 12) =>
  part && paintValueOf(part.type, property, (part.paint as Record<string, unknown>)[property], { ccn }, zoom);

// 各线型图层的后缀和线型（实线不设 line-dasharray）
const dashLayersOf = (layers: ResourceStyleLayers) =>
  layers.parts.flatMap(part => (part.type === 'line' ? [[part.suffix ?? 'main', part.paint['line-dasharray'] ?? 'solid']] : []));

// 按 MapLibre 的语义求值各线型图层的过滤条件：这个要素进了哪几个线型图层
const routedTo = (layers: ResourceStyleLayers, properties: Record<string, string>) =>
  layers.parts.flatMap(part => {
    const id = part.suffix ?? 'main';
    const passes = !part.filter || featureFilter(part.filter, id).filter({ zoom: 12 }, { type: 'LineString', properties });
    return part.type === 'line' && passes ? [id] : [];
  });

// 全部图层放进一份样式校验
function validate(layers: ResourceStyleLayers) {
  return validateStyleMin({
    version: 8,
    sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: layers.parts.map(({ suffix, ...style }) => Object.assign({ id: `l-${suffix ?? 'main'}`, source: 's' }, style))
  });
}

describe('classifiedLayers', () => {
  it('所有取值相同的属性直接用这个值，不生成 match', () => {
    expect(classifiedLayers(CLASSES, () => LINE)).toStrictEqual(symbolLayers(LINE));
    expect(classifiedLayers(CLASSES, () => POINT)).toStrictEqual(symbolLayers(POINT));
    expect(classifiedLayers(CLASSES, () => FILL)).toStrictEqual(symbolLayers(FILL));
  });

  it('颜色按取值匹配；大小保留外层的缩放插值，在各断点的输出里匹配，通过校验并按级别和取值求值', () => {
    const layers = classifiedLayers(CLASSES, bySymbol({ 河流: { ...LINE, color: '#000000', width: 'XL' } }, LINE));
    const style = main(layers);

    expect(valueAt(style, 'line-color', '河流')).toStrictEqual(paintValueOf('line', 'line-color', '#000000', {}));
    expect(valueAt(style, 'line-color', '湖泊')).toStrictEqual(paintValueOf('line', 'line-color', LINE.color, {}));
    const widths = (ccn: string) => sizeStops('line', 'M').map(([zoom]) => valueAt(style, 'line-width', ccn, zoom));
    expect(widths('河流')).toStrictEqual(sizeStops('line', 'XL').map(([, pixels]) => pixels));
    expect(widths('水渠')).toStrictEqual(sizeStops('line', 'M').map(([, pixels]) => pixels));
    // 外层是缩放插值，四个断点的输出都是 match
    const width = style?.type === 'line' ? style.paint['line-width'] : undefined;
    expect(Array.isArray(width) && width.slice(0, 4)).toStrictEqual(['interpolate', ['linear'], ['zoom'], 6]);
    const outputs: unknown[] = Array.isArray(width) ? width.slice(4).filter((_, index) => index % 2 === 0) : [];
    expect(outputs.map(output => JSON.stringify(output).startsWith('["match",'))).toStrictEqual([true, true, true, true]);
    expect(validate(layers)).toStrictEqual([]);
  });

  it('线型（ADR 0046）：只有一种线型时只有主图层，线型是常量（实线不设），不加过滤', () => {
    const solid = classifiedLayers(CLASSES, () => LINE);
    const dotted = classifiedLayers(CLASSES, () => ({ ...LINE, dash: 'dotted' }));

    expect(dashLayersOf(solid)).toStrictEqual([['main', 'solid']]);
    expect(dashLayersOf(dotted)).toStrictEqual([['main', [1, 2]]]);
    expect(dashLayersOf(symbolLayers({ ...LINE, dash: 'dashed' }))).toStrictEqual([['main', [3, 2]]]);
    expect([...solid.parts, ...dotted.parts].filter(part => part.filter)).toStrictEqual([]);
  });

  it('多种线型时按线型拆层：主图层放用到的线型里最靠前的一种，其余以线型为后缀；每层的线型是常量，按要素的线型过滤，每个要素恰好进一层', () => {
    const mixed = classifiedLayers(
      CLASSES,
      bySymbol({ 水渠: { ...LINE, dash: 'dashed' }, $other: { ...LINE, dash: 'dashDot' } }, LINE)
    );

    expect(dashLayersOf(mixed)).toStrictEqual([
      ['main', 'solid'],
      ['dashed', [3, 2]],
      ['dash-dot', [4, 2, 1, 2]]
    ]);
    // 没有命中取值、没有这个属性的要素都归兜底取值
    const features: Record<string, string>[] = [{ ccn: '河流' }, { ccn: '水渠' }, { ccn: '湖泊' }, {}];
    const routes = features.map(properties => routedTo(mixed, properties));
    expect(routes).toStrictEqual([['main'], ['dashed'], ['dash-dot'], ['dash-dot']]);
    expect(validate(mixed)).toStrictEqual([]);

    // 没有实线时，主图层放虚线
    const withoutSolid = classifiedLayers(CLASSES, bySymbol({ 河流: { ...LINE, dash: 'dotted' } }, { ...LINE, dash: 'dashed' }));
    expect(dashLayersOf(withoutSolid)).toStrictEqual([
      ['main', [3, 2]],
      ['dotted', [1, 2]]
    ]);
    expect([{ ccn: '河流' }, { ccn: '水渠' }].map(properties => routedTo(withoutSolid, properties))).toStrictEqual([
      ['dotted'],
      ['main']
    ]);
  });

  it('地类的要素线型和颜色共用匹配规则：先按编码，编码没命中才按名称找历史地类，其余归兜底', () => {
    const landuse = symbolClasses({ kind: 'landuse-code' });
    const layers = classifiedLayers(
      landuse,
      bySymbol({ '0101': { ...LINE, dash: 'dashed' }, [legacyItem('村庄用地')]: { ...LINE, dash: 'dotted' } }, LINE)
    );
    const route = (dlbm: string, dlmc: string) => routedTo(layers, { dlbm, dlmc });

    // 编码命中时不看名称，哪怕名称指向另一个有自己线型的历史地类
    expect(route('0101', '村庄用地')).toStrictEqual(['dashed']);
    expect(route('0102', '村庄用地')).toStrictEqual(['main']);
    expect(route('9999', '村庄用地')).toStrictEqual(['dotted']);
    expect(route('9999', '不认识的名称')).toStrictEqual(['main']);
  });

  it('面：描边和填充同色（换了写法也算）时不设描边，有一个不同就按取值设描边；颜色不同时随缩放从主色过渡到描边色', () => {
    const solid: ResourceSymbol = { ...FILL, fillColor: '#1E88E5', outlineColor: 'rgb(30, 136, 229)' };
    expect(classifiedLayers(CLASSES, () => solid)).toStrictEqual({
      parts: [{ type: 'fill', paint: { 'fill-color': '#1E88E5' } }],
      images: {}
    });

    const outlined = main(classifiedLayers(CLASSES, bySymbol({ 河流: { ...solid, outlineColor: '#000000' } }, solid)));
    expect(valueAt(outlined, 'fill-outline-color', '河流', 14)).toStrictEqual(color('#000000'));
    expect(valueAt(outlined, 'fill-outline-color', '河流', 10)).toStrictEqual(color('#1E88E5'));
    expect(valueAt(outlined, 'fill-outline-color', '水渠', 14)).toStrictEqual(color('#1E88E5'));
  });

  it('点：半径、填充色、描边色、描边宽度都可以按取值不同', () => {
    const layers = classifiedLayers(CLASSES, bySymbol({ $other: { ...POINT, size: 8, strokeWidth: 3 } }, POINT));
    const style = main(layers);

    expect(valueAt(style, 'circle-radius', '湖泊')).toBe(8);
    expect(valueAt(style, 'circle-radius', '河流')).toBe(4);
    expect(valueAt(style, 'circle-stroke-width', '湖泊')).toBe(3);
    expect(valueAt(style, 'circle-stroke-width', '水渠')).toBe(1);
    expect(validate(layers)).toStrictEqual([]);
  });
});

describe('面的图层（ADR 0045）', () => {

  it('无填充：填充色透明，描边照常', () => {
    expect(mainOf({ ...FILL, fillStyle: 'none' })).toStrictEqual({
      type: 'fill',
      paint: { 'fill-color': 'rgba(0, 0, 0, 0)', 'fill-outline-color': '#D9433F' }
    });
  });

  it('简单描边由主图层表达：0 像素透明，1 像素实线用描边色；不建描边图层', () => {
    expect(symbolLayers({ ...FILL, outlineWidth: 0, outlineDash: 'dashed' }).parts).toStrictEqual([
      { type: 'fill', paint: { 'fill-color': FILL.fillColor, 'fill-outline-color': 'rgba(0, 0, 0, 0)' } }
    ]);
    expect(symbolLayers({ ...FILL, outlineWidth: 1 }).parts).toHaveLength(1);
    // 描边和填充同色时也要显式透明：不设的话 MapLibre 用填充色画 1 像素的边
    expect(mainOf({ ...FILL, outlineColor: FILL.fillColor, outlineWidth: 0 })?.paint).toMatchObject({
      'fill-outline-color': 'rgba(0, 0, 0, 0)'
    });
  });

  it('描边和填充的 RGB 不同时随缩放过渡：10 级是主色配描边的透明度，14 级是描边色；无填充时不过渡', () => {
    const outline = 'rgba(0, 0, 0, 0.5)';
    const faded = mainOf({ ...FILL, outlineColor: outline });
    expect(valueAt(faded, 'fill-outline-color', '', 10)).toStrictEqual(color('rgba(217, 67, 63, 0.5)'));
    expect(valueAt(faded, 'fill-outline-color', '', 14)).toStrictEqual(color(outline));
    expect(mainOf({ ...FILL, outlineColor: outline, fillStyle: 'none' })?.paint).toMatchObject({
      'fill-outline-color': outline
    });
  });

  it('复杂描边建描边图层：线宽是固定像素，内收半个线宽，带线型；主图层不再画描边', () => {
    const layers = symbolLayers({ ...FILL, outlineWidth: 'L', outlineDash: 'dashed' });

    expect(main(layers)?.paint).toMatchObject({ 'fill-outline-color': 'rgba(0, 0, 0, 0)' });
    expect(partOf(layers, 'outline')).toStrictEqual({
      suffix: 'outline',
      type: 'line',
      layout: {},
      paint: { 'line-color': '#D9433F', 'line-width': 1.6, 'line-offset': 0.8, 'line-dasharray': [3, 2] }
    });
    // 1 像素虚线也是复杂描边
    expect(partOf(symbolLayers({ ...FILL, outlineDash: 'dotted' }), 'outline')).toBeDefined();
    expect(validate(layers)).toStrictEqual([]);
  });

  it('花纹建纹理图层：按缩放切换三档图片，花纹不过渡，颜色是纹理颜色，不画边线；带上用到的图片', () => {
    const layers = symbolLayers({ ...FILL, fillStyle: 'diagonal', patternColor: '#000000' });

    expect(partOf(layers, 'pattern')).toStrictEqual({
      suffix: 'pattern',
      type: 'fill',
      paint: {
        'fill-pattern': [
          'step',
          ['zoom'],
          patternImageId('diagonal', 0),
          10,
          patternImageId('diagonal', 1),
          14,
          patternImageId('diagonal', 2)
        ],
        'fill-pattern-transition': { duration: 0, delay: 0 },
        'fill-color': '#000000',
        'fill-antialias': false
      }
    });
    expect(Object.keys(layers.images)).toStrictEqual([0, 1, 2].map(band => patternImageId('diagonal', band as 0 | 1 | 2)));
    expect(validate(layers)).toStrictEqual([]);
  });

  it('分类样式：只有部分取值用花纹时，其他取值用透明图片、纹理颜色透明；整个资源建纹理图层', () => {
    const solid: ResourceSymbol = { ...FILL, fillColor: '#1E88E5', outlineColor: '#1E88E5' };
    const layers = classifiedLayers(CLASSES, bySymbol({ 水渠: { ...solid, fillStyle: 'dot', patternColor: '#FF0000' } }, solid));
    const pattern = partOf(layers, 'pattern');
    const imageAt = (ccn: string, zoom: number) => String(valueAt(pattern, 'fill-pattern', ccn, zoom));

    expect([imageAt('水渠', 9), imageAt('水渠', 12), imageAt('水渠', 15)]).toStrictEqual(
      [0, 1, 2].map(band => patternImageId('dot', band as 0 | 1 | 2))
    );
    expect(imageAt('河流', 12)).toBe(BLANK_PATTERN_IMAGE_ID);
    expect(valueAt(pattern, 'fill-color', '水渠')).toStrictEqual(color('#FF0000'));
    expect(valueAt(pattern, 'fill-color', '河流')).toStrictEqual(color('rgba(0, 0, 0, 0)'));
    expect(Object.keys(layers.images)).toContain(BLANK_PATTERN_IMAGE_ID);
    expect(validate(layers)).toStrictEqual([]);
  });

  it('分类样式：有一个取值是复杂描边就为整个资源建描边图层，0 像素的取值线宽为 0，1 像素实线照常画', () => {
    const layers = classifiedLayers(
      CLASSES,
      bySymbol({ 河流: { ...FILL, outlineWidth: 'XL' }, 水渠: { ...FILL, outlineWidth: 0 } }, FILL)
    );
    const outline = partOf(layers, 'outline');

    const widths = ['河流', '水渠', '湖泊'].map(ccn => valueAt(outline, 'line-width', ccn));
    expect(widths).toStrictEqual([2.4, 0, 1]);
    expect(valueAt(outline, 'line-offset', '河流')).toBe(1.2);
    expect(valueAt(main(layers), 'fill-outline-color', '湖泊')).toStrictEqual(color('rgba(0, 0, 0, 0)'));
    expect(validate(layers)).toStrictEqual([]);
  });

  it('描边图层同样按线型拆层（ADR 0046）：描边的主图层后缀是 outline，其余加上线型', () => {
    const layers = classifiedLayers(CLASSES, bySymbol({ 河流: { ...FILL, outlineWidth: 'XL', outlineDash: 'dotted' } }, FILL));

    expect(layers.parts.map(part => part.suffix ?? 'main')).toStrictEqual(['main', 'outline', 'outline-dotted']);
    expect(dashLayersOf(layers)).toStrictEqual([
      ['outline', 'solid'],
      ['outline-dotted', [1, 2]]
    ]);
    expect([{ ccn: '河流' }, { ccn: '水渠' }].map(properties => routedTo(layers, properties))).toStrictEqual([
      ['outline-dotted'],
      ['outline']
    ]);
    expect(validate(layers)).toStrictEqual([]);
  });

  it('没有花纹、都是简单描边时只有主图层，不带图片（默认样式和原来一样是一个图层）', () => {
    const layers = classifiedLayers(CLASSES, bySymbol({ 河流: { ...FILL, outlineWidth: 0 } }, FILL));

    expect(layers.parts.map(part => part.suffix ?? 'main')).toStrictEqual(['main']);
    expect(layers.images).toStrictEqual({});
  });
});
