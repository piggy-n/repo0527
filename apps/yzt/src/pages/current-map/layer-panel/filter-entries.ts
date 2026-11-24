import type { PanelMenuEntry } from '@/shared/map/layer-panel/PanelMenu';
import type { PanelToolItem } from '@/shared/map/layer-panel/PanelToolbar';

// "图层"里要素过滤的入口（ADR 0173）：工具栏最右的按钮（取代工具栏的"移除"，用户 2026-11-24）、右键菜单的"过滤…"，
// 打开第四种浮层 filter。三维模型没有属性过滤；没有可过滤字段的资源入口灰掉、写出原因

/** 选中的一行和过滤有关的状态 */
export interface FilterRowState {
  /** 选中的是三维模型 */
  readonly model: boolean;
  /** 资源有可过滤的字段 */
  readonly filterable: boolean;
  /** 资源过滤着 */
  readonly filtering: boolean;
}

/** 不能过滤时的原因；能用时为 undefined */
function unavailable({ model, filterable }: FilterRowState): string | undefined {
  if (model) {
    return '三维模型没有属性过滤';
  }
  return filterable ? undefined : '没有可过滤的字段';
}

/** 工具栏的"过滤"按钮：放在标注后面；没有选中的行时灰掉，选中的行过滤着时提示写出来 */
export function filterToolItem(row: FilterRowState | null, pressed: boolean): PanelToolItem {
  const reason = row ? unavailable(row) : undefined;
  return {
    key: 'filter',
    icon: 'layer-filter',
    label: '图层过滤',
    tip: reason ?? (row?.filtering ? '过滤（已过滤）' : '过滤'),
    disabled: row === null || reason !== undefined,
    pressed
  };
}

/** 右键菜单在标注后面的一项：打开过滤浮层 */
export function filterMenuEntry(row: FilterRowState): PanelMenuEntry {
  const reason = unavailable(row);
  return {
    key: 'filter',
    label: '过滤…',
    icon: 'layer-filter',
    disabled: reason !== undefined,
    ...(reason === undefined ? {} : { hint: reason })
  };
}
