import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, KeepAlive, nextTick, ref } from 'vue';
import { LayerPopover } from './LayerPopover';

// 浮层放在 KeepAlive 里（同漫游时被缓存的面板），箭头对着页面上的一个按钮；关闭的次数由用例看
function mountPopover() {
  const shown = ref(true);
  const open = ref(true);
  const anchor = document.body.appendChild(document.createElement('button'));
  let closes = 0;
  const Inner = defineComponent({
    name: 'PopoverHost',
    setup: () => () => (
      <LayerPopover
        open={open.value}
        panel={() => document.body}
        list={() => document.body}
        anchor={() => anchor}
        label="图例"
        onClose={() => closes++}
      >
        {{
          header: () => [
            <button type="button" data-close>
              关闭
            </button>
          ],
          default: () => [<div>内容</div>]
        }}
      </LayerPopover>
    )
  });
  const wrapper = mount(
    defineComponent(() => () => <KeepAlive>{shown.value ? <Inner /> : null}</KeepAlive>),
    { attachTo: document.body }
  );
  return { wrapper, shown, open, anchor, closes: () => closes };
}

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('LayerPopover', () => {
  it('Esc 关闭；所在的面板停用时（漫游时被缓存）不响应，退出漫游时按的 Esc 不会顺带关掉它（2026-11-15 审查发现）', async () => {
    const { shown, closes } = mountPopover();
    shown.value = false;
    await nextTick();
    pressEscape();
    expect(closes()).toBe(0);

    shown.value = true;
    await nextTick();
    pressEscape();
    expect(closes()).toBe(1);
  });

  it('焦点在浮层里时关掉，焦点还给箭头对着的元素；焦点在别处时不动（2026-11-15 审查发现）', async () => {
    const { wrapper, open, anchor } = mountPopover();
    wrapper.get<HTMLButtonElement>('[data-close]').element.focus();
    open.value = false;
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(anchor);

    const elsewhere = document.body.appendChild(document.createElement('input'));
    open.value = true;
    await nextTick();
    elsewhere.focus();
    open.value = false;
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(elsewhere);
  });
});
