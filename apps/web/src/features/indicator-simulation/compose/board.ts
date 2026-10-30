import { isStandard, type ParamKey, paramsOf, type SimulationConditions, type SimulationParams } from '../model/params';
import { affectedIndicators } from './composition';

/** 编排图的五列 */
export type BoardLane = 'years' | 'region' | 'indicators' | 'params' | 'output';

/** 节点的标识：年份、监测范围（一个节点列出各市）、指标、参数、AI 推演 */
export const REGION_NODE = 'region';
export const OUTPUT_NODE = 'output';
// 参数总线：指标的连线汇到这条竖线上，再分到各个参数
const BUS = 'bus';

export const yearNode = (year: number): string => `years:${year}`;
export const indicatorNode = (id: string): string => `indicators:${id}`;
export const paramNode = (key: ParamKey): string => `params:${key}`;

/** 节点在画布里的位置（像素，相对连线层） */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 连线：flow 是条件之间的流向，bus、tick 是参数总线；连到偏离标准口径的参数时是 scenario */
export interface BoardLink {
  readonly id: string;
  readonly d: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'flow' | 'bus' | 'tick' | 'scenario';
}

type Point = readonly [number, number];

const right = (box: Box): Point => [box.x + box.w, box.y + box.h / 2];
const left = (box: Box): Point => [box.x, box.y + box.h / 2];

// 水平方向的三次曲线，两端水平进出
function curve([ax, ay]: Point, [bx, by]: Point): string {
  const bend = Math.max(24, (bx - ax) / 2);
  return `M${ax},${ay} C${ax + bend},${ay} ${bx - bend},${by} ${bx},${by}`;
}

// 总线离参数节点左边的距离
const BUS_GAP = 14;

/**
 * 按节点位置连线：年份 → 范围 → 每项指标 → 参数总线 → 各参数 → AI 推演；参数是所选指标用得上的几项。没有位置的节点不连；
 * 所选指标都没有可调的参数（如城区面积覆盖率）时指标直接连到 AI 推演
 */
export function boardLinks(
  boxes: ReadonlyMap<string, Box>,
  conditions: SimulationConditions,
  params: SimulationParams
): BoardLink[] {
  const links: BoardLink[] = [];
  const region = boxes.get(REGION_NODE);
  const output = boxes.get(OUTPUT_NODE);
  if (region) {
    for (const year of conditions.years) {
      const box = boxes.get(yearNode(year));
      if (box) {
        const d = curve(right(box), left(region));
        links.push({ id: `y-${year}`, d, from: yearNode(year), to: REGION_NODE, kind: 'flow' });
      }
    }
  }
  const keys = paramsOf(conditions.indicatorIds);
  const paramBoxes = keys.flatMap(key => {
    const box = boxes.get(paramNode(key));
    return box ? [{ key, box }] : [];
  });
  const first = paramBoxes[0]?.box;
  const last = paramBoxes.at(-1)?.box;
  // 有参数时等参数节点有了位置再连指标
  if ((!first || !last) && keys.length > 0) {
    return links;
  }
  const busX = (first?.x ?? 0) - BUS_GAP;
  const busPoint: Point | null = first && last ? [busX, (first.y + last.y + last.h) / 2] : null;
  for (const id of conditions.indicatorIds) {
    const box = boxes.get(indicatorNode(id));
    if (!box) {
      continue;
    }
    if (region) {
      const d = curve(right(region), left(box));
      links.push({ id: `r-${id}`, d, from: REGION_NODE, to: indicatorNode(id), kind: 'flow' });
    }
    if (busPoint) {
      links.push({ id: `p-${id}`, d: curve(right(box), busPoint), from: indicatorNode(id), to: BUS, kind: 'flow' });
    } else if (output) {
      const d = curve(right(box), left(output));
      links.push({ id: `o-${id}`, d, from: indicatorNode(id), to: OUTPUT_NODE, kind: 'flow' });
    }
  }
  if (!first || !last) {
    return links;
  }
  const top = first.y + first.h / 2;
  const bottom = last.y + last.h / 2;
  links.push({ id: BUS, d: `M${busX},${top} L${busX},${bottom}`, from: BUS, to: BUS, kind: 'bus' });
  for (const { key, box } of paramBoxes) {
    const y = box.y + box.h / 2;
    const kind = isStandard(key, params) ? 'tick' : 'scenario';
    links.push({ id: `b-${key}`, d: `M${busX},${y} L${box.x},${y}`, from: BUS, to: paramNode(key), kind });
    if (output) {
      const d = curve(right(box), left(output));
      links.push({ id: `o-${key}`, d, from: paramNode(key), to: OUTPUT_NODE, kind: 'flow' });
    }
  }
  return links;
}

/** 悬停的节点和与它相关的节点：参数关联它影响的指标；指标关联上游的年份、范围和影响它的参数、下游的 AI 推演 */
export function relatedNodes(hovered: string | null, conditions: SimulationConditions): Set<string> {
  const related = new Set<string>();
  if (hovered === null) {
    return related;
  }
  related.add(hovered);
  const keys = paramsOf(conditions.indicatorIds);
  const param = keys.find(key => paramNode(key) === hovered);
  if (param !== undefined) {
    affectedIndicators(param, conditions).forEach(id => related.add(indicatorNode(id)));
  }
  const indicator = conditions.indicatorIds.find(id => indicatorNode(id) === hovered);
  if (indicator !== undefined) {
    related.add(REGION_NODE);
    related.add(OUTPUT_NODE);
    conditions.years.forEach(year => related.add(yearNode(year)));
    for (const key of keys) {
      if (affectedIndicators(key, conditions).includes(indicator)) {
        related.add(paramNode(key));
      }
    }
  }
  return related;
}

/** 悬停时连线是否点亮：连着悬停节点的、总线，以及两端都相关的；悬停参数时只亮它影响的指标汇入总线的线 */
export function isLit(link: BoardLink, hovered: string | null, related: ReadonlySet<string>): boolean {
  if (hovered === null) {
    return false;
  }
  if (link.from === hovered || link.to === hovered || link.kind === 'bus') {
    return true;
  }
  if (hovered.startsWith('params:')) {
    return link.to === BUS && related.has(link.from);
  }
  return (related.has(link.from) || link.from === BUS) && related.has(link.to);
}
