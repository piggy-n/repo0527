import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { findCities, findIndicators } from '../compose/prompt';
import { simulationIndicator } from '../model/indicators';
import type { SimulationConditions } from '../model/params';
import type { ResultSelection, RunView } from './result-view';

/** 看结果的一句话：只换结果的选择和主区的视图，不重新推演 */
export interface ViewCommand {
  readonly patch: Partial<ResultSelection>;
  readonly show: RunView;
  readonly reply: string;
}

// 有这些说法时是改条件、改参数或控制推演，交给 interpretCommand
const CHANGE = /加上|增加|添加|再加|加入|也看|去掉|删除|删掉|移除|不看|不要|只看|只推演|换成|改成|改为|改回|旧规程|新规程|相交|人口|目标|标准口径|停止|暂停|继续|重新/;

const cityName = (code: string) => JIANGSU_CITIES.find(city => city.code === code)?.name ?? code;

/**
 * 推演完成后理解"看结果"的说法（按规则，run/commands.ts 之前）：回看推演流程、按达标或数值着色、回到整个范围、
 * 看某一年、看范围里的某个市、看条件里的某项指标；不在条件里的城市、年度、指标不算（交给 interpretCommand 去加上）
 */
export function interpretView(input: string, conditions: SimulationConditions): ViewCommand | null {
  const text = input.replace(/\s+/g, '');
  if (CHANGE.test(text)) {
    return null;
  }
  if (text.includes('流程')) {
    return { patch: {}, show: 'flow', reply: '回到推演流程。点标题栏的"推演结果"再回来。' };
  }
  if (text.includes('达标') && /着色|颜色|看/.test(text)) {
    return { patch: { mode: 'pass' }, show: 'result', reply: '地图按达标着色：主色达标，琥珀色接近，红色未达标。' };
  }
  if (text.includes('数值')) {
    return { patch: { mode: 'value' }, show: 'result', reply: '地图按数值着色。' };
  }
  if (/全省|全部|整体|推演范围/.test(text) && /看|回/.test(text)) {
    return { patch: { cityCode: null }, show: 'result', reply: '回到整个推演范围。' };
  }
  const year = conditions.years.find(item => text.includes(String(item)));
  if (year !== undefined) {
    return { patch: { year }, show: 'result', reply: `看 ${year} 年的结果。` };
  }
  const city = findCities(text).find(code => conditions.cityCodes.includes(code));
  if (city !== undefined) {
    return conditions.cityCodes.length > 1
      ? { patch: { cityCode: city }, show: 'result', reply: `放大到${cityName(city)}，设施和服务范围放大后显示。` }
      : { patch: {}, show: 'result', reply: `推演范围就是${cityName(city)}。` };
  }
  const indicator = findIndicators(text).find(id => conditions.indicatorIds.includes(id));
  if (indicator !== undefined && text.includes('看')) {
    return { patch: { indicatorId: indicator }, show: 'result', reply: `看${simulationIndicator(indicator).short}。` };
  }
  if (text.includes('结果')) {
    return { patch: {}, show: 'result', reply: '这是推演结果。' };
  }
  return null;
}

/** 看结果时的快捷说法：看另一个市（多个市时）、换着色、看另一项指标、回看推演流程 */
export function viewSuggestions(conditions: SimulationConditions, selection: ResultSelection): string[] {
  const city = conditions.cityCodes.length > 1 ? conditions.cityCodes.find(code => code !== selection.cityCode) : undefined;
  const other = conditions.indicatorIds.find(id => id !== selection.indicatorId);
  return [
    ...(city === undefined ? [] : [`看${cityName(city)}`]),
    selection.mode === 'pass' ? '按数值着色' : '按达标着色',
    ...(other === undefined ? [] : [`看${simulationIndicator(other).short}`]),
    '回看推演流程'
  ];
}
