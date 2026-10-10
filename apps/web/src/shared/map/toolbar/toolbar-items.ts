import { Crop, Delete, HomeFilled, Rank, Share } from '@element-plus/icons-vue';
import { BROWSE_TOOL } from '@yzt/map-core';
import type { Component } from 'vue';
import { MEASURE_TOOL_IDS, type MeasureToolId } from '../measure/useMeasure';

/** 工具栏上的工具：激活后接管地图的鼠标，同一时间只有一个；ID 就是登记到会话里的工具 ID */
export type ToolbarToolId = typeof BROWSE_TOOL | MeasureToolId;

/** 工具栏上的动作：一次性的操作，由页面给出回调 */
export type ToolbarActionId = 'default-view' | 'clear';

export type ToolbarItemId = ToolbarToolId | ToolbarActionId;

export interface ToolbarItem {
  readonly label: string;
  readonly icon: Component;
}

// 工具和动作的名称、图标集中在这里（ADR 0034 第 5 条）；图标先用 Element 的，5D 换成设计的素材
export const TOOLBAR_TOOLS: Readonly<Record<ToolbarToolId, ToolbarItem>> = {
  [BROWSE_TOOL]: { label: '移动', icon: Rank },
  [MEASURE_TOOL_IDS.distance]: { label: '测距', icon: Share },
  [MEASURE_TOOL_IDS.area]: { label: '测面', icon: Crop }
};

export const TOOLBAR_ACTIONS: Readonly<Record<ToolbarActionId, ToolbarItem>> = {
  'default-view': { label: '默认视角', icon: HomeFilled },
  clear: { label: '清除', icon: Delete }
};

export function isToolbarTool(id: ToolbarItemId): id is ToolbarToolId {
  return Object.hasOwn(TOOLBAR_TOOLS, id);
}
