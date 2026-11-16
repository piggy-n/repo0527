import 'element-plus/dist/index.css';
import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, type Ref, ref } from 'vue';
import { required } from '../../testing/required';
import { LayerPanelShell, type PanelFloatingContext } from './LayerPanelShell';
import { LayerPopover } from './LayerPopover';

// 真实的布局：浮层是 fixed 的，箭头对着选中的行；行跟着分割线、目录的高度、顺序挪了位置，浮层要跟着重新放
// （2026-11-14 审查发现）。jsdom 里元素的尺寸都是 0，只能在浏览器里验证

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };

// 用到的令牌由 app 的样式给出，这里直接写出（同 LayerPanelShell.browser.test.tsx）
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

const rows = (n: number) =>
  Array.from({ length: n }, (_, index) => h('div', { key: index, style: { height: '32px' } }));

const popover = () => required(document.querySelector<HTMLElement>('[data-layer-popover]'), '浮层');
const row = () => required(document.querySelector<HTMLElement>('[data-row="a"]'), '选中的行');

interface PopoverSetup {
  /** 面板所在的列的高度 */
  readonly height: number;
  /** 目录的行数 */
  readonly catalog: Ref<number>;
  /** 当前图层的行，选中的是 a */
  readonly order: Ref<readonly string[]>;
  /** 手机宽度：盖在面板下段上 */
  readonly sheet?: boolean;
  /** 浮层内容的高度 */
  readonly content?: number;
}

/**
 * 面板在 height 高的列里：目录 catalog 行，当前图层按 order 的顺序排，每行 32 高；选中 order 里的 a，浮层的箭头对着它。
 * 箭头对着的元素和页面一样读当前图层的顺序（CurrentMapLayerPanel 的 popoverAnchor）
 */
function setup({ height, catalog, order, sheet = false, content = 80 }: PopoverSetup) {
  const host = document.body.appendChild(document.createElement('div'));
  const loopErrors: string[] = [];
  const onError = (event: ErrorEvent) => {
    if (event.message.includes('ResizeObserver')) {
      loopErrors.push(event.message);
    }
  };
  window.addEventListener('error', onError);
  const ratio = ref(0.4);
  let floating: PanelFloatingContext | null = null;
  const anchor = () => {
    // 读顺序：只换位、尺寸不变时靠它重新放
    void order.value;
    return floating?.list()?.querySelector<HTMLElement>('[data-row="a"]') ?? null;
  };
  const Page = defineComponent({
    name: 'PopoverPage',
    setup() {
      provideMap({ groups: [], camera: CAMERA });
      return () => (
        <div style={{ display: 'flex', flexDirection: 'column', width: '320px', height: `${height}px`, ...TOKENS }}>
          <LayerPanelShell
            title="资源图层"
            ratio={ratio.value}
            onUpdate:ratio={(value: number) => (ratio.value = value)}
          >
            {{
              catalogTools: () => [],
              catalogFilter: () => [h('div', { style: { height: '32px' } })],
              catalog: () => rows(catalog.value),
              currentTools: () => [],
              current: () =>
                order.value.map(key => h('div', { key, 'data-row': key, style: { height: '32px' } }, key)),
              floating: (context: PanelFloatingContext) => {
                floating = context;
                return [
                  <LayerPopover
                    open
                    panel={context.panel}
                    list={context.list}
                    layout={context.layout}
                    anchor={anchor}
                    sheet={sheet}
                    label="图例"
                  >
                    {{
                      header: () => [h('span', '图例')],
                      default: () => [h('div', { style: { height: `${content}px` } })]
                    }}
                  </LayerPopover>
                ];
              }
            }}
          </LayerPanelShell>
        </div>
      );
    }
  });
  const wrapper = mount(Page, { attachTo: host });
  return {
    wrapper,
    loopErrors,
    popover,
    separator: () => wrapper.get('[role="separator"]').element,
    // 箭头的中心和选中行的中线差多少
    offset: () => {
      const arrowTop = Number.parseFloat(popover().style.getPropertyValue('--arrow-top'));
      const box = row().getBoundingClientRect();
      return popover().getBoundingClientRect().top + arrowTop - (box.top + box.height / 2);
    },
    rowTop: () => row().getBoundingClientRect().top,
    // 盖在下段上时浮层的上边和最大高度应该是多少（同 LayerPopover 的 place）
    sheetBox: () => {
      const list = wrapper.get('[data-current-list]').element.getBoundingClientRect();
      const panel = wrapper.get('[data-layer-panel] > div').element.getBoundingClientRect();
      return { top: list.top - 40 + 8, maxHeight: panel.bottom - list.top + 40 - 16 };
    },
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

describe('LayerPopover（真实的布局）', () => {
  it('放不下时在分割线上按方向键：当前图层整段上移，箭头仍对着选中的行', async () => {
    const order = ref(Array.from({ length: 20 }, (_, index) => (index === 0 ? 'a' : `r${index}`)));
    using ctx = setup({ height: 600, catalog: ref(30), order });
    await frames(4);
    expect(Math.abs(ctx.offset())).toBeLessThanOrEqual(1);
    const before = ctx.rowTop();

    ctx.separator().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await frames(3);
    expect(ctx.rowTop()).toBeLessThan(before - 10);
    expect(Math.abs(ctx.offset())).toBeLessThanOrEqual(1);
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it('都放得下时目录变矮（搜索、收起分类）：当前图层跟着上移，箭头仍对着选中的行', async () => {
    const catalog = ref(4);
    using ctx = setup({ height: 700, catalog, order: ref(['a', 'b']) });
    await frames(4);
    expect(Math.abs(ctx.offset())).toBeLessThanOrEqual(1);
    const before = ctx.rowTop();

    catalog.value = 1;
    await frames(3);
    expect(ctx.rowTop()).toBeLessThan(before - 10);
    expect(Math.abs(ctx.offset())).toBeLessThanOrEqual(1);
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it('只换顺序、尺寸不变（上移、下移）：箭头对着的元素读顺序，跟着选中的行走', async () => {
    const order = ref<readonly string[]>(['a', 'b', 'c']);
    using ctx = setup({ height: 700, catalog: ref(3), order });
    await frames(4);
    const before = ctx.rowTop();

    order.value = ['b', 'c', 'a'];
    await frames(3);
    expect(ctx.rowTop()).toBeGreaterThan(before + 10);
    expect(Math.abs(ctx.offset())).toBeLessThanOrEqual(1);
  });

  it('手机宽度、内容比下段高：目录变矮、当前图层多一行时跟着盖住新的下段，不报 ResizeObserver loop', async () => {
    const catalog = ref(4);
    const order = ref<readonly string[]>(['a', 'b']);
    using ctx = setup({ height: 700, catalog, order, sheet: true, content: 2000 });
    await frames(4);
    const before = ctx.sheetBox();
    expect(ctx.popover().getBoundingClientRect().top).toBeCloseTo(before.top, 0);

    catalog.value = 1;
    order.value = ['a', 'b', 'c'];
    await frames(4);
    const after = ctx.sheetBox();
    // 下段的上边和最大高度都变了：浮层的高度确实跟着变，loop 的断言才看得到问题
    expect(after.top).toBeLessThan(before.top - 10);
    expect(after.maxHeight).toBeGreaterThan(before.maxHeight + 10);
    expect(ctx.popover().getBoundingClientRect().top).toBeCloseTo(after.top, 0);
    expect(Number.parseFloat(ctx.popover().style.maxHeight)).toBeCloseTo(after.maxHeight, 0);
    expect(ctx.loopErrors).toStrictEqual([]);
  });
});
