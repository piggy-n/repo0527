import { type Ref, shallowRef } from 'vue';

/** 从条件库拖出的一项 */
export type DragItem =
  | { readonly kind: 'years'; readonly year: number }
  | { readonly kind: 'region'; readonly code: string }
  | { readonly kind: 'indicators'; readonly id: string };

/** 条件库和编排图之间的拖放：拖出时记下拖的是什么，放下或取消时清除 */
export interface ConditionDrag {
  readonly item: Readonly<Ref<DragItem | null>>;
  start(item: DragItem, event: DragEvent): void;
  end(): void;
}

const dragText = (item: DragItem): string => {
  switch (item.kind) {
    case 'years':
      return String(item.year);
    case 'region':
      return item.code;
    case 'indicators':
      break;
  }
  return item.id;
};

export function useConditionDrag(): ConditionDrag {
  const item = shallowRef<DragItem | null>(null);
  return {
    item,
    start: (next, event) => {
      item.value = next;
      // Firefox 要有数据才开始拖动；放下时只认 item，不读这里的文字
      event.dataTransfer?.setData('text/plain', dragText(next));
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'copy';
      }
    },
    end: () => {
      item.value = null;
    }
  };
}
