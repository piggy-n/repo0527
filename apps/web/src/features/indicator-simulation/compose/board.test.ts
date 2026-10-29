// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultParams, paramsOf, type SimulationConditions, type SimulationParams } from '../model/params';
import {
  boardLinks,
  type Box,
  indicatorNode,
  isLit,
  OUTPUT_NODE,
  paramNode,
  REGION_NODE,
  relatedNodes,
  yearNode
} from './board';

// 公园绿地覆盖率用得上覆盖认定，人均公园绿地用得上常住人口变化，再加目标值
const conditions: SimulationConditions = { years: [2026, 2025], cityCodes: ['320100'], indicatorIds: ['B-65', 'A-39'] };

// 每个节点一个固定的框：列按顺序向右，列内向下
function boxesOf(keys: readonly string[][]): Map<string, Box> {
  const boxes = new Map<string, Box>();
  keys.forEach((column, x) => column.forEach((key, y) => boxes.set(key, { x: x * 200, y: y * 60, w: 120, h: 40 })));
  return boxes;
}

const allBoxes = boxesOf([
  conditions.years.map(yearNode),
  [REGION_NODE],
  conditions.indicatorIds.map(indicatorNode),
  paramsOf(conditions.indicatorIds).map(paramNode),
  [OUTPUT_NODE]
]);

const kinds = (params: SimulationParams, boxes = allBoxes) =>
  boardLinks(boxes, conditions, params).reduce<Record<string, number>>((counts, link) => {
    counts[link.kind] = (counts[link.kind] ?? 0) + 1;
    return counts;
  }, {});

describe('boardLinks', () => {
  it('年份 → 范围 → 每项指标 → 总线 → 各参数 → AI 推演；参数只有所选指标用得上的几项', () => {
    expect(paramsOf(conditions.indicatorIds)).toEqual(['popChange', 'recognition', 'targets']);
    // 年份 2 + 范围到指标 2 + 指标到总线 2 + 参数到 AI 推演 3
    expect(kinds(defaultParams())).toEqual({ flow: 9, bus: 1, tick: 3 });
    const [first] = boardLinks(allBoxes, conditions, defaultParams());
    expect(first).toMatchObject({ from: 'years:2026', to: REGION_NODE, d: 'M120,20 C160,20 160,20 200,20' });
  });

  it('连到偏离标准口径的参数时是情景虚线；目标值改了不算', () => {
    expect(kinds({ ...defaultParams(), recognition: 'intersect' })).toEqual({ flow: 9, bus: 1, tick: 2, scenario: 1 });
    expect(kinds({ ...defaultParams(), targets: { ...defaultParams().targets, 'B-65': 60 } }).scenario).toBeUndefined();
  });

  it('还没有位置的节点不连；没有参数节点时只有年份到范围', () => {
    const boxes = new Map(allBoxes);
    boxes.delete(indicatorNode('A-39'));
    expect(kinds(defaultParams(), boxes)).toEqual({ flow: 7, bus: 1, tick: 3 });
    const noParams = new Map([...allBoxes].filter(([key]) => !key.startsWith('params:')));
    expect(kinds(defaultParams(), noParams)).toEqual({ flow: 2 });
  });
});

describe('悬停', () => {
  it('悬停覆盖认定：关联住宅用地覆盖率，不关联人均值', () => {
    const related = relatedNodes(paramNode('recognition'), conditions);
    expect([...related]).toEqual([paramNode('recognition'), indicatorNode('B-65')]);
  });

  it('悬停指标：关联年份、范围、影响它的参数和 AI 推演', () => {
    const related = relatedNodes(indicatorNode('A-39'), conditions);
    expect(related.has(paramNode('recognition'))).toBe(false);
    expect(related.has(paramNode('popChange'))).toBe(true);
    expect(related.has(paramNode('targets'))).toBe(true);
    expect(related.has(yearNode(2025))).toBe(true);
    expect(related.has(OUTPUT_NODE)).toBe(true);
  });

  it('悬停参数时只点亮它影响的指标汇入总线的线、总线和它自己的线', () => {
    const hovered = paramNode('recognition');
    const related = relatedNodes(hovered, conditions);
    const lit = boardLinks(allBoxes, conditions, defaultParams())
      .filter(link => isLit(link, hovered, related))
      .map(link => link.id);
    expect(lit).toEqual(['p-B-65', 'bus', 'b-recognition', 'o-recognition']);
    expect(relatedNodes(null, conditions).size).toBe(0);
  });
});
