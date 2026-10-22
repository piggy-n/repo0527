import type { ChartType, Indicator } from '../model';

// 覆盖类指标按比较重点选择图形，显式配置不依赖卡片顺序或 Mock 数据
const CHART_PREFERENCES: Readonly<Record<string, ChartType>> = {
  'A-15': 'bar', 'B-11': 'line', 'D01-5': 'line',
  'B-57': 'bar', 'A08-2': 'line', 'B-35': 'bar', 'B-47': 'bar', 'A08-1': 'line',
  'A-31': 'line', 'A-32': 'bar', 'A-33': 'line', 'A-34': 'bar', 'A-35': 'bar', 'A-36': 'line',
  'B-14': 'bar', 'B-34': 'line', 'A-37': 'bar', 'B-65': 'line', 'A-30': 'bar',
  'A02-1': 'line', 'A04-1': 'bar', 'A06-5': 'bar', 'A07-1-1': 'line', 'A09-2': 'line',
  'A02-4': 'bar', 'A06-2': 'line', 'A06-3': 'bar', 'A06-4': 'line', 'D02-9': 'bar'
};

// 数量、年度新增量和距离侧重比较；密度、人均和结构比例侧重轮廓变化
export function getDefaultChartType(indicator: Indicator): ChartType {
  if (CHART_PREFERENCES[indicator.id]) {
    return CHART_PREFERENCES[indicator.id];
  }
  if (indicator.precision === 0 || /新增|距离|数量|套数/.test(indicator.name)) {
    return 'bar';
  }
  if (/密度|人均|每千|每万人|面积率|占比|比例/.test(indicator.name)) {
    return 'line';
  }
  // 新指标无明显偏好时按编码稳定分配，刷新、筛选和排序不会改变默认类型
  let hash = 2166136261;
  for (const character of indicator.id) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? 'bar' : 'line';
}
