import SortableJS from 'sortablejs';
import { onScopeDispose, type Ref, watch } from 'vue';

export interface SortableListOptions {
  /** 拖动手柄的选择器：只有按住手柄才能拖 */
  readonly handle: string;
  /** 能拖动的子元素的选择器，位置只按它们算 */
  readonly draggable: string;
  /** 停用拖动（如搜索期间），可以随时变化 */
  readonly disabled?: () => boolean;
  /** 放下后在列表里的旧位置和新位置；位置不变时不调用 */
  readonly onMove: (from: number, to: number) => void;
}

/**
 * 列表的拖动排序（ADR 0054），在组件的 setup 中调用：给列表元素建一个 SortableJS 实例，元素换了就重建，作用域销毁时销毁。
 * SortableJS 拖动时自己移动 DOM，和 Vue 按数据渲染冲突：放下后先把元素放回原位，再把位置交给调用方，由拥有者改顺序、Vue 重新渲染
 */
export function useSortableList(element: Readonly<Ref<HTMLElement | undefined>>, options: SortableListOptions): void {
  let sortable: SortableJS | undefined;

  const destroy = () => {
    sortable?.destroy();
    sortable = undefined;
  };

  watch(
    element,
    list => {
      destroy();
      if (!list) {
        return;
      }
      sortable = SortableJS.create(list, {
        handle: options.handle,
        draggable: options.draggable,
        disabled: options.disabled?.() ?? false,
        animation: 150,
        onEnd: ({ item, from, oldIndex, oldDraggableIndex, newDraggableIndex }) => {
          if (oldIndex === undefined || oldDraggableIndex === undefined || newDraggableIndex === undefined) {
            return;
          }
          if (oldDraggableIndex === newDraggableIndex) {
            return;
          }
          // 放回原位：先取下，原来位置上的就是它原来后面的那个元素
          item.remove();
          from.insertBefore(item, from.children[oldIndex] ?? null);
          options.onMove(oldDraggableIndex, newDraggableIndex);
        }
      });
    },
    { immediate: true, flush: 'post' }
  );

  watch(
    () => options.disabled?.() ?? false,
    disabled => sortable?.option('disabled', disabled)
  );

  onScopeDispose(destroy);
}
