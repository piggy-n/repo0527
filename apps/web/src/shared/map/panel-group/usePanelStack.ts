import { computed, ref, shallowRef } from 'vue';
import { panelStackLayout, type StackedPanel } from './panel-stack';

/** 两块面板的手动收起与最近操作；尺寸变化只推导显示，不清空业务状态 */
export function usePanelStack(options: {
  readonly height: () => number;
  readonly functionsOpen: () => boolean;
  readonly detailOpen: () => boolean;
}) {
  const preferred = ref<StackedPanel>('functions');
  const collapsed = shallowRef<Record<StackedPanel, boolean>>({ functions: false, detail: false });
  const layout = computed(() => panelStackLayout({
    height: options.height(),
    functionsOpen: options.functionsOpen(),
    detailOpen: options.detailOpen(),
    preferred: preferred.value,
    collapsed: collapsed.value
  }));
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
