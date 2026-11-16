import type { PanelMenuEntry } from '@/shared/map/layer-panel/PanelMenu';
import type { PanelToolItem } from '@/shared/map/layer-panel/PanelToolbar';

// "图层"里标注的入口（ADR 0160）：工具栏的第 8 个按钮、右键菜单的两项，打开第三种浮层 label。
// 三维模型没有标注（同透明度、图例）；没有登记标注字段的资源入口灰掉、写出原因

/** 选中的一行和标注有关的状态 */
export interface LabelRowState {
  /** 选中的是三维模型 */
  readonly model: boolean;
  /** 资源登记了标注字段 */
  readonly labelable: boolean;
  /** 资源开着标注 */
  readonly labeled: boolean;
}

/** 不能用标注时的原因；能用时为 undefined */
function unavailable({ model, labelable }: LabelRowState): string | undefined {
  if (model) {
    return '三维模型没有标注';
  }
  return labelable ? undefined : '没有可标注的字段';
}

/** 工具栏的"标注"按钮：放在图例后面；没有选中的行时灰掉 */
export function labelToolItem(row: LabelRowState | null, pressed: boolean): PanelToolItem {
  const reason = row ? unavailable(row) : undefined;
  return {
    key: 'label',
    icon: 'map-label',
    label: '图层标注',
    tip: reason ?? '标注',
    disabled: row === null || reason !== undefined,
    pressed
  };
}

/** 右键菜单在透明度、图例后面的两项：显示或隐藏标注，打开标注浮层 */
export function labelMenuEntries(row: LabelRowState): PanelMenuEntry[] {
  const reason = unavailable(row);
  const disabled = reason !== undefined;
  const hint = reason === undefined ? {} : { hint: reason };
  return [
    {
      key: 'label-visible',
      label: row.labeled ? '隐藏标注' : '显示标注',
      icon: row.labeled ? 'map-label-off' : 'map-label',
      disabled,
      ...hint
    },
    { key: 'label', label: '标注…', icon: 'symbol-settings', disabled, ...hint }
  ];
}
