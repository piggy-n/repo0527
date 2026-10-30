import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { simulationIndicator } from '../model/indicators';
import { describeParam, isStandard, PARAM_LABELS, paramsOf } from '../model/params';
import { indicatorNode, OUTPUT_NODE, paramNode, REGION_NODE, yearNode } from './board';
import { type Composition, emptyComposition, withIndicator, withYear } from './composition';

/** AI 按指令编排的一步：出现一个节点，编排随之更新 */
export interface BuildStep {
  /** 这一步出现的节点（编排图的节点键） */
  readonly node: string;
  /** AI 在做的事，如"识别指标：社区卫生服务设施步行15分钟覆盖率" */
  readonly message: string;
  /** 这一步之后的编排 */
  readonly composition: Composition;
}

function scopeText(cityCodes: readonly string[]): string {
  if (cityCodes.length === JIANGSU_CITIES.length) {
    return `全省 ${cityCodes.length} 个市`;
  }
  const names = cityCodes.map(code => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code);
  return names.length <= 3 ? names.join('、') : `${names[0]}等 ${names.length} 个市`;
}

/**
 * 从空白开始编排到目标的每一步：年份逐个、监测范围、指标逐个、参数逐个（所选指标用得上的几项），最后是 AI 推演；
 * 参数在第一个参数节点出现时一起设好
 */
export function buildSteps(target: Composition): BuildStep[] {
  const { conditions, params } = target;
  const steps: BuildStep[] = [];
  let current = emptyComposition();
  for (const year of conditions.years) {
    current = withYear(current, year, true);
    steps.push({ node: yearNode(year), message: `识别年份：${year} 年`, composition: current });
  }
  current = { ...current, conditions: { ...current.conditions, cityCodes: conditions.cityCodes } };
  steps.push({ node: REGION_NODE, message: `识别范围：${scopeText(conditions.cityCodes)}`, composition: current });
  for (const id of conditions.indicatorIds) {
    current = withIndicator(current, id, true);
    steps.push({ node: indicatorNode(id), message: `识别指标：${simulationIndicator(id).name}`, composition: current });
  }
  current = { ...current, params };
  for (const key of paramsOf(conditions.indicatorIds)) {
    const note = isStandard(key, params) ? '（标准口径）' : '（自定义口径）';
    steps.push({
      node: paramNode(key),
      message: `设置${PARAM_LABELS[key]}：${describeParam(key, params)}${note}`,
      composition: current
    });
  }
  steps.push({ node: OUTPUT_NODE, message: '配置完成，即将开始计算', composition: current });
  return steps;
}
