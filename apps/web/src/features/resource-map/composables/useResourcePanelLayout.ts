import { computed, type ComputedRef, shallowRef } from 'vue';
import { z } from 'zod';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';

/** 资源图层面板的布局（ADR 0053 第 6 节）：是否收起、"已勾选"区占可用高度的比例 */
export interface ResourcePanelLayoutState {
  readonly collapsed: boolean;
  /** 0～1；显示时再按两边的最小高度限制 */
  readonly checkedRatio: number;
}

export const INITIAL_PANEL_LAYOUT: ResourcePanelLayoutState = Object.freeze({ collapsed: false, checkedRatio: 0.4 });

const storedPanelLayoutSchema = z.object({
  collapsed: z.boolean(),
  checkedRatio: z.number().min(0).max(1)
});

export interface ResourcePanelLayout {
  readonly collapsed: ComputedRef<boolean>;
  readonly checkedRatio: ComputedRef<number>;
  readonly setCollapsed: (collapsed: boolean) => void;
  /** 不在 0～1 之间的有限数时抛错 */
  readonly setCheckedRatio: (ratio: number) => void;
}

export interface UseResourcePanelLayoutOptions {
  /** 页面提供时按账号记住（ADR 0042）；不提供时不读不写 */
  readonly preferences?: PreferenceScope | null;
}

/** 创建资源图层面板布局的拥有者，在页面的 setup 中调用；窄屏时让给右边只是显示，不改这里的状态（ADR 0053 第 8 节） */
export function useResourcePanelLayout({ preferences }: UseResourcePanelLayoutOptions = {}): ResourcePanelLayout {
  // 整体替换，值没变时不替换
  const state = shallowRef<ResourcePanelLayoutState>(INITIAL_PANEL_LAYOUT);

  if (preferences) {
    usePreference(preferences, {
      name: 'resource-panel',
      version: 1,
      schema: storedPanelLayoutSchema,
      snapshot: () => state.value,
      restore: stored => {
        if (stored) {
          state.value = stored;
        }
      }
    });
  }

  return {
    collapsed: computed(() => state.value.collapsed),
    checkedRatio: computed(() => state.value.checkedRatio),
    setCollapsed: collapsed => {
      if (state.value.collapsed !== collapsed) {
        state.value = { ...state.value, collapsed };
      }
    },
    setCheckedRatio: ratio => {
      if (!(Number.isFinite(ratio) && ratio >= 0 && ratio <= 1)) {
        throw new RangeError(`比例应在 0～1 之间，收到 ${ratio}`);
      }
      if (state.value.checkedRatio !== ratio) {
        state.value = { ...state.value, checkedRatio: ratio };
      }
    }
  };
}
