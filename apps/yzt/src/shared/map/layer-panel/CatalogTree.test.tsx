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
  // 项的行尾：悬停时预告的（add、remove）；点完停留时没有预告，是结果（added 是勾、empty 是空）
  const endOf = (key: string) => {
    const hint = row(key).find('[data-node-hint]');
    if (hint.exists()) {
      return hint.attributes('data-node-hint');
    }
    return row(key).find('[data-added-mark]').exists() ? 'added' : 'empty';
  };
  const flashing = (key: string) => row(key).classes().some(name => name.includes('acted'));
  const announcement = () => wrapper.get('[data-catalog-announcement]').text();
  return { wrapper, selection, expanded, events, row, endOf, flashing, announcement };
}

const selectedKeys = (selection: CatalogSelection) => [...selection.keys];

// 双击的第二下：detail 由浏览器按系统的双击间隔给出，test-utils 的 trigger 设不了
const doubleClickSecond = async (element: Element) => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
  await flushPromises();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('CatalogTree', () => {
  it('单击项是添加或移除（用户 2026-11-22），多选随之清空；Ctrl 单击加选或取消，Shift 单击从起点连选（只连项），都不添加、不移除', async () => {
    const { selection, events, row } = mountTree();

    await row('b').trigger('click');
    await row('a').trigger('click');
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'a']]);

    await row('b').trigger('click', { ctrlKey: true });
    await row('c').trigger('click', { metaKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['b', 'c']);
    expect(row('c').attributes('aria-selected')).toBe('true');
    await row('c').trigger('click', { ctrlKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['b']);

    // 单击清空多选，连选从刚单击的项开始，中间的分类不算
    await row('a').trigger('click');
    expect(selectedKeys(selection.value)).toStrictEqual([]);
    await row('c').trigger('click', { shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b', 'c']);
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'a'], ['remove', 'a']]);
  });

  it('分类不能选中（用户 2026-11-15）：单击是展开、收起，选中不变；双击不再定位', async () => {
    const { selection, events, expanded, row } = mountTree();
    await row('a').trigger('click', { ctrlKey: true });

    await row('water').trigger('click');
    expect(expanded.value.has('water')).toBe(false);
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);
    expect(row('water').attributes('aria-selected')).toBeUndefined();
    await row('water').trigger('click');
    expect(expanded.value.has('water')).toBe(true);

    await row('a').trigger('dblclick');
    expect(events).toStrictEqual([]);
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

  it('项的行尾只是图形：已添加的是勾、预告叉，没添加的预告加号，"已添加"写成文字；分类的按钮添加下面还没加的', async () => {
    const { events, row, endOf } = mountTree();

    expect(row('a').find('[data-added-mark]').exists()).toBe(true);
    expect(endOf('a')).toBe('remove');
    expect(endOf('b')).toBe('add');
    expect(row('a').find('[data-node-hint]').element.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(row('a').find('button').exists()).toBe(false);
    expect(row('a').text()).toContain('已添加');
    expect(row('b').text()).not.toContain('已添加');

    await row('land').get('[data-node-action="add"]').trigger('click');
    expect(events).toStrictEqual([['add', 'b']]);
  });

  it('点完停在结果上（用户 2026-11-22）：离开这一行以前显示结果、再点无效，双击、三击的后几下也不切换；离开以后才预告相反的操作', async () => {
    const { events, row, endOf } = mountTree({ accept: true });

    await row('b').trigger('click');
    await flushPromises();
    expect(endOf('b')).toBe('added');
    expect(row('b').classes().some(name => name.includes('held'))).toBe(true);
    await doubleClickSecond(row('b').element);
    await row('b').trigger('click');
    // 触屏的离开不算：手指抬起就有，等到闪完
    await row('b').trigger('pointerleave', { pointerType: 'touch' });
    await row('b').trigger('click');
    await flushPromises();
    expect(events).toStrictEqual([['add', 'b']]);
    expect(endOf('b')).toBe('added');

    await row('b').trigger('pointerleave', { pointerType: 'mouse' });
    expect(endOf('b')).toBe('remove');
    // 两下之间越过了行的边界、停留已经放开时，按系统双击间隔算的第二下照样不切换
    await doubleClickSecond(row('b').element);
    expect(events).toStrictEqual([['add', 'b']]);
    await row('b').trigger('click');
    await flushPromises();
    expect(endOf('b')).toBe('empty');
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'b']]);
  });

  it('页面没有接受的切换不停留、不闪、不播报，行尾仍预告原来的操作，再点照样报告', async () => {
    const { events, row, endOf, flashing, announcement } = mountTree();

    await row('b').trigger('click');
    await flushPromises();
    expect(flashing('b')).toBe(false);
    expect(announcement()).toBe('');
    expect(endOf('b')).toBe('add');

    await row('b').trigger('click');
    expect(events).toStrictEqual([['add', 'b'], ['add', 'b']]);
  });

  it('触屏点完停到闪完（0.9 秒），之后换成相反的操作', async () => {
    vi.useFakeTimers();
    const { row, endOf } = mountTree({ accept: true });

    await row('b').trigger('pointerdown', { pointerType: 'touch' });
    await row('b').trigger('click');
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

    await row('b').trigger('click');
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

  it('分类的按钮点完停在结果上：按钮不见了，双击的第二下落在这一列上不展开、不收起；停留放开以后第二下落在新按钮上也不操作', async () => {
    const { events, expanded, row } = mountTree({ accept: true });

    await row('land').get('[data-node-action="add"]').trigger('click');
    await flushPromises();
    expect(row('land').find('[data-node-action]').exists()).toBe(false);
    await row('land').get('[class*="end"]').trigger('click');
    expect(expanded.value.has('land')).toBe(true);
    expect(events).toStrictEqual([['add', 'b']]);

    // 两下之间指针出了这一行：按钮回来、换成移除，按系统双击间隔的第二下不移除整类
    await row('land').trigger('pointerleave', { pointerType: 'mouse' });
    const remove = row('land').get('[data-node-action="remove"]');
    await doubleClickSecond(remove.element);
    expect(events).toStrictEqual([['add', 'b']]);
    await remove.trigger('click');
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'a', 'b']]);
  });

  it('还在闪时这一行又变了：换一个同样的动画，从头再闪一次', async () => {
    vi.useFakeTimers();
    const { row } = mountTree({ accept: true });
    const flashClass = () => row('b').classes().find(name => name.includes('acted'));

    await row('b').trigger('keydown', { key: ' ' });
    await flushPromises();
    const first = flashClass();
    await vi.advanceTimersByTimeAsync(300);
    await row('b').trigger('keydown', { key: ' ' });
    await flushPromises();
    const second = flashClass();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    // 第一次的计时到了不提前去掉，从第二次起算 0.9 秒
    await vi.advanceTimersByTimeAsync(600);
    expect(flashClass()).toBe(second);
    await vi.advanceTimersByTimeAsync(300);
    expect(flashClass()).toBeUndefined();
  });

  it('键盘：上下只移焦点，Shift 加上下连选；空格切换（按住的重复不算），Ctrl、⌘ 加空格加选，Shift 加空格连选；回车定位已添加的；Esc 清空多选', async () => {
    const { selection, expanded, events, row } = mountTree();

    await row('land').trigger('keydown', { key: 'ArrowDown' });
    expect(selection.value).toMatchObject({ focus: 'a', anchor: 'a' });
    expect(selectedKeys(selection.value)).toStrictEqual([]);
    await row('a').trigger('keydown', { key: 'ArrowDown', shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    await row('b').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    expect(selection.value.focus).toBe('water');
    await row('water').trigger('keydown', { key: ' ' });
    expect(expanded.value.has('water')).toBe(false);

    await row('b').trigger('keydown', { key: 'Escape' });
    expect(selectedKeys(selection.value)).toStrictEqual([]);

    await row('b').trigger('keydown', { key: ' ' });
    await row('b').trigger('keydown', { key: ' ', repeat: true });
    await row('a').trigger('keydown', { key: ' ', ctrlKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);
    await row('a').trigger('keydown', { key: ' ', metaKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual([]);
    // Shift 加空格从起点（刚加选的 a）连选到这一项，只改选中
    await row('b').trigger('keydown', { key: ' ', shiftKey: true });
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    await row('a').trigger('keydown', { key: 'Enter' });
    await row('b').trigger('keydown', { key: 'Enter' });
    expect(events).toStrictEqual([['add', 'b'], ['locate', 'a']]);
  });

  it('Insert、Delete：项在多选里时作用于整个选中能做的，否则只作用于这一项；焦点在分类上时作用于它下面的项', async () => {
    const { events, row } = mountTree();

    await row('b').trigger('keydown', { key: 'Insert' });
    await row('c').trigger('keydown', { key: 'Delete' });
    await row('a').trigger('click', { ctrlKey: true });
    await row('b').trigger('click', { ctrlKey: true });
    await row('b').trigger('keydown', { key: 'Delete' });
    await row('c').trigger('keydown', { key: 'Insert' });
    await row('land').trigger('keydown', { key: 'Delete' });
    expect(events).toStrictEqual([['add', 'b'], ['remove', 'a'], ['add', 'c'], ['remove', 'a']]);
  });

  it('右键多选里的项保留多选；右键别的项清空多选再报菜单；右键分类不改选中', async () => {
    const { selection, events, row } = mountTree();
    await row('a').trigger('click', { ctrlKey: true });
    await row('b').trigger('click', { ctrlKey: true });

    await row('a').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['a', 'b']);
    await row('c').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual([]);
    expect(selection.value.focus).toBe('c');
    await row('a').trigger('click', { ctrlKey: true });
    await row('land').trigger('contextmenu');
    expect(selectedKeys(selection.value)).toStrictEqual(['a']);
    expect(events).toStrictEqual([['menu', 'a'], ['menu', 'c'], ['menu', 'land']]);
  });

  it('按住 Ctrl、⌘、Shift 时不预告（单击是选中）；最后一次是手指时不留悬停的状态色', async () => {
    const { wrapper, row } = mountTree();
    const root = () => wrapper.get('[role="tree"]').element.parentElement;
    const hasClass = (name: string) => [...(root()?.classList ?? [])].some(item => item.includes(name));

    // 按下时有、松开后没有
    const pressAndRelease = async (key: string, init: KeyboardEventInit) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
      await flushPromises();
      const pressed = hasClass('modifying');
      document.dispatchEvent(new KeyboardEvent('keyup', { key }));
      await flushPromises();
      return [pressed, hasClass('modifying')];
    };
    expect(await pressAndRelease('Control', { ctrlKey: true })).toStrictEqual([true, false]);
    expect(await pressAndRelease('Meta', { metaKey: true })).toStrictEqual([true, false]);
    expect(await pressAndRelease('Shift', { shiftKey: true })).toStrictEqual([true, false]);

    // 按着修饰键切走窗口、收不到松开：回来移动鼠标就更正
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    await flushPromises();
    document.dispatchEvent(new MouseEvent('mousemove'));
    await flushPromises();
    expect(hasClass('modifying')).toBe(false);

    await row('a').trigger('pointerover', { pointerType: 'touch' });
    expect(hasClass('touch')).toBe(true);
    await row('a').trigger('pointerover', { pointerType: 'mouse' });
    expect(hasClass('touch')).toBe(false);
  });

  it('Insert、Delete 也停在结果上，焦点离开这一行才换回预告；每次播报先清空再写，同一句话也能再读一遍', async () => {
    const { wrapper, row, endOf, announcement } = mountTree({ accept: true });

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
