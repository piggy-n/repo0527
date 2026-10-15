import { type ShallowRef, shallowRef } from 'vue';
import { closePanel, emptyPanelGroup, type PanelGroupState, showPanel, togglePanel } from './panel-group';

/**
 * 一组 Tab 面板（ADR 0053 第 4 节）：已打开的功能和当前的 Tab 是页面的界面状态，业务状态仍在各自的拥有者里。
 * 写成方法签名，具体 Id 的面板组可以交给只认 string 的外壳
 */
export interface PanelGroup<Id extends string = string> {
  /** Tab 的固定顺序 */
  readonly order: readonly Id[];
  readonly state: Readonly<ShallowRef<PanelGroupState<Id>>>;
  isOpen(id: Id): boolean;
  /** 打开并切到它 */
  show(id: Id): void;
  /** 入口的点击：没打开时打开，没在显示时切到它，正在显示时关闭 */
  toggle(id: Id): void;
  close(id: Id): void;
}

/** 创建一组 Tab 面板；不在 order 里的功能直接抛错 */
export function usePanelGroup<const Id extends string>(order: readonly Id[]): PanelGroup<Id> {
  // 整体替换，规则没有改变状态时不替换
  const state = shallowRef<PanelGroupState<Id>>(emptyPanelGroup());

  const update = (id: Id, next: (current: PanelGroupState<Id>) => PanelGroupState<Id>) => {
    if (!order.includes(id)) {
      throw new RangeError(`这组面板里没有 ${id}`);
    }
    state.value = next(state.value);
  };

  return {
    order,
    state,
    isOpen: id => state.value.open.includes(id),
    show: id => update(id, current => showPanel(current, id, order)),
    toggle: id => update(id, current => togglePanel(current, id, order)),
    close: id => update(id, current => closePanel(current, id))
  };
}
