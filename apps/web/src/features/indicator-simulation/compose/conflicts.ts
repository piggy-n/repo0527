import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { POP_CHANGE_RANGE, PARAM_LABELS, type ParamKey } from '../model/params';
import { scopeCityCodes } from '../model/scope';
import type { Composition } from './composition';

/** 要用户确认的条件（ADR 0129）：说的年份都不可选，或者一句话里同一项说了两种取值 */
export type ConflictKey = 'years' | 'scope' | ParamConflictKey;

/** 能说出两种取值的参数；步行时长可以按指标分别说，不算冲突 */
export type ParamConflictKey = Extract<ParamKey, 'rule' | 'recognition' | 'popChange'>;

/** 一个选项：点了等于说这句话，和用户自己回复走同一条路 */
export interface ConflictOption {
  readonly label: string;
  readonly say: string;
}

export interface ConditionConflict {
  readonly key: ConflictKey;
  /** 这项条件的名称，写在"待确认"后面 */
  readonly label: string;
  readonly question: string;
  readonly options: readonly ConflictOption[];
}

const POP = /人口(增加|增长|上升|提高|减少|下降|降低)(\d+)%/g;

/** 去掉人口变化的说法：其中的"增加"不是在加条件 */
export const withoutPop = (text: string): string => text.replace(POP, '');

/** 句子里说到的人口变化：按 5% 取整、限在范围内，减少写成负数；重复的算一个 */
export function saidPopChanges(text: string): number[] {
  const values = [...text.matchAll(POP)].map(match => {
    const stepped = Math.round(Number(match[2]) / POP_CHANGE_RANGE.step) * POP_CHANGE_RANGE.step;
    const size = Math.min(POP_CHANGE_RANGE.max, stepped);
    return /减少|下降|降低/.test(match[1] ?? '') ? -size : size;
  });
  return [...new Set(values)];
}

const RULE_TARGET = /(?:改成|改为|换成|改回|切换到)(旧|新)规程/;

/** 句子里说的计算规程；"把旧规程改成新规程"说的是新规程，同时说了两种且看不出先后时是 both */
export function saidRule(text: string): 'old' | 'new' | 'both' | null {
  const target = RULE_TARGET.exec(text);
  if (target) {
    return target[1] === '旧' ? 'old' : 'new';
  }
  const old = text.includes('旧规程');
  const fresh = text.includes('新规程');
  if (old && fresh) {
    return 'both';
  }
  if (old) {
    return 'old';
  }
  return fresh ? 'new' : null;
}

const RECOGNITION_TARGET = /(?:改成|改为|换成|改回)[^，。；]*?(相交|50%|一半)/;
const HALF = /(?:覆盖|认定)[^，。；]*(?:50%|一半)/;

/** 句子里说的覆盖认定；写法同计算规程 */
export function saidRecognition(input: string): 'intersect' | 'half' | 'both' | null {
  const text = withoutPop(input);
  const target = RECOGNITION_TARGET.exec(text);
  if (target) {
    return target[1] === '相交' ? 'intersect' : 'half';
  }
  const intersect = text.includes('相交');
  const half = HALF.test(text);
  if (intersect && half) {
    return 'both';
  }
  if (intersect) {
    return 'intersect';
  }
  return half ? 'half' : null;
}

/** 参数的冲突 */
export interface ParamConflict extends ConditionConflict {
  readonly key: ParamConflictKey;
}

/** 一句话里互相矛盾的参数：不替用户选，问一下 */
export function paramConflicts(text: string): ParamConflict[] {
  const list: ParamConflict[] = [];
  if (saidRule(text) === 'both') {
    list.push({
      key: 'rule',
      label: PARAM_LABELS.rule,
      question: '同时提到了旧规程和新规程，要按哪一个计算？',
      options: [
        { label: '旧规程', say: '按旧规程计算' },
        { label: '新规程', say: '按新规程计算' }
      ]
    });
  }
  if (saidRecognition(text) === 'both') {
    list.push({
      key: 'recognition',
      label: PARAM_LABELS.recognition,
      question: '同时提到了相交即算和覆盖 50%，要按哪一个认定？',
      options: [
        { label: '相交即算', say: '改成相交即算' },
        { label: '覆盖 ≥ 50%', say: '覆盖认定改回 50%' }
      ]
    });
  }
  const pops = saidPopChanges(text);
  if (pops.length > 1) {
    const words = pops.map(value => `${value > 0 ? '增加' : '减少'} ${Math.abs(value)}%`);
    list.push({
      key: 'popChange',
      label: PARAM_LABELS.popChange,
      question: `同时提到了常住人口${words.join('和')}，要按哪一个？`,
      options: words.map(word => ({ label: word, say: `常住人口${word}` }))
    });
  }
  return list;
}

/** 说的年份都不可选：不替用户换年份，问一下 */
export function yearsConflict(unavailable: readonly number[], years: readonly number[]): ConditionConflict {
  const last = years.at(-1) ?? '';
  const [first = ''] = years;
  return {
    key: 'years',
    label: '年份',
    question: `没有 ${unavailable.join('、')} 年的数据，可选 ${last}～${first} 年。要计算哪一年？`,
    options: years.slice(0, 2).map(year => ({ label: `${year} 年`, say: `改成 ${year} 年` }))
  };
}

/** 同时说了自定义范围和城市 */
export function scopeConflict(cityCodes: readonly string[], hasArea: boolean): ConditionConflict {
  const names = cityCodes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
  const [first = ''] = names;
  const text = names.length <= 3 ? names.join('、') : `${first}等 ${names.length} 个市`;
  return {
    key: 'scope',
    label: '监测范围',
    question: `同时提到了自定义范围和${text}，要用哪一个？`,
    options: [
      { label: hasArea ? '用自定义范围' : '用自定义范围（去上传）', say: '用自定义范围' },
      { label: `用${text}`, say: names.join('、') }
    ]
  };
}

/** 手动改条件后还没解决的冲突：范围、年份有了就算解决，参数换了取值也算 */
export function conflictsAfterEdit(
  conflicts: readonly ConditionConflict[],
  before: Composition,
  after: Composition
): ConditionConflict[] {
  const settled: Readonly<Record<ConflictKey, boolean>> = {
    years: after.conditions.years.length > 0,
    scope: scopeCityCodes(after.conditions.scope).length > 0,
    rule: before.params.rule !== after.params.rule,
    recognition: before.params.recognition !== after.params.recognition,
    popChange: before.params.popChange !== after.params.popChange
  };
  return conflicts.filter(conflict => !settled[conflict.key]);
}
