// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultParams, type SimulationConditions, type SimulationParams } from '../model/params';
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
import { COMPOSE_PARAM_KEYS } from './composition';

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
  COMPOSE_PARAM_KEYS.map(paramNode),
  [OUTPUT_NODE]
]);

const kinds = (params: SimulationParams, boxes = allBoxes) =>
  boardLinks(boxes, conditions, params).reduce<Record<string, number>>((counts, link) => {
    counts[link.kind] = (counts[link.kind] ?? 0) + 1;
    return counts;
  }, {});

describe('boardLinks', () => {
  it('年份 → 范围 → 每项指标 → 总线 → 各参数 → AI 推演', () => {
    // 年份 2 + 范围到指标 2 + 指标到总线 2 + 参数到 AI 推演 5
    expect(kinds(defaultParams())).toEqual({ flow: 11, bus: 1, tick: 5 });
    const [first] = boardLinks(allBoxes, conditions, defaultParams());
    expect(first).toMatchObject({ from: 'years:2026', to: REGION_NODE, d: 'M120,20 C160,20 160,20 200,20' });
  });

  it('规划新增大于 0 时连到作用范围里的指标', () => {
    expect(kinds({ ...defaultParams(), newFacilities: 20 }).scenario).toBe(2);
    expect(kinds({ ...defaultParams(), newFacilities: 20, scenarioIds: ['A-39'] }).scenario).toBe(1);
    expect(kinds({ ...defaultParams(), newFacilities: 0 }).scenario).toBeUndefined();
  });

  it('还没有位置的节点不连；没有参数节点时只有年份到范围', () => {
    const boxes = new Map(allBoxes);
    boxes.delete(indicatorNode('A-39'));
    expect(kinds(defaultParams(), boxes)).toEqual({ flow: 9, bus: 1, tick: 5 });
    const noParams = new Map([...allBoxes].filter(([key]) => !key.startsWith('params:')));
    expect(kinds(defaultParams(), noParams)).toEqual({ flow: 2 });
  });
});

describe('悬停', () => {
  it('悬停步行速度：关联步行类覆盖率，不关联人均值', () => {
    const related = relatedNodes(paramNode('walkSpeed'), conditions, defaultParams());
    expect([...related]).toEqual([paramNode('walkSpeed'), indicatorNode('B-65')]);
  });

  it('悬停指标：关联年份、范围、影响它的参数和 AI 推演', () => {
    const related = relatedNodes(indicatorNode('A-39'), conditions, defaultParams());
    expect(related.has(paramNode('walkSpeed'))).toBe(false);
    expect(related.has(paramNode('popCaliber'))).toBe(true);
    expect(related.has(yearNode(2025))).toBe(true);
    expect(related.has(OUTPUT_NODE)).toBe(true);
  });

  it('悬停参数时只点亮它影响的指标汇入总线的线、总线和它自己的线', () => {
    const hovered = paramNode('walkSpeed');
    const related = relatedNodes(hovered, conditions, defaultParams());
    const lit = boardLinks(allBoxes, conditions, defaultParams())
      .filter(link => isLit(link, hovered, related))
      .map(link => link.id);
    expect(lit).toEqual(['p-B-65', 'bus', 'b-walkSpeed', 'o-walkSpeed']);
    expect(relatedNodes(null, conditions, defaultParams()).size).toBe(0);
  });
});
