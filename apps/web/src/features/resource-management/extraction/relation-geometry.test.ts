// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type CardBox, edgeShapes } from './relation-geometry';
import type { RelationEdge } from './relation-view';

function edge(key: string, from: string, to: string, count = 1): RelationEdge {
  const relations = Array.from({ length: count }, (_, index) => ({
    id: `${key}-${index}`,
    kind: 'class-mapping' as const,
    source: from,
    target: to
  }));
  return { key, kind: 'class-mapping', from, to, relations };
}

const box = (x: number, y: number): CardBox => ({ x, y, width: 100, height: 32 });

describe('edgeShapes', () => {
  it('跨泳道的线从左边卡片的右缘画到右边卡片的左缘，名称在中点', () => {
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(200, 40)]
    ]);
    const [shape] = edgeShapes([edge('ab', 'a', 'b')], boxes, new Map([['a', 0], ['b', 1]]), null);

    expect(shape.path).toBe('M100 16 C150 16 150 56 200 56');
    expect(shape.label).toEqual({ x: 150, y: 36 });
    expect(shape.focused).toBe(false);
  });

  it('同一泳道的弧线在卡片右侧，按起点自上而下逐条外扩', () => {
    const boxes = new Map([
      ['a1', box(0, 0)],
      ['a2', box(0, 40)],
      ['b1', box(0, 120)],
      ['b2', box(0, 160)]
    ]);
    const laneOf = new Map([...boxes.keys()].map(id => [id, 3]));
    const shapes = edgeShapes([edge('second', 'a2', 'b2'), edge('first', 'a1', 'b1')], boxes, laneOf, null);

    expect(shapes.map(shape => [shape.key, shape.path])).toEqual([
      ['second', 'M100 56 C120 56 120 176 100 176'],
      ['first', 'M100 16 C112 16 112 136 100 136']
    ]);
  });

  it('缺少卡片位置的线不画；和焦点相连的排在最后，带上合成的条数', () => {
    const boxes = new Map([
      ['a', box(0, 0)],
      ['b', box(200, 0)],
      ['c', box(200, 40)]
    ]);
    const laneOf = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 1]
    ]);
    const shapes = edgeShapes(
      [edge('ac', 'a', 'c', 3), edge('ab', 'a', 'b'), edge('ax', 'a', 'x')],
      boxes,
      laneOf,
      'b'
    );

    expect(shapes.map(shape => [shape.key, shape.focused, shape.count])).toEqual([
      ['ac', false, 3],
      ['ab', true, 1]
    ]);
  });
});
