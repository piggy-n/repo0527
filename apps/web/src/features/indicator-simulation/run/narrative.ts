import { simulationIndicator } from '../model/indicators';
import { describeParam, PARAM_LABELS, type ParamKey, type SimulationConditions, type SimulationParams } from '../model/params';

/** 带强调的一段文字：强调的部分是推演得出的数字和对象 */
export type RichPart = string | { readonly em: string };
export type Rich = readonly RichPart[];

export const em = (value: string | number): RichPart => ({ em: String(value) });

/** 拼一段文字：用 em() 插入的部分强调，其余原样 */
export function rich(strings: TemplateStringsArray, ...values: readonly (RichPart | number)[]): Rich {
  const parts: RichPart[] = [];
  strings.forEach((text, index) => {
    if (text !== '') {
      parts.push(text);
    }
    const value = values[index];
    if (value !== undefined) {
      parts.push(typeof value === 'number' ? String(value) : value);
    }
  });
  return parts;
}

export const plainText = (text: Rich): string => text.map(part => (typeof part === 'string' ? part : part.em)).join('');

const coverageIds = ({ indicatorIds }: SimulationConditions): string[] =>
  indicatorIds.filter(id => simulationIndicator(id).model === 'coverage');

/** 主指标：第一项覆盖率类，没有时是第一项指标；样例和结论围绕它 */
export const primaryIndicator = (conditions: SimulationConditions): string =>
  coverageIds(conditions)[0] ?? conditions.indicatorIds[0] ?? '';

/** 参数项的改动说明，如"计算规程 新规程 → 旧规程" */
export function describeChanges(
  keys: readonly ParamKey[],
  from: SimulationParams,
  to: SimulationParams,
  conditions: SimulationConditions
): string[] {
  return keys.map(
    key => `${PARAM_LABELS[key]} ${describeParam(key, from, conditions)} → ${describeParam(key, to, conditions)}`
  );
}
