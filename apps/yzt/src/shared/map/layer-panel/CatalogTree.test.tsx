import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { type CatalogSelection, EMPTY_CATALOG_SELECTION } from './catalog-selection';
import type { CatalogLeaf, CatalogNode } from './catalog-tree';
import { CatalogTree } from './CatalogTree';

const leaf = (key: string, added = false): CatalogLeaf => ({
  kind: 'leaf',
  key,
  label: key,
  icon: 'geometry-polygon',
  added
});

// 国土变更（a、b）、水资源（c），加入了的打勾
const treeOf = (added: ReadonlySet<string>): CatalogNode[] => [
  {
    kind: 'branch',
    key: 'land',
    label: '国土变更',
    children: [leaf('a', added.has('a')), leaf('b', added.has('b'))]
  },
  { kind: 'branch', key: 'water', label: '水资源', children: [leaf('c', added.has('c'))] }
];

// 选中和展开像页面一样由外面持有；记下目录树报告的添加、移除、定位和菜单。
// accept 时像页面一样接受添加、移除，目录的勾跟着变；否则一直是 a 已加入
function mountTree({ accept = false } = {}) {
  const selection = ref<CatalogSelection>(EMPTY_CATALOG_SELECTION);
  const expanded = ref<ReadonlySet<string>>(new Set(['land', 'water']));
  const added = ref<ReadonlySet<string>>(new Set(['a']));
  const nodes = computed(() => treeOf(added.value));
  const events: unknown[][] = [];
  const wrapper = mount(
    defineComponent(() => () => (
      <CatalogTree
        nodes={nodes.value}
        expanded={expanded.value}
        selection={selection.value}
        label="资源"
        onUpdate:selection={(next: CatalogSelection) => (selection.value = next)}
        onUpdate:expanded={(next: ReadonlySet<string>) => (expanded.value = next)}
        onAdd={(keys: readonly string[]) => {
          events.push(['add', ...keys]);
          if (accept) {
            added.value = new Set([...added.value, ...keys]);
          }
        }}
        onRemove={(keys: readonly string[]) => {
          events.push(['remove', ...keys]);
          if (accept) {
            added.value = new Set([...added.value].filter(key => !keys.includes(key)));
          }
        }}
        onLocate={(key: string) => events.push(['locate', key])}
        onMenu={(key: string) => events.push(['menu', key])}
      />
    )),
    { attachTo: document.body }
  );
  const row = (key: string) => wrapper.get(`[data-catalog-node="${key}"]`);
  // 行尾一列现在显示的：操作按钮（add、remove）、勾（added）
  const endOf = (key: string) => {
    const action = row(key).find('[data-node-action]');
    if (action.exists()) {
      return action.attributes('data-node-action');
    }
    return row(key).find('[data-added-mark]').exists() ? 'added' : 'empty';
  };
  const flashing = (key: string) => row(key).classes().some(name => name.includes('acted'));
  const announcement = () => wrapper.get('[data-catalog-announcement]').text();
  return { wrapper, selection, expanded, events, row, endOf, flashing, announcement };
}

const selectedKeys = (selection: CatalogSelection) => [...selection.keys];

afterEach(() => {
  vi.useRealTimers();
});

describe('CatalogTree', () => {
  it('单击只选这一项，Ctrl 单击加选或取消，Shift 单击从起点连选（只连项）；选中的项标出 aria-selected', async () => {
    const { selection, row } = mountTree();

    await row('a').trigger('click');
    await row('c').trigger('click', { ctrlKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'c']);
    expect(row('c').attributes('aria-selected')).toBe('true');

    await row('c').trigger('click', { ctrlKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);

    // 连选从最后一次单选或加选的那一项开始，中间的分类不算
    await row('a').trigger('click');
    await row('c').trigger('click', { shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b', 'c']);
  });

  it('分类不能选中（用户 2026-11-15）：单击是展开、收起，选中不变；双击已添加的项是定位，没添加的什么也不做', async () => {
    const { selection, events, expanded, row } = mountTree();
    await row('a').trigger('click');

    await row('water').trigger('click');
    expect(expanded.value.has('water')).toBe(false);
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);
    expect(row('water').attributes('aria-selected')).toBeUndefined();
    await row('water').trigger('click');
    expect(expanded.value.has('water')).toBe(true);

    await row('a').trigger('dblclick');
    await row('b').trigger('dblclick');
    expect(events).toStrictEqual([['locate', 'a']]);
  });

  it('行尾一列（用户 2026-11-15）：分类是项数，已添加的项是勾，两者在同一列', () => {
    const { row } = mountTree();
    const mark = row('a').get('[data-added-mark]').element.parentElement;
    const count = row('land')
      .findAll('span')
      .find(item => item.text() === '2' && item.element.children.length === 0)?.element.parentElement;
    expect(mark?.className).toBeTruthy();
    expect(count?.className).toBe(mark?.className);
    expect(row('b').find('[data-added-mark]').exists()).toBe(false);
  });

  it('已添加的行尾是勾；行尾的按钮只作用于这一行：项是添加或移除，分类是添加下面还没加的', async () => {
    const { events, row } = mountTree();

    expect(row('a').find('[data-added-mark]').exists()).toBe(true);
    expect(row('b').find('[data-added-mark]').exists()).toBe(false);
    await row('a').get('[data-node-action="remove"]').trigger('click');
    await row('b').get('[data-node-action="add"]').trigger('click');
    await row('land').get('[data-node-action="add"]').trigger('click');

    expect(events).toStrictEqual([['remove', 'a'], ['add', 'b'], ['add', 'b']]);
  });

  it('键盘：上下移动，到项上选中、到分类上只移焦点；Insert 添加、Delete 移除选中里能做的，焦点在分类上时作用于它下面的项', async () => {
    const { selection, expanded, events, row } = mountTree();

    await row('land').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);
    await row('a').trigger('keydown', { key: 'ArrowDown', shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    await row('b').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    expect(selection.value.focus).toBe('water');
    await row('water').trigger('keydown', { key: ' ' });
    expect(expanded.value.has('water')).toBe(false);

    await row('b').trigger('keydown', { key: 'Insert' });
    await row('b').trigger('keydown', { key: 'Delete' });
    await row('land').trigger('keydown', { key: 'Delete' });
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'a'], ['remove', 'a']]);
  });

  it('右键不在选中里的行：先只选它再报菜单；在选中里时保留多选', async () => {
    const { selection, events, row } = mountTree();
    await row('a').trigger('click');
    await row('b').trigger('click', { ctrlKey: true });

    await row('a').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    await row('c').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['c']);
    // 右键分类不改选中
    await row('land').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['c']);
    expect(events).toStrictEqual([['menu', 'a'], ['menu', 'c'], ['menu', 'land']]);
  });

  it('点完行尾的操作停在结果上（用户 2026-11-22）：鼠标离开这一行以前是勾、不换成移除，离开以后才是移除', async () => {
    const { events, row, endOf } = mountTree({ accept: true });

    await row('b').get('[data-node-action="add"]').trigger('click');
    await flushPromises();
    expect(endOf('b')).toBe('added');
    // 触屏的离开不算：手指抬起就有，等到闪完
    await row('b').trigger('pointerleave', { pointerType: 'touch' });
    expect(endOf('b')).toBe('added');

    await row('b').trigger('pointerleave', { pointerType: 'mouse' });
    expect(endOf('b')).toBe('remove');
    await row('b').get('[data-node-action="remove"]').trigger('click');
    await flushPromises();
    expect(endOf('b')).toBe('empty');
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'b']]);
  });

  it('双击行尾的添加只加一次：第二下落在结果上，不会加了又删，也不选中、不定位', async () => {
    const { events, selection, row, endOf } = mountTree({ accept: true });

    await row('b').get('[data-node-action="add"]').trigger('click');
    await flushPromises();
    // 第二下落在原来按钮的位置：现在只有勾
    expect(row('b').find('[data-node-action]').exists()).toBe(false);
    const end = row('b').get('[data-added-mark]');
    await end.trigger('click');
    await end.trigger('dblclick');
    await flushPromises();

    expect(events).toStrictEqual([['add', 'b']]);
    expect(selectedKeys(selection.value)).toStrictEqual([]);
    expect(endOf('b')).toBe('added');
  });

  it('触屏点完停到闪完（0.9 秒），之后换成相反的操作', async () => {
    vi.useFakeTimers();
    const { row, endOf } = mountTree({ accept: true });

    const button = row('b').get('[data-node-action="add"]');
    await button.trigger('pointerdown', { pointerType: 'touch' });
    await button.trigger('click');
    await flushPromises();
    expect(endOf('b')).toBe('added');

    await vi.advanceTimersByTimeAsync(899);
    expect(endOf('b')).toBe('added');
    await vi.advanceTimersByTimeAsync(1);
    expect(endOf('b')).toBe('remove');
  });

  it('操作过的行闪 0.9 秒、读屏播报；操作分类时分类和变了的项一起闪，播报项数', async () => {
    vi.useFakeTimers();
    const { row, flashing, announcement } = mountTree({ accept: true });

    await row('b').get('[data-node-action="add"]').trigger('click');
    await flushPromises();
    expect(flashing('b')).toBe(true);
    expect(flashing('a')).toBe(false);
    expect(announcement()).toBe('已添加 b');
    await vi.advanceTimersByTimeAsync(900);
    expect(flashing('b')).toBe(false);

    await row('land').get('[data-node-action="remove"]').trigger('click');
    await flushPromises();
    expect(['land', 'a', 'b', 'c'].filter(flashing)).toStrictEqual(['land', 'a', 'b']);
    expect(announcement()).toBe('已移除 2 项');
  });

  it('页面没有接受的添加不闪、不播报，行尾显示的仍是实际的状态', async () => {
    const { events, row, endOf, flashing, announcement } = mountTree();

    await row('b').get('[data-node-action="add"]').trigger('click');
    await flushPromises();

    expect(events).toStrictEqual([['add', 'b']]);
    expect(flashing('b')).toBe(false);
    expect(announcement()).toBe('');
    expect(endOf('b')).toBe('empty');
  });

  it('Insert、Delete 也停在结果上，焦点离开这一行才换回操作；每次播报先清空再写，同一句话也能再读一遍', async () => {
    const { wrapper, row, endOf, announcement } = mountTree({ accept: true });
    await row('b').trigger('click');

    await row('b').trigger('keydown', { key: 'Insert' });
    await flushPromises();
    expect(endOf('b')).toBe('added');
    expect(announcement()).toBe('已添加 b');
    // 焦点在行里移动不算离开
    await row('b').trigger('focusout', { relatedTarget: row('b').get('span').element });
    expect(endOf('b')).toBe('added');
    await row('b').trigger('focusout', { relatedTarget: null });
    expect(endOf('b')).toBe('remove');

    const live = wrapper.get('[data-catalog-announcement]').element;
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(live.textContent ?? ''));
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    await row('b').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    observer.disconnect();
    expect(texts).toStrictEqual(['', '已移除 b']);
  });
});
