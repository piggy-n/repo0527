import { BROWSE_TOOL } from '@yzt/map-core';
import type { IconName } from '../../icons/SvgIcon';
import { MEASURE_TOOL_IDS, type MeasureToolId } from '../measure/useMeasure';

/** 点选工具的 ID：按钮在工具栏上，实现由业务模块登记（ADR 0047 第 6 节） */
export const FEATURE_PICK_TOOL = 'feature-pick';

/** 工具栏上的工具：激活后接管地图的鼠标，同一时间只有一个；ID 就是登记到会话里的工具 ID */
export type ToolbarToolId = typeof BROWSE_TOOL | typeof FEATURE_PICK_TOOL | MeasureToolId;

/** 工具栏上的动作：由页面给出回调；开关面板的动作由页面告诉工具栏是否显示为按下（ADR 0036）。默认视角在基础组里（ADR 0053） */
export type ToolbarActionId = 'clear' | 'region-locate' | 'coordinate-locate' | 'legend';

export type ToolbarItemId = ToolbarToolId | ToolbarActionId;

export interface ToolbarItem {
  /** 完整的名称：提示和无障碍名称用它 */
  readonly label: string;
  readonly icon: IconName;
  /** 按钮上的文字怎样分行；不写时每行两个字 */
  readonly lines?: readonly string[];
}

// 工具和动作的名称、图标集中在这里（ADR 0034 第 5 条、ADR 0053 第 7 节）
export const TOOLBAR_TOOLS: Readonly<Record<ToolbarToolId, ToolbarItem>> = {
  [BROWSE_TOOL]: { label: '移动', icon: 'map-move' },
  // "点/框选"四个字符放得下一行，不按两个字拆开
  [FEATURE_PICK_TOOL]: { label: '点/框选', icon: 'map-pick', lines: ['点/框选'] },
  [MEASURE_TOOL_IDS.distance]: { label: '测距', icon: 'map-measure-distance' },
  [MEASURE_TOOL_IDS.area]: { label: '测面', icon: 'map-measure-area' }
};

export const TOOLBAR_ACTIONS: Readonly<Record<ToolbarActionId, ToolbarItem>> = {
  clear: { label: '清除', icon: 'map-clear' },
  'region-locate': { label: '区划定位', icon: 'map-region-locate' },
  'coordinate-locate': { label: '坐标定位', icon: 'map-coordinate-locate' },
  legend: { label: '图例', icon: 'map-legend' }
};

export function isToolbarTool(id: ToolbarItemId): id is ToolbarToolId {
  return Object.hasOwn(TOOLBAR_TOOLS, id);
}

/** 按钮上的文字每行两个字（ADR 0053 第 2 节） */
export function labelLines(label: string): string[] {
  return Array.from({ length: Math.ceil(label.length / 2) }, (_, line) => label.slice(line * 2, line * 2 + 2));
}

/** 按钮上的文字：条目指定了分行时按它，否则每行两个字 */
export function buttonLines(item: ToolbarItem): readonly string[] {
  return item.lines ?? labelLines(item.label);
}
