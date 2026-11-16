import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { LegendSwatch } from '../legend';
import { shapeSvgPath } from '../point-shapes';
import { fittedDash, LegendSummaryIcon, LegendSwatchIcon, type SwatchSize } from './LegendSwatchIcon';

const draw = (swatch: LegendSwatch, size?: SwatchSize) =>
  mount(LegendSwatchIcon, { props: { swatch, ...(size ? { size } : {}) } });

const summary = (swatches: readonly LegendSwatch[], size?: SwatchSize) =>
  mount(LegendSummaryIcon, { props: { swatches, ...(size ? { size } : {}) } });

const fill = (color: string): LegendSwatch => ({
  geometry: 'fill',
  fill: color,
  outline: color,
  outlineWidth: 1,
  outlineDash: null
});
const line = (color: string, dash: readonly number[] | null = null): Extract<LegendSwatch, { geometry: 'line' }> => ({
  geometry: 'line',
  color,
  width: 1.8,
  dash
});
const point = (color: string, shape: Extract<LegendSwatch, { geometry: 'circle' }>['shape'] = 'circle') =>
  ({ geometry: 'circle', shape, fill: color, stroke: '#fff', radius: 4, strokeWidth: 1 }) as const;

// 画出的色块、线段、点的颜色（data-piece），按画的先后
const colorsOf = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAll('[data-piece]')
    .map(piece => (piece.element.tagName === 'polyline' ? piece.attributes('stroke') : piece.attributes('fill')));

// 画出的圆点的半径：圆的路径从最左边的点开始
function radiusOf(swatch: LegendSwatch, size: SwatchSize) {
  const d = draw(swatch, size).findAll('path').at(-1)?.attributes('d') ?? '';
  const [, x] = /^M([\d.]+) /.exec(d) ?? [];
  const width = size === 'small' ? 20 : 28;
  return width / 2 - Number(x);
}

describe('LegendSwatchIcon：一个符号（ADR 0159）', () => {
  it('按目标尺寸画，不整体缩放：摘要 28 × 20、子图例 22 × 16、行首 20 × 14', () => {
    const sizes = (['summary', 'item', 'small'] as const).map(size => {
      const svg = draw(fill('#f00'), size).get('svg');
      return [svg.attributes('width'), svg.attributes('height'), svg.attributes('viewBox')];
    });

    expect(sizes).toStrictEqual([
      ['28', '20', '0 0 28 20'],
      ['22', '16', '0 0 22 16'],
      ['20', '14', '0 0 20 14']
    ]);
  });

  it('面：填充、描边；描边往里收半个线宽，线型按线宽换算；描边为 0 时不画；描边宽度按预览框限制', () => {
    const swatch: LegendSwatch = {
      geometry: 'fill',
      fill: 'rgba(0, 255, 0, 0.35)',
      outline: 'rgba(0, 0, 255, 1)',
      outlineWidth: 2,
      outlineDash: [3, 2]
    };
    const rects = draw(swatch).findAll('rect');

    expect(rects.map(rect => rect.attributes('fill'))).toStrictEqual(['rgba(0, 255, 0, 0.35)', 'none']);
    expect(rects[1]?.attributes()).toMatchObject({
      x: '1',
      y: '1',
      width: '26',
      height: '18',
      stroke: 'rgba(0, 0, 255, 1)',
      'stroke-width': '2',
      'stroke-dasharray': '6 4'
    });
    expect(draw({ ...swatch, outlineWidth: 0 }).findAll('rect')).toHaveLength(1);
    // 20 × 14 里描边最多 2.8
    expect(draw({ ...swatch, outlineWidth: 4 }, 'small').findAll('rect')[1]?.attributes('stroke-width')).toBe('2.8');
  });

  it('有花纹的面：花纹铺在填充上面', () => {
    const wrapper = draw({
      geometry: 'fill',
      fill: '#fff',
      outline: '#000',
      outlineWidth: 1,
      outlineDash: null,
      pattern: { name: 'dot', color: '#000' }
    });
    const id = wrapper.get('pattern').attributes('id');

    expect(wrapper.findAll('rect').map(rect => rect.attributes('fill'))).toStrictEqual(['#fff', `url(#${id})`, 'none']);
    expect(wrapper.get('pattern image').attributes('href')).toMatch(/^data:image\/svg\+xml,/);
  });

  it('线是一条三段的折线：实线用圆线帽；线宽按预览框限制（20 × 14 里 1.2～2.4）', () => {
    const segments = draw(line('#f00'), 'small').findAll('polyline');

    expect(segments).toHaveLength(3);
    expect(segments.map(segment => segment.attributes('stroke-linecap'))).toStrictEqual(['round', 'round', 'round']);
    expect(segments[0]?.attributes()).not.toHaveProperty('stroke-dasharray');
    expect(draw({ ...line('#f00'), width: 6 }, 'small').get('polyline').attributes('stroke-width')).toBe('2.4');
    expect(draw({ ...line('#f00'), width: 0.5 }, 'small').get('polyline').attributes('stroke-width')).toBe('1.2');
  });

  it('虚线、点线：每段的线型缩放到两端都是实的，拐角不断开；平线帽，两端补圆头', () => {
    const dashed = draw(line('#f00', [3, 2]), 'small');
    const [first] = dashed.findAll('polyline');

    expect(first?.attributes('stroke-linecap')).toBe('butt');
    expect(first?.attributes('stroke-dasharray')).toMatch(/^[\d.]+ [\d.]+$/);
    // 每段两个圆头
    expect(dashed.findAll('circle')).toHaveLength(6);
  });

  it('点：按形状画，描边在形状外面，最外面一圈浅灰；没有描边时只有填充和浅灰的一圈', () => {
    const paths = draw(point('#f00', 'star')).findAll('path');

    expect(paths.map(path => path.attributes('d'))).toStrictEqual(Array(3).fill(shapeSvgPath('star', 14, 10, 4)));
    expect(paths.map(path => path.attributes('fill'))).toStrictEqual([undefined, '#fff', '#f00']);
    expect(paths[1]?.attributes('stroke-width')).toBe('2');
    const bare = draw({ ...point('#f00'), strokeWidth: 0 }).findAll('path');
    expect(bare.map(path => path.attributes('fill'))).toStrictEqual([undefined, '#f00']);
  });

  it('点的半径按预览框换算，不小于 2.5，形状连同描边放得进预览框', () => {
    expect(radiusOf(point('#f00'), 'summary')).toBe(4);
    expect(radiusOf(point('#f00'), 'small')).toBeCloseTo(2.8, 6);
    expect(radiusOf({ ...point('#f00'), radius: 1 }, 'small')).toBe(2.5);
    // 20 × 14 里描边 1 时，1.2 倍半径加描边不超过 7 − 0.75
    expect(radiusOf({ ...point('#f00'), radius: 9 }, 'small')).toBeCloseTo((7 - 1 - 0.75) / 1.2, 1);
  });
});

describe('LegendSummaryIcon：按属性配色的摘要（ADR 0159）', () => {
  it('面拼成色块：4 类 2 × 2，块之间白线，外面一圈中性的框；按代表取值的颜色', () => {
    const wrapper = summary(['#a00', '#0a0', '#00a', '#aa0'].map(fill), 'small');

    expect(wrapper.get('svg').attributes('data-summary')).toBe('fill');
    expect(colorsOf(wrapper)).toStrictEqual(['#a00', '#0a0', '#00a', '#aa0']);
    expect(wrapper.findAll('rect')).toHaveLength(2);
    expect(summary(['#a00', '#0a0', '#00a'].map(fill)).findAll('[data-piece]')).toHaveLength(3);
  });

  it('线是三段折线，各段依次用代表取值的线；两类时第三段回到第一类', () => {
    expect(colorsOf(summary([line('#a00'), line('#0a0'), line('#00a')]))).toStrictEqual(['#a00', '#0a0', '#00a']);
    expect(colorsOf(summary([line('#a00'), line('#0a0')]))).toStrictEqual(['#a00', '#0a0', '#a00']);
  });

  it('点排成三角，各用自己的形状；两类时斜对角', () => {
    const wrapper = summary([point('#a00', 'star'), point('#0a0', 'pin'), point('#00a')], 'small');

    expect(colorsOf(wrapper)).toStrictEqual(['#a00', '#0a0', '#00a']);
    expect(wrapper.findAll('[data-piece]').map(piece => piece.attributes('d'))).toStrictEqual([
      shapeSvgPath('star', 10, 4.62, 2.6),
      shapeSvgPath('pin', 4.8, 9.52, 2.6),
      shapeSvgPath('circle', 15.2, 9.52, 2.6)
    ]);
    expect(summary([point('#a00'), point('#0a0')]).findAll('[data-piece]')).toHaveLength(2);
  });
});

describe('fittedDash', () => {
  it('两端都落在实的部分：长度是整数个周期加第一段；单位不超过线宽；实线没有', () => {
    // 7.6 像素的一段虚线：一个周期（3 + 2）加第一段（3），单位 0.95
    expect(fittedDash([3, 2], 2.4, 7.6)).toBe('2.85 1.9');
    // 20 像素的点线、线宽 1：单位不超过 1，要 7 个周期加第一段，单位 20 / 22
    expect(fittedDash([1, 2], 1, 20)).toBe('0.91 1.82');
    expect(fittedDash(null, 2, 10)).toBeUndefined();
  });
});
