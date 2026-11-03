// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  defaultParams,
  paramsOf,
  type SimulationConditions,
  type SimulationParams,
  withWalkMinutes
} from '../model/params';
import {
  boardLinks,
  type Box,
  indicatorNode,
  isLit,
  OUTPUT_NODE,
  paramNode,
  REGION_NODE,
  relatedNodes,
  YEAR_PENDING_NODE,
  yearNode
} from './board';
import { citiesScope } from '../model/scope';

// 公园绿地覆盖率用得上覆盖认定，人均公园绿地用得上常住人口变化
const conditions: SimulationConditions = {
  years: [2026, 2025],
  scope: citiesScope(['320100']),
  indicatorIds: ['B-65', 'A-39']
};

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
  it('年份 → 范围 → 每项指标 → 总线 → 各参数 → AI计算；参数只有所选指标用得上的几项', () => {
    expect(paramsOf(conditions.indicatorIds)).toEqual(['popChange', 'walk', 'recognition']);
    // 年份 2 + 范围到指标 2 + 指标到总线 2 + 参数到 AI计算 3
    expect(kinds(defaultParams())).toEqual({ flow: 9, bus: 1, tick: 3 });
    const [first] = boardLinks(allBoxes, conditions, defaultParams());
    expect(first).toMatchObject({ from: 'years:2026', to: REGION_NODE, d: 'M120,20 C160,20 160,20 200,20' });
  });

  it('连到偏离标准口径的参数时是情景虚线', () => {
    expect(kinds({ ...defaultParams(), recognition: 'intersect' })).toEqual({ flow: 9, bus: 1, tick: 2, scenario: 1 });
    // 改了一项指标的步行时长：步行时长这个参数也是情景虚线
    expect(kinds(withWalkMinutes(defaultParams(), 'B-65', 10))).toEqual({ flow: 9, bus: 1, tick: 2, scenario: 1 });
  });

  it('还没有位置的节点不连；没有参数节点时只有年份到范围', () => {
    const boxes = new Map(allBoxes);
    boxes.delete(indicatorNode('A-39'));
    expect(kinds(defaultParams(), boxes)).toEqual({ flow: 7, bus: 1, tick: 3 });
    const noParams = new Map([...allBoxes].filter(([key]) => !key.startsWith('params:')));
    expect(kinds(defaultParams(), noParams)).toEqual({ flow: 2 });
  });

  it('所选指标都没有可调的参数（城区面积覆盖率）：指标直接连到 AI计算，没有总线', () => {
    const area: SimulationConditions = { ...conditions, indicatorIds: ['A-15'] };
    const boxes = boxesOf([area.years.map(yearNode), [REGION_NODE], [indicatorNode('A-15')], [], [OUTPUT_NODE]]);
    const links = boardLinks(boxes, area, defaultParams());

    expect(paramsOf(area.indicatorIds)).toEqual([]);
    expect(links.map(link => [link.from, link.to])).toEqual([
      [yearNode(2026), REGION_NODE],
      [yearNode(2025), REGION_NODE],
      [REGION_NODE, indicatorNode('A-15')],
      [indicatorNode('A-15'), OUTPUT_NODE]
    ]);
  });
});

describe('悬停', () => {
  it('悬停覆盖认定：关联住宅用地覆盖率，不关联人均值', () => {
    const related = relatedNodes(paramNode('recognition'), conditions);
    expect([...related]).toEqual([paramNode('recognition'), indicatorNode('B-65')]);
  });

  it('悬停指标：关联年份、范围、影响它的参数和 AI计算', () => {
    const related = relatedNodes(indicatorNode('A-39'), conditions);
    expect(related.has(paramNode('recognition'))).toBe(false);
    expect(related.has(paramNode('popChange'))).toBe(true);
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

describe('boardLinks 待补充、待确认（ADR 0129）', () => {
  it('连着待补充节点的线是 pending，其余不变；不传时没有 pending', () => {
    const links = boardLinks(allBoxes, conditions, defaultParams(), new Set([REGION_NODE]));
    const touching = links.filter(link => link.from === REGION_NODE || link.to === REGION_NODE);
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.every(link => link.kind === 'pending')).toBe(true);
    expect(links.filter(link => link.kind === 'pending')).toHaveLength(touching.length);
    expect(boardLinks(allBoxes, conditions, defaultParams()).some(link => link.kind === 'pending')).toBe(false);
  });

  it('待确认的参数：进出的线都是 pending', () => {
    const key = paramNode('recognition');
    const links = boardLinks(allBoxes, conditions, defaultParams(), new Set([key]));
    expect(links.filter(link => link.to === key || link.from === key).map(link => link.kind)).toEqual(['pending', 'pending']);
  });

  it('待确认的年份节点连到范围', () => {
    const boxes = boxesOf([[YEAR_PENDING_NODE], [REGION_NODE]]);
    const links = boardLinks(boxes, { ...conditions, years: [], indicatorIds: [] }, defaultParams(), new Set([YEAR_PENDING_NODE]));
    expect(links).toEqual([expect.objectContaining({ from: YEAR_PENDING_NODE, to: REGION_NODE, kind: 'pending' })]);
  });
});
