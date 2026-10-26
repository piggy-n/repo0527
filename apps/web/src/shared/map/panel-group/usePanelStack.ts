import { computed, type ComputedRef, ref, shallowRef } from 'vue';
import { panelStackLayout, type PanelStackLayout, type StackedPanel } from './panel-stack';

export interface UsePanelStackOptions {
  /** 两块面板共用的可用高度；还量不到时为 0 */
  readonly height: () => number;
  readonly functionsOpen: () => boolean;
  readonly detailOpen: () => boolean;
}

export interface PanelStack {
  readonly layout: ComputedRef<PanelStackLayout>;
  /** 用户操作了这一块：空间不足时优先显示它；expand 时同时展开它 */
  readonly activate: (panel: StackedPanel, expand?: boolean) => void;
  /** 手动收起或展开；展开的一块成为优先显示的 */
  readonly setCollapsed: (panel: StackedPanel, value: boolean) => void;
}

/** 两块面板的手动收起与最近操作；尺寸变化只推导显示，不清空业务状态 */
export function usePanelStack(options: UsePanelStackOptions): PanelStack {
  const preferred = ref<StackedPanel>('functions');
  const collapsed = shallowRef<Record<StackedPanel, boolean>>({ functions: false, detail: false });
  const layout = computed(() =>
    panelStackLayout({
      height: options.height(),
      functionsOpen: options.functionsOpen(),
      detailOpen: options.detailOpen(),
      preferred: preferred.value,
      collapsed: collapsed.value
    })
  );

  const activate = (panel: StackedPanel, expand = false) => {
    preferred.value = panel;
    if (expand) {
      collapsed.value = { ...collapsed.value, [panel]: false };
    }
  };

  const setCollapsed = (panel: StackedPanel, value: boolean) => {
    collapsed.value = { ...collapsed.value, [panel]: value };
    if (!value) {
      preferred.value = panel;
    }
  };

  return { layout, activate, setCollapsed };
}
