import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { CurrentLayerList } from './CurrentLayerList';

// 行的内容像各 feature 一样放在插槽里：名称和一个按钮；c 是变淡的行（像二维里的模型）
function mountList(note?: string) {
  const selected = ref<string | null>('b');
  const visible = ref<ReadonlySet<string>>(new Set(['a', 'b']));
  const events: unknown[][] = [];
  const wrapper = mount(
    defineComponent(() => () => (
      <CurrentLayerList
        label="图层"
        keys={['a', 'b', 'c']}
        selected={selected.value}
        tabbable={selected.value}
        visibleOf={key => visible.value.has(key)}
        nameOf={key => key.toUpperCase()}
        dimmedOf={key => key === 'c'}
        note={note}
        dragTip="拖动调整叠放顺序"
        onSelect={(key: string) => {
          selected.value = key;
          events.push(['select', key]);
        }}
        onStep={(key: string, delta: number) => events.push(['step', key, delta])}
        onVisible={(key: string, value: boolean) => events.push(['visible', key, value])}
        onMove={(key: string, to: number) => events.push(['move', key, to])}
        onActivate={(key: string) => events.push(['activate', key])}
        onRemove={(key: string) => events.push(['remove', key])}
      >
        {{
          row: ({ key }: { key: string }) => [
            <span data-row-text data-row-dim>
              {key}
            </span>,
            <button type="button" data-inner={key}>
              内部按钮
            </button>
          ]
        }}
      </CurrentLayerList>
    ))
  );
  const row = (key: string) => wrapper.get(`[data-current-row="${key}"]`);
  return { wrapper, events, row };
}

describe('CurrentLayerList', () => {
  it('点行选中，点行里的按钮不改选中；双击是定位；隐藏的行、变淡的行标出来', async () => {
    const { events, row } = mountList();

    await row('a').get('[data-row-text]').trigger('click');
    await row('c').get('[data-inner]').trigger('click');
    await row('c').get('[data-row-text]').trigger('dblclick');

    expect(events).toStrictEqual([['select', 'a'], ['activate', 'c']]);
    expect(row('a').attributes('aria-selected')).toBe('true');
    expect(row('c').classes().some(name => name.includes('off'))).toBe(true);
    expect(row('c').classes().some(name => name.includes('dimmed'))).toBe(true);
    expect(row('a').classes().some(name => name.includes('dimmed'))).toBe(false);
  });

  it('键盘：上下换行交给页面，Alt 加上下移动，空格切换显隐，回车定位，Delete 移除', async () => {
    const { events, row } = mountList();

    await row('b').trigger('keydown', { key: 'ArrowDown' });
    await row('b').trigger('keydown', { key: 'ArrowUp', altKey: true });
    await row('b').trigger('keydown', { key: ' ' });
    await row('b').trigger('keydown', { key: 'Enter' });
    await row('b').trigger('keydown', { key: 'Delete' });
    // 已经在最上面的不能再往上
    await row('a').trigger('keydown', { key: 'ArrowUp', altKey: true });

    expect(events).toStrictEqual([
      ['step', 'b', 1],
      ['move', 'b', 0],
      ['visible', 'b', false],
      ['activate', 'b'],
      ['remove', 'b']
    ]);
  });

  it('手柄上按上下方向键：选中这一行并移动一位，到头时不动', async () => {
    const { events, row } = mountList();

    await row('c').get('[data-drag-handle]').trigger('keydown', { key: 'ArrowUp' });
    await row('c').get('[data-drag-handle]').trigger('keydown', { key: 'ArrowDown' });

    expect(events).toStrictEqual([['select', 'c'], ['move', 'c', 1]]);
  });

  it('列表上面的一行说明只在给了时出现', () => {
    expect(mountList().wrapper.find('[data-list-note]').exists()).toBe(false);
    expect(mountList('切换到三维后显示').wrapper.get('[data-list-note]').text()).toBe('切换到三维后显示');
  });

  it('Alt 加上下移动以后焦点还在这一行，可以接着移动（2026-11-14 审查发现）', async () => {
    const keys = ref(['a', 'b', 'c']);
    const wrapper = mount(
      defineComponent(() => () => (
        <CurrentLayerList
          label="图层"
          keys={keys.value}
          selected="c"
          tabbable="c"
          visibleOf={() => true}
          nameOf={key => key}
          dragTip="拖动调整叠放顺序"
          onMove={(key: string, to: number) => {
            keys.value = keys.value.filter(item => item !== key).toSpliced(to, 0, key);
          }}
        >
          {{ row: ({ key }: { key: string }) => [<span data-row-text>{key}</span>] }}
        </CurrentLayerList>
      )),
      { attachTo: document.body }
    );
    const row = () => wrapper.get<HTMLElement>('[data-current-row="c"]');
    row().element.focus();

    await row().trigger('keydown', { key: 'ArrowUp', altKey: true });
    await nextTick();
    expect(keys.value).toStrictEqual(['a', 'c', 'b']);
    expect(document.activeElement).toBe(row().element);
    await row().trigger('keydown', { key: 'ArrowUp', altKey: true });
    await nextTick();
    expect(keys.value).toStrictEqual(['c', 'a', 'b']);
    expect(document.activeElement).toBe(row().element);
  });
});
