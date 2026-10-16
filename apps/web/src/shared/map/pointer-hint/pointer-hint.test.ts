// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pointerHintSides } from './pointer-hint';

const HINT = { width: 200, height: 40 };
const CANVAS = { width: 800, height: 600 };

describe('pointerHintSides', () => {
  it('默认在鼠标右下方', () => {
    expect(pointerHintSides({ x: 100, y: 100 }, HINT, CANVAS)).toStrictEqual({ x: 'right', y: 'below' });
  });

  it('右边放不下（鼠标 + 16 + 宽度超过画布减 8）时翻到左边，下边同理翻到上边', () => {
    expect(pointerHintSides({ x: 576, y: 100 }, HINT, CANVAS).x).toBe('right');
    expect(pointerHintSides({ x: 577, y: 100 }, HINT, CANVAS).x).toBe('left');
    expect(pointerHintSides({ x: 100, y: 536 }, HINT, CANVAS).y).toBe('below');
    expect(pointerHintSides({ x: 100, y: 537 }, HINT, CANVAS).y).toBe('above');
    expect(pointerHintSides({ x: 700, y: 580 }, HINT, CANVAS)).toStrictEqual({ x: 'left', y: 'above' });
  });

  it('还不知道画布的尺寸（为 0）时不翻', () => {
    expect(pointerHintSides({ x: 700, y: 580 }, HINT, { width: 0, height: 0 })).toStrictEqual({
      x: 'right',
      y: 'below'
    });
  });
});
