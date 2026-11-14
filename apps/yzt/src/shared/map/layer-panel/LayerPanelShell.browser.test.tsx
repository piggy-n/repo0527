import 'element-plus/dist/index.css';
import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, KeepAlive, nextTick, type Ref, ref } from 'vue';
import { LayerPanelShell } from './LayerPanelShell';

// 真实的布局（ADR 0040）：面板的高度、分割线的位置都靠量尺寸，jsdom 里元素的尺寸都是 0，只能在浏览器里验证。
// 2026-11-14 从旧资源图层面板的浏览器测试移来（ADR 0157），内容换成固定高度的行

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 用到的令牌由 app 的样式给出，这里直接写出
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--space-xl': '24px',
  '--font-size-xs': '12px',
  '--font-size-base': '14px',
  '--font-size-lg': '16px',
  '--line-height-tag': '16px',
  '--line-height-base': '22px'
};

// n 行、每行 32 高的内容
const rows = (n: number) => Array.from({ length: n }, (_, index) => h('div', { key: index, style: { height: '32px' } }));

/**
 * 和面板所在的地图页一样：一个纵向 flex 的列，列的高度就是面板最高能到的高度。目录 catalog 行、当前图层 current 行；
 * 分割线的位置由页面持有，按面板发出的事件改。给出 shown 时放在 KeepAlive 里，为 false 时停用
 */
function setup(height: number, catalog: number, current: number, shown?: Ref<boolean>) {
  const host = document.body.appendChild(document.createElement('div'));
  // 尺寸监听的回调改了比被监听元素浅的元素时，浏览器报"ResizeObserver loop completed with undelivered notifications"
  const loopErrors: string[] = [];
  const onError = (event: ErrorEvent) => {
    if (event.message.includes('ResizeObserver')) {
      loopErrors.push(event.message);
    }
  };
  window.addEventListener('error', onError);
  const ratio = ref(0.4);
  const Page = defineComponent({
    name: 'ShellPage',
    setup() {
      provideMap({ groups: [], camera: CAMERA });
      return () => (
        <div
          data-column
          style={{ display: 'flex', flexDirection: 'column', width: '320px', height: `${height}px`, ...TOKENS }}
        >
          <LayerPanelShell
            title="资源图层"
            tabs={[{ id: 'core', label: '主节点' }]}
            ratio={ratio.value}
            onUpdate:ratio={(value: number) => (ratio.value = value)}
          >
            {{
              catalogTools: () => [],
              catalogFilter: () => [h('div', { style: { height: '32px' } })],
              catalog: () => rows(catalog),
              currentTools: () => [],
              current: () => rows(current),
              floating: () => []
            }}
          </LayerPanelShell>
        </div>
      );
    }
  });
  const wrapper = mount(
    shown ? defineComponent(() => () => <KeepAlive>{shown.value ? <Page /> : null}</KeepAlive>) : Page,
    { attachTo: host }
  );
  const column = host.querySelector('[data-column]');
  if (!(column instanceof HTMLElement)) {
    throw new Error('没有找到面板所在的列');
  }
  return {
    wrapper,
    ratio,
    column,
    loopErrors,
    [Symbol.dispose]() {
      window.removeEventListener('error', onError);
      wrapper.unmount();
      host.remove();
    }
  };
}

// 等若干个动画帧：尺寸监听的回调在帧里
function frames(count: number): Promise<void> {
  return new Promise(resolve => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}

// 一段的滚动区放不下内容
function overflows(section: Element): boolean {
  const scroll = section.lastElementChild;
  return scroll instanceof HTMLElement && scroll.scrollHeight > scroll.clientHeight;
}

// 目录、分割线、当前图层三块的位置，面板的高度，两段的滚动区是否放不下
function areas(wrapper: VueWrapper) {
  const separator = wrapper.get('[role="separator"]').element;
  const catalog = wrapper.get('[data-panel-section="catalog"]').element;
  const current = wrapper.get('[data-panel-section="current"]').element;
  const panel = wrapper.get('[data-layer-panel]').element;
  if (!(separator instanceof HTMLElement)) {
    throw new Error('没有找到分割线');
  }
  return {
    separator,
    splitterTop: separator.getBoundingClientRect().top,
    catalog: catalog.getBoundingClientRect().height,
    current: current.getBoundingClientRect().height,
    panel: panel.getBoundingClientRect().height,
    catalogOverflows: overflows(catalog),
    currentOverflows: overflows(current)
  };
}

// 按住分割线的中间往下拖 distance（负数往上），松开
function drag(separator: HTMLElement, distance: number) {
  const { left, top, width } = separator.getBoundingClientRect();
  const init = { bubbles: true, pointerId: 1, isPrimary: true, clientX: left + width / 2 };
  separator.dispatchEvent(new PointerEvent('pointerdown', { ...init, button: 0, buttons: 1, clientY: top + 12 }));
  separator.dispatchEvent(new PointerEvent('pointermove', { ...init, buttons: 1, clientY: top + 12 + distance / 2 }));
  separator.dispatchEvent(new PointerEvent('pointermove', { ...init, buttons: 1, clientY: top + 12 + distance }));
  separator.dispatchEvent(new PointerEvent('pointerup', { ...init, button: 0, clientY: top + 12 + distance }));
}

describe('LayerPanelShell（真实的布局）', () => {
  it('都放得下时按内容：面板跟着变矮，两段都不滚动，分割线不能调整', async () => {
    using ctx = setup(700, 3, 2);
    await frames(6);

    const shown = areas(ctx.wrapper);
    expect(shown.panel).toBeLessThan(700);
    expect([shown.catalogOverflows, shown.currentOverflows]).toStrictEqual([false, false]);
    expect(shown.separator.getAttribute('aria-disabled')).toBe('true');
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it('放不下时面板占满所在的列，按比例分，两段各自滚动；列变矮、变高时跟着变', async () => {
    using ctx = setup(500, 30, 20);
    await frames(6);
    const full = areas(ctx.wrapper);
    expect(full.panel).toBeCloseTo(500, 0);
    expect([full.catalogOverflows, full.currentOverflows]).toStrictEqual([true, true]);

    ctx.column.style.height = '400px';
    await frames(3);
    expect(areas(ctx.wrapper).panel).toBeCloseTo(400, 0);
    ctx.column.style.height = '600px';
    await frames(3);
    expect(areas(ctx.wrapper).panel).toBeCloseTo(600, 0);
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it('拖动分割线：线跟着指针走，到两边的最小高度为止，松开后比例交给页面', async () => {
    using ctx = setup(600, 30, 20);
    await frames(4);
    const before = areas(ctx.wrapper);

    drag(before.separator, -60);
    await frames(3);
    const up = areas(ctx.wrapper);
    expect(up.splitterTop).toBeCloseTo(before.splitterTop - 60, 0);
    expect(up.current).toBeCloseTo(before.current + 60, 0);
    expect(up.catalog + up.current).toBeCloseTo(before.catalog + before.current, 0);
    expect(ctx.ratio.value).toBeGreaterThan(0.4);

    // 当前图层最少一个标题加两行，目录最少标题、搜索行加三行（panel-split.ts）
    drag(up.separator, 1000);
    await frames(3);
    expect(areas(ctx.wrapper).current).toBeCloseTo(40 + 2 * 36, 0);
    drag(up.separator, -1000);
    await frames(3);
    expect(areas(ctx.wrapper).catalog).toBeCloseTo(40 + 40 + 3 * 32, 0);
    expect(areas(ctx.wrapper).panel).toBeCloseTo(600, 0);
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it('分割线上按方向键：往上一步当前图层高可用高度的 5%', async () => {
    using ctx = setup(600, 30, 20);
    await frames(4);
    const before = areas(ctx.wrapper);
    const available = before.catalog + before.current;

    before.separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await frames(3);
    expect(areas(ctx.wrapper).current).toBeCloseTo(before.current + available * 0.05, 0);
    before.separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await frames(3);
    expect(areas(ctx.wrapper).current).toBeCloseTo(before.current, 0);
  });

  it.each(['lostpointercapture', 'deactivated', 'buttons'] as const)(
    '拖动在 %s 时结束，之后经过分割线不再改变高度',
    async reason => {
      const shown = ref(true);
      using ctx = setup(600, 30, 20, shown);
      await frames(4);
      const { separator } = areas(ctx.wrapper);
      const { left, top } = separator.getBoundingClientRect();
      const init = { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: left + 10, clientY: top + 12 };
      separator.dispatchEvent(new PointerEvent('pointerdown', init));
      separator.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: top - 30 }));
      await nextTick();
      expect(ctx.ratio.value).not.toBe(0.4);
      const stopped = ctx.ratio.value;

      if (reason === 'deactivated') {
        shown.value = false;
        await nextTick();
        shown.value = true;
        await nextTick();
      } else if (reason === 'lostpointercapture') {
        separator.dispatchEvent(new PointerEvent('lostpointercapture', init));
      } else {
        separator.dispatchEvent(new PointerEvent('pointermove', { ...init, buttons: 0, clientY: top - 60 }));
      }
      // 即使随后又按着左键经过，旧的拖动也不能恢复
      separator.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: top - 80 }));
      await nextTick();
      expect(ctx.ratio.value).toBe(stopped);
    }
  );

  it('所在页面被缓存：停用期间量到的 0 不采用，再次激活的那一刻两段的高度和停用前一样（ADR 0063）', async () => {
    const shown = ref(true);
    using ctx = setup(400, 30, 20, shown);
    await frames(3);
    const before = areas(ctx.wrapper);

    shown.value = false;
    await nextTick();
    // 停用后 DOM 离开文档，等尺寸监听报完量到的 0
    await frames(3);
    shown.value = true;
    await nextTick();

    const after = areas(ctx.wrapper);
    expect([after.catalog, after.current]).toStrictEqual([before.catalog, before.current]);
    expect(ctx.loopErrors).toStrictEqual([]);
  });
});
