import 'element-plus/dist/index.css';
import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, KeepAlive, nextTick, type Ref, ref } from 'vue';
import { LayerPanelShell } from './LayerPanelShell';
import { type PanelToolItem, PanelToolbar } from './PanelToolbar';

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

// 现状底图两段标题右边的工具栏（ADR 0157）：目录 4 个按钮，当前图层 7 个按钮，都带分隔线
const CATALOG_TOOLS: PanelToolItem[] = [
  { key: 'add', icon: 'layer-add', label: '添加' },
  { key: 'remove', icon: 'layer-remove', label: '移除' },
  'divider',
  { key: 'expand-all', icon: 'tree-expand-all', label: '全部展开' },
  { key: 'collapse-all', icon: 'tree-collapse-all', label: '全部收起' }
];
const CURRENT_TOOLS: PanelToolItem[] = [
  { key: 'move-up', icon: 'move-up', label: '上移' },
  { key: 'move-down', icon: 'move-down', label: '下移' },
  { key: 'move-top', icon: 'move-top', label: '置顶' },
  { key: 'move-bottom', icon: 'move-bottom', label: '置底' },
  'divider',
  { key: 'opacity', icon: 'layer-opacity', label: '透明度' },
  { key: 'legend', icon: 'map-legend', label: '图例' },
  'divider',
  { key: 'remove-layer', icon: 'layer-remove', label: '移除' }
];

/** 面板放在 width 宽的列里，标题行用真实的工具栏，目录标题后面是"全部 模型 资源" */
function setupHeads(width: number) {
  const host = document.body.appendChild(document.createElement('div'));
  const Page = defineComponent({
    name: 'HeadsPage',
    setup() {
      provideMap({ groups: [], camera: CAMERA });
      return () => (
        <div data-column style={{ display: 'flex', flexDirection: 'column', width: `${width}px`, height: '600px', ...TOKENS }}>
          <LayerPanelShell
            title="资源图层"
            tabs={[{ id: 'core', label: '主节点' }]}
            ratio={0.4}
            views={[
              { id: 'all', label: '全部' },
              { id: 'models', label: '模型' },
              { id: 'resources', label: '资源' }
            ]}
            view="all"
          >
            {{
              catalogTools: () => [<PanelToolbar items={CATALOG_TOOLS} label="资源目录的操作" />],
              catalogFilter: () => [h('div', { style: { height: '32px' } })],
              catalog: () => rows(10),
              currentTools: () => [<PanelToolbar items={CURRENT_TOOLS} label="当前图层的操作" />],
              current: () => rows(5),
              floating: () => []
            }}
          </LayerPanelShell>
        </div>
      );
    }
  });
  const wrapper = mount(Page, { attachTo: host });
  return {
    wrapper,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 面板在 width 宽的列里：两段工具栏最右的按钮是否整个在面板里（面板裁掉外面的），目录的页签是否在自己的区域里滚动
async function headsAt(width: number) {
  using ctx = setupHeads(width);
  await frames(2);
  const inside = (section: string, label: string) => {
    const panel = ctx.wrapper.get(`[data-panel-section="${section}"]`).element.getBoundingClientRect();
    const last = ctx.wrapper
      .get(`[role="toolbar"][aria-label="${label}"]`)
      .findAll('button')
      .at(-1)
      ?.element.getBoundingClientRect();
    return last !== undefined && last.right <= panel.right && last.left >= panel.left;
  };
  const views = ctx.wrapper.get('[role="tablist"][aria-label="资源目录显示的内容"]').element;
  return {
    catalogInside: inside('catalog', '资源目录的操作'),
    currentInside: inside('current', '当前图层的操作'),
    viewsScroll: views.scrollWidth > views.clientWidth
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

  it('手机宽度（294 宽的面板）：两段标题行的工具栏都在面板里，最右的按钮完整可见；目录的页签收缩、横向滚动（2026-11-15 审查发现）', async () => {
    expect(await headsAt(320)).toStrictEqual({ catalogInside: true, currentInside: true, viewsScroll: false });
    expect(await headsAt(294)).toStrictEqual({ catalogInside: true, currentInside: true, viewsScroll: true });
  });

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
