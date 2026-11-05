import { SIMULATION_INDICATORS, type SimulationIndicator } from '../model/indicators';
import { paramApplies, type SimulationParams, snapWalkMinutes, withWalkMinutes } from '../model/params';

// 指令和对话里的步行时长（ADR 0125）

/** 指标的核心名称：去掉服务范围和"覆盖率""面积"，如"社区卫生服务设施" */
export const coreName = (item: SimulationIndicator): string =>
  item.name
    .replace(/步行\d+分钟/, '')
    .replace(/\d+分钟(可达|出警)?/, '')
    .replace(/\d+(公里|千米)(服务)?/, '')
    .replace(/(覆盖率|面积)$/, '');

/** 步行类指标简称的词干，如"社区卫生"；其余指标没有 */
export const walkStem = (item: SimulationIndicator): string | null =>
  paramApplies('walk', item.id) ? item.short.replace(/覆盖率$/, '') : null;

// 旧规程的说法里也有"步行 5 分钟"，那不是要改时长
const OLD_RULE = /(?:卫生服务站|文化活动站|站点)?步行\d+分钟的旧规程/g;
const GENERAL = /步行(?:时长|时间)?(?:改为|改成|调整为|调到|设为|为)?(\d+)分钟/;
const ATTACHED = /^的?(?:改为|改成|调整为|调到|设为|按)?步行(?:时长|时间)?(?:改为|改成|调整为|调到|设为|为)?(\d+)分钟/;

/** 一句话里说到的步行时长，文字已去掉空白 */
export interface WalkMention {
  /** 紧跟在指标后面说的时长，只改这一项 */
  readonly attached: ReadonlyMap<string, number>;
  /** 没说指标的时长，改所选的全部步行类指标（单独说了的除外）；没有时为 null */
  readonly general: number | null;
  /** 去掉这些说法后的句子：其中的"改成"不该再当成"只看" */
  readonly rest: string;
}

/** 找出句子里的步行时长；没说时为 null */
export function findWalk(text: string): WalkMention | null {
  let rest = text.replace(OLD_RULE, '旧规程');
  const attached = new Map<string, number>();
  for (const item of SIMULATION_INDICATORS) {
    const stem = walkStem(item);
    if (stem === null) {
      continue;
    }
    for (const word of [coreName(item), stem]) {
      const at = rest.indexOf(word);
      const match = at === -1 ? null : ATTACHED.exec(rest.slice(at + word.length));
      if (match) {
        attached.set(item.id, Number(match[1]));
        rest = rest.slice(0, at) + rest.slice(at + word.length + match[0].length);
        break;
      }
    }
  }
  const general = GENERAL.exec(rest);
  if (attached.size === 0 && !general) {
    return null;
  }
  return {
    attached,
    general: general ? Number(general[1]) : null,
    rest: general ? rest.replace(general[0], '') : rest
  };
}

/** 把说到的时长用到所选的指标上：取最近的一档 */
export interface WalkApplied {
  readonly params: SimulationParams;
  /** 用到了几项所选的指标 */
  readonly applied: number;
  /** 有没有说的时长不在档位上或超过上限 */
  readonly snapped: boolean;
}

export function applyWalk(
  params: SimulationParams,
  { attached, general }: WalkMention,
  indicatorIds: readonly string[]
): WalkApplied {
  let next = params;
  let applied = 0;
  let snapped = false;
  for (const id of indicatorIds) {
    const said = attached.get(id) ?? general;
    if (said !== null && paramApplies('walk', id)) {
      const minutes = snapWalkMinutes(id, said);
      next = withWalkMinutes(next, id, minutes);
      applied += 1;
      snapped ||= minutes !== said;
    }
  }
  return { params: next, applied, snapped };
}
