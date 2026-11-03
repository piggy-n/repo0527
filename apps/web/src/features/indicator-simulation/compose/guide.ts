import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { scopeText } from '../flow/plan';
import { indicatorName, type SimulationConditions } from '../model/params';
import { scopeCityCodes } from '../model/scope';
import { em, type Rich, rich } from '../run/narrative';
import { CONDITION_LABELS, type Composition, type ConditionKind, missingConditions, rememberedScopes } from './composition';
import type { ConditionConflict, ConflictOption } from './conflicts';

/** 计算之前的一句对话：开始计算时接到时间线的最前面 */
export interface DialogueLine {
  readonly speaker: 'user' | 'ai';
  readonly text: string;
}

/** 执行校验（ADR 0129）：条件齐全、没有要确认的冲突才能计算；开始按钮、自动开始、计算中的重算都先过它 */
export const canRun = (conditions: SimulationConditions, conflicts: readonly ConditionConflict[]): boolean =>
  missingConditions(conditions).length === 0 && conflicts.length === 0;

/** 还不能计算的原因，如"待补充：监测范围；待确认：计算规程"；能计算时是空字符串 */
export function blockerText(conditions: SimulationConditions, conflicts: readonly ConditionConflict[]): string {
  const asks = conflicts.map(conflict => conflict.label);
  const lack = missingConditions(conditions)
    .map(kind => CONDITION_LABELS[kind])
    .filter(label => !asks.includes(label));
  return [lack.length > 0 && `待补充：${lack.join('、')}`, asks.length > 0 && `待确认：${asks.join('、')}`]
    .filter(Boolean)
    .join('；');
}

/** 已经知道的条件，如"2025 年 · 南京市 · 社区卫生服务设施步行15分钟覆盖率等 2 项指标" */
export function knownConditions({ conditions, params }: Composition): string {
  const { years, scope, indicatorIds } = conditions;
  const [first] = indicatorIds;
  const parts: string[] = [];
  if (years.length > 0) {
    parts.push(`${years.toSorted((a, b) => a - b).join('、')} 年`);
  }
  if (scopeCityCodes(scope).length > 0) {
    parts.push(scopeText(scope));
  }
  if (first !== undefined) {
    const name = indicatorName(first, params);
    parts.push(indicatorIds.length > 1 ? `${name}等 ${indicatorIds.length} 项指标` : name);
  }
  return parts.join(' · ');
}

/** 引导卡的内容（ADR 0129）：一次问一件事，其余的写"还有 n 项" */
export interface ComposeGuide {
  /** conflict 问冲突，scope 问范围，missing 问其他条件，ready 是都齐了 */
  readonly kind: 'conflict' | 'scope' | 'missing' | 'ready';
  /** 开头的话：刚改了什么；没有时是已识别的条件 */
  readonly lead: { readonly tone: 'said' | 'known'; readonly text: string } | null;
  readonly question: Rich;
  /** 可以直接点的回答：冲突的选项，或者已有的范围 */
  readonly options: readonly ConflictOption[];
  /** 问范围时先给哪一种的入口 */
  readonly scopeKind: 'cities' | 'area';
  readonly more: number;
}

export interface GuideInput {
  readonly conflicts: readonly ConditionConflict[];
  /** 刚改了什么、没改的原因 */
  readonly said: readonly string[];
  /** 用户说过要计算：齐全后的说法不同 */
  readonly intent: boolean;
  /** 刚移除的市：给一个恢复的选项 */
  readonly removedCities: readonly string[];
}

const namesOf = (codes: readonly string[]) => codes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);

// 已有的范围放在最前面：记下的自定义范围、刚移除的市
function memoryOptions(composition: Composition, removedCities: readonly string[]): ConflictOption[] {
  const { area } = rememberedScopes(composition);
  const options: ConflictOption[] = [];
  if (area && composition.conditions.scope.kind === 'cities') {
    options.push({ label: `使用「${area.name}」`, say: '用自定义范围' });
  }
  if (removedCities.length > 0) {
    const names = namesOf(removedCities);
    const [first = ''] = names;
    const label = names.length <= 2 ? names.join('、') : `${first}等 ${names.length} 个市`;
    options.push({ label: `恢复${label}`, say: names.join('、') });
  }
  return options;
}

/** 引导卡说什么、给什么选项；由条件和对话的状态推导 */
export function composeGuide(composition: Composition, input: GuideInput): ComposeGuide {
  const { conditions } = composition;
  const { conflicts, said, intent, removedCities } = input;
  const lack: readonly ConditionKind[] = missingConditions(conditions);
  const known = knownConditions(composition);
  const labels = new Set([...lack.map(kind => CONDITION_LABELS[kind]), ...conflicts.map(conflict => conflict.label)]);
  const scopeKind = conditions.scope.kind;
  let lead: ComposeGuide['lead'] = null;
  if (said.length > 0) {
    lead = { tone: 'said', text: `${said.join('；')}。` };
  } else if (known !== '') {
    lead = { tone: 'known', text: `已识别：${known}。` };
  }
  const base = { lead, scopeKind, more: Math.max(0, labels.size - 1) };
  const [conflict] = conflicts;
  if (conflict) {
    return { ...base, kind: 'conflict', question: [conflict.question], options: conflict.options };
  }
  if (lack.includes('region')) {
    const question =
      scopeKind === 'area'
        ? rich`还缺${em('自定义范围')}，可以上传、绘制，或改用行政区划：`
        : rich`还缺${em('监测范围')}，可以回复城市名称，或选择：`;
    return { ...base, kind: 'scope', question, options: memoryOptions(composition, removedCities) };
  }
  if (lack.length > 0) {
    const names = lack.map(kind => CONDITION_LABELS[kind]).join('、');
    return { ...base, kind: 'missing', question: rich`还缺${em(names)}，可以直接说，或在左侧选择。`, options: [] };
  }
  const ready = intent ? '条件已齐全，确认后开始计算；也可以继续调整。' : '条件已齐全，可以开始计算。';
  return { ...base, kind: 'ready', question: [ready], options: [] };
}
