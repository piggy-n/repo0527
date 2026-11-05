import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { LegendSwatch } from '../legend';
import { LegendSwatchIcon } from './LegendSwatchIcon';

const draw = (swatch: LegendSwatch) => mount(LegendSwatchIcon, { props: { swatch } });

describe('LegendSwatchIcon', () => {
  it('面：填充、描边；描边往里收半个线宽，线型按线宽换算；描边为 0 时不画', () => {
    const fill: LegendSwatch = {
      geometry: 'fill',
      fill: 'rgba(0, 255, 0, 0.35)',
      outline: 'rgba(0, 0, 255, 1)',
      outlineWidth: 2,
      outlineDash: [3, 2]
    };
    const rects = draw(fill).findAll('rect');

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
    expect(draw({ ...fill, outlineWidth: 0 }).findAll('rect')).toHaveLength(1);
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

  it('线：线宽，线型按线宽换算；实线没有 stroke-dasharray', () => {
    const dashed = draw({ geometry: 'line', color: '#f00', width: 2.88, dash: [3, 2] }).get('line');
    const solid = draw({ geometry: 'line', color: '#f00', width: 1.8, dash: null }).get('line');

    expect(dashed.attributes()).toMatchObject({ stroke: '#f00', 'stroke-width': '2.88', 'stroke-dasharray': '8.64 5.76' });
    expect(solid.attributes()).not.toHaveProperty('stroke-dasharray');
  });

  it('点：描边画在半径外面，外圈半径是半径加描边；没有描边时只有填充（和最外面的浅灰圈）', () => {
    const point = { geometry: 'circle', fill: '#f00', stroke: '#fff', radius: 4, strokeWidth: 2 } as const;
    const circles = draw(point).findAll('circle');

    expect(circles.map(circle => [circle.attributes('r'), circle.attributes('fill')])).toStrictEqual([
      ['6.5', undefined],
      ['6', '#fff'],
      ['4', '#f00']
    ]);
    const bare = draw({ ...point, strokeWidth: 0 }).findAll('circle');
    expect(bare.map(circle => circle.attributes('fill'))).toStrictEqual([undefined, '#f00']);
  });
});
