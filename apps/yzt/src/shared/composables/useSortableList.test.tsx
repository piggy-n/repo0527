import { mount } from '@vue/test-utils';
import SortableJS from 'sortablejs';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { useSortableList } from './useSortableList';

const ITEMS = ['a', 'b', 'c', 'd'];

// 实例在挂载后的下一轮渲染里建（侦听列表元素）
async function mountList(disabled = ref(false)) {
  const onMove = vi.fn<(from: number, to: number) => void>();
  const list = ref<HTMLElement>();
  const Host = defineComponent(() => {
    useSortableList(list, { handle: '[data-handle]', draggable: '[data-item]', disabled: () => disabled.value, onMove });
    return () => (
      <ul ref={list}>
        {ITEMS.map(item => (
          <li key={item} data-item={item}>
            <button type="button" data-handle>
              {item}
            </button>
          </li>
        ))}
      </ul>
    );
  });
  const wrapper = mount(Host);
  await nextTick();
  const element = list.value;
  if (!element) {
    throw new Error('列表没有渲染');
  }
  const sortable = SortableJS.get(element);
  if (!sortable) {
    throw new Error('没有建 SortableJS 实例');
  }
  return { wrapper, element, sortable, onMove, disabled };
}

const order = (element: HTMLElement) => [...element.children].map(child => child.getAttribute('data-item'));

// 模拟 SortableJS 放下时的样子：它已经把元素移到了新位置，再调用 onEnd
function drop(sortable: SortableJS, element: HTMLElement, from: number, to: number) {
  const item = element.children[from];
  if (!(item instanceof HTMLElement)) {
    throw new Error(`没有第 ${from} 个元素`);
  }
  item.remove();
  element.insertBefore(item, element.children[to] ?? null);
  const event = { item, from: element, oldIndex: from, newIndex: to, oldDraggableIndex: from, newDraggableIndex: to };
  sortable.options.onEnd?.(event as unknown as SortableJS.SortableEvent);
}

describe('useSortableList', () => {
  it('只认手柄、只按能拖的子元素算位置', async () => {
    const { sortable } = await mountList();

    expect(sortable.option('handle')).toBe('[data-handle]');
    expect(sortable.option('draggable')).toBe('[data-item]');
  });

  it('放下后先把元素放回原位，再把旧位置和新位置交给调用方', async () => {
    const { element, sortable, onMove } = await mountList();

    drop(sortable, element, 3, 0);
    expect(order(element)).toStrictEqual(ITEMS);
    expect(onMove).toHaveBeenLastCalledWith(3, 0);

    drop(sortable, element, 0, 2);
    expect(order(element)).toStrictEqual(ITEMS);
    expect(onMove).toHaveBeenLastCalledWith(0, 2);
  });

  it('位置不变时不调用', async () => {
    const { element, sortable, onMove } = await mountList();

    drop(sortable, element, 1, 1);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('停用随条件变化；卸载时销毁实例', async () => {
    const { wrapper, element, sortable, disabled } = await mountList();
    expect(sortable.option('disabled')).toBe(false);

    disabled.value = true;
    await nextTick();
    expect(sortable.option('disabled')).toBe(true);

    wrapper.unmount();
    expect(SortableJS.get(element)).toBeNull();
  });
});
