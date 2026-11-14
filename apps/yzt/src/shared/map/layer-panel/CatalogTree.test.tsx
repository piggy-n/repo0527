import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
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

// 国土变更（a 已加入、b）、水资源（c）
const NODES: CatalogNode[] = [
  { kind: 'branch', key: 'land', label: '国土变更', children: [leaf('a', true), leaf('b')] },
  { kind: 'branch', key: 'water', label: '水资源', children: [leaf('c')] }
];

// 选中和展开像页面一样由外面持有；记下目录树报告的添加、移除、定位和菜单
function mountTree() {
  const selection = ref<CatalogSelection>(EMPTY_CATALOG_SELECTION);
  const expanded = ref<ReadonlySet<string>>(new Set(['land', 'water']));
  const events: unknown[][] = [];
  const wrapper = mount(
    defineComponent(() => () => (
      <CatalogTree
        nodes={NODES}
        expanded={expanded.value}
        selection={selection.value}
        label="资源目录"
        onUpdate:selection={(next: CatalogSelection) => (selection.value = next)}
        onUpdate:expanded={(next: ReadonlySet<string>) => (expanded.value = next)}
        onAdd={(keys: readonly string[]) => events.push(['add', ...keys])}
        onRemove={(keys: readonly string[]) => events.push(['remove', ...keys])}
        onLocate={(key: string) => events.push(['locate', key])}
        onMenu={(key: string) => events.push(['menu', key])}
      />
    )),
    { attachTo: document.body }
  );
  const row = (key: string) => wrapper.get(`[data-catalog-node="${key}"]`);
  return { wrapper, selection, expanded, events, row };
}

const selectedKeys = (selection: CatalogSelection) => [...selection.keys];

describe('CatalogTree', () => {
  it('单击只选这一行，Ctrl 单击加选或取消，Shift 单击从起点连选；选中的行标出 aria-selected', async () => {
    const { selection, row } = mountTree();

    await row('a').trigger('click');
    await row('c').trigger('click', { ctrlKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'c']);
    expect(row('c').attributes('aria-selected')).toBe('true');

    await row('c').trigger('click', { ctrlKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);

    // 连选从最后一次单选或加选的那一行开始
    await row('a').trigger('click');
    await row('water').trigger('click', { shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b', 'water']);
  });

  it('双击已添加的项是定位，没添加的什么也不做；双击分类是展开、收起（用户 2026-11-14）', async () => {
    const { events, expanded, row } = mountTree();

    await row('a').trigger('dblclick');
    await row('b').trigger('dblclick');
    expect(events).toStrictEqual([['locate', 'a']]);

    await row('water').trigger('dblclick');
    expect(expanded.value.has('water')).toBe(false);
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

  it('键盘：上下移动并选中，Insert 添加、Delete 移除选中里能做的，已加入的不重复', async () => {
    const { selection, events, row } = mountTree();
    await row('land').trigger('click');

    await row('land').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);
    await row('a').trigger('keydown', { key: 'ArrowDown', shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);

    await row('b').trigger('keydown', { key: 'Insert' });
    await row('b').trigger('keydown', { key: 'Delete' });
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'a']]);
  });

  it('右键不在选中里的行：先只选它再报菜单；在选中里时保留多选', async () => {
    const { selection, events, row } = mountTree();
    await row('a').trigger('click');
    await row('b').trigger('click', { ctrlKey: true });

    await row('a').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    await row('c').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['c']);
    expect(events).toStrictEqual([['menu', 'a'], ['menu', 'c']]);
  });
});
