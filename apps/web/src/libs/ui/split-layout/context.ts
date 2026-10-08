import { type ComputedRef, inject, type InjectionKey } from 'vue';

export interface SplitLayoutContext {
  /** 视口窄于断点：侧栏收进抽屉 */
  compact: ComputedRef<boolean>;
  /** 抽屉是否打开 */
  asideOpen: ComputedRef<boolean>;
  /** 侧栏的名称，用于打开按钮的文字和抽屉的无障碍名称 */
  asideLabel: ComputedRef<string>;
  openAside: () => void;
  closeAside: () => void;
}

export const splitLayoutKey: InjectionKey<SplitLayoutContext> = Symbol('MxSplitLayout');

// 侧栏内容中的最外层面板：放进抽屉时去掉圆角阴影、加关闭按钮；面板会为自己的后代重置为 false
export const asideRegionKey: InjectionKey<boolean> = Symbol('MxSplitLayoutAside');

/** 分栏布局里的组件读取布局状态，例如在抽屉里选中一项后调用 closeAside */
export function useSplitLayout(): SplitLayoutContext {
  const context = inject(splitLayoutKey, null);
  if (!context) {
    throw new Error('useSplitLayout() 只能在 MxSplitLayout 内部使用');
  }
  return context;
}
