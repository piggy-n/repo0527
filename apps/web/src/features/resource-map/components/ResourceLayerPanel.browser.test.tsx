import 'element-plus/dist/index.css';
import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineComponent, KeepAlive, nextTick, type Ref, ref, shallowRef } from 'vue';
import type { ResourceTreeCategory } from '../api';
import { buildCatalog } from '../catalog';
import { useCatalogOrder } from '../composables/useCatalogOrder';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { useResourcePanelLayout } from '../composables/useResourcePanelLayout';
import { ResourceLayerPanel } from './ResourceLayerPanel';
import styles from './ResourceLayerPanel.module.scss';

// 真实的布局（ADR 0040）：面板的高度、分割线的位置都靠量尺寸，jsdom 里元素的尺寸都是 0，只能在浏览器里验证

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

const layer = (code: string, name: string) => ({ code, name, geoType: 'Polygon' as const, yearList: [2024] });

// 两个顶层分类，地类图斑默认勾选（所以开始时基础库、土地资源是展开的）
const CATALOG = buildCatalog([
  {
    code: null,
    name: '基础库',
    children: [
      {
        code: 'tdzy',
        name: '土地资源',
        children: Array.from({ length: 12 }, (_, index) =>
          layer(index === 0 ? 'bgdc_dltb' : `tdzy_${index}`, index === 0 ? '地类图斑' : `土地资源 ${index}`)
        )
      }
    ]
  },
  { code: null, name: '三区三线', children: [layer('sqsx_stbhhx', '生态保护红线')] }
] satisfies ResourceTreeCategory[]);

// 土地资源下除了默认勾选的地类图斑以外的 11 个，都勾选时两区都放不下
const MANY = Array.from({ length: 11 }, (_, index) => `tdzy_${index + 1}`);

// 和面板所在的地图页一样：一个纵向 flex 的列，列的高度就是面板最高能到的高度；给出 shown 时放在 KeepAlive 里，为 false 时停用
function setup(height: number, shown?: Ref<boolean>, expandChecked = true) {
  const host = document.body.appendChild(document.createElement('div'));
  // 尺寸监听的回调改了比被监听元素浅的元素时，浏览器报"ResizeObserver loop completed with undelivered notifications"，
  // 来回重算时每帧都报
  const loopErrors: string[] = [];
  const onError = (event: ErrorEvent) => {
    if (event.message.includes('ResizeObserver')) {
      loopErrors.push(event.message);
    }
  };
  window.addEventListener('error', onError);
  const layout = useResourcePanelLayout();
  let owner: ResourceLayers | undefined;
  const Page = defineComponent({
    name: 'PanelPage',
    setup() {
      const map = provideMap({ groups: ['resources'], camera: CAMERA });
      const layers = useResourceLayers(map, { catalog: shallowRef(CATALOG), tileBase: 'http://localhost/tiles/' });
      owner = layers;
      const order = useCatalogOrder();
      return () => (
        <div
          data-column
          style={{ display: 'flex', flexDirection: 'column', width: '320px', height: `${height}px`, ...TOKENS }}
        >
          <ResourceLayerPanel layers={layers} catalogOrder={order} layout={layout} />
        </div>
      );
    }
  });
  const wrapper = mount(
    shown ? defineComponent(() => () => <KeepAlive>{shown.value ? <Page /> : null}</KeepAlive>) : Page,
    { attachTo: host }
  );
  if (expandChecked) {
    const toggle = wrapper.get('[aria-label="展开已选择图层"]').element;
    if (toggle instanceof HTMLButtonElement) {
      toggle.click();
    }
  }
  const column = host.querySelector('[data-column]');
  if (!(column instanceof HTMLElement) || !owner) {
    throw new Error('没有找到面板所在的列');
  }
  return {
    wrapper,
    layout,
    layers: owner,
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

// 收起所有分类：从外到内，每次点当前第一个"收起"（不包括收起整个面板的按钮）
async function collapseAll(wrapper: VueWrapper) {
  for (;;) {
    const button = wrapper.findAll('button').find(candidate => {
      const label = candidate.attributes('aria-label');
      return label !== undefined && label.startsWith('收起') && !['收起资源图层', '收起已选择图层'].includes(label);
    });
    if (!button) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- 收起以后才知道下一个要点的按钮
    await button.trigger('click');
  }
}

// 目录、分割线、"已选择图层"三块的位置
function areas(wrapper: VueWrapper) {
  const separator = wrapper.get('[role="separator"]').element;
  const tree = separator.previousElementSibling;
  const checked = separator.nextElementSibling;
  if (!(separator instanceof HTMLElement) || !tree || !checked) {
    throw new Error('没有找到目录和"已选择图层"');
  }
  return {
    separator,
    splitterTop: separator.getBoundingClientRect().top,
    tree: tree.getBoundingClientRect().height,
    checked: checked.getBoundingClientRect().height
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

function measure(wrapper: VueWrapper) {
  const panel = wrapper.get('[data-resource-layer-panel]').element;
  const tree = wrapper.get('[role="separator"]').element.previousElementSibling;
  const checked = wrapper.get('[role="separator"]').element.nextElementSibling;
  if (!(tree instanceof HTMLElement) || !(checked instanceof HTMLElement)) {
    throw new Error('没有找到目录和"已选择图层"');
  }
  const list = checked.lastElementChild;
  if (!(list instanceof HTMLElement)) {
    throw new Error('没有找到"已选择图层"的列表');
  }
  return {
    panelHeight: panel.getBoundingClientRect().height,
    treeOverflows: tree.scrollHeight > tree.clientHeight,
    checkedOverflows: list.scrollHeight > list.clientHeight
  };
}

describe('ResourceLayerPanel（真实的布局）', () => {
  it.each(['data-resource', 'data-layer'])('%s 的透明度浮层不会撑开页面，滚动列表立即关闭', async attribute => {
    using ctx = setup(360);
    ctx.layers.setCheckedMany(MANY, true);
    await frames(4);
    const pageWidth = document.documentElement.scrollWidth;
    const pageHeight = document.documentElement.scrollHeight;
    const row = ctx.wrapper.get(`[${attribute}="bgdc_dltb"] > div`).element;
    const trigger = ctx.wrapper.get(`[${attribute}="bgdc_dltb"] button[aria-label="地类图斑的透明度"]`).element;
    await userEvent.hover(row);
    await userEvent.click(trigger);
    // Element Popover 会接管 aria-expanded，按组件自有的按下状态及实际浮层核验
    await expect.poll(() => trigger.getAttribute('aria-pressed')).toBe('true');
    const slider = document.querySelector('[role="slider"][aria-label="地类图斑的透明度"]');
    expect(slider?.checkVisibility()).toBe(true);
    await frames(3);
    expect(document.documentElement.scrollWidth).toBe(pageWidth);
    expect(document.documentElement.scrollHeight).toBe(pageHeight);

    const list = ctx.wrapper.get(`.${attribute === 'data-resource' ? styles.tree : styles.checkedList}`).element;
    list.scrollTop = 32;
    await expect.poll(() => trigger.getAttribute('aria-pressed')).toBe('false');
    await expect.poll(() => slider?.checkVisibility()).toBe(false);
    expect(ctx.layers.state.value.displays.get('bgdc_dltb')?.checked).toBe(true);
  });

  it.each(['data-resource', 'data-layer'])('%s 的透明度关闭后，鼠标移出时不因残留焦点继续显示', async attribute => {
    using ctx = setup(700);
    await frames(3);
    const row = ctx.wrapper.get(`[${attribute}="bgdc_dltb"] > div`).element;
    const trigger = ctx.wrapper.get(`[${attribute}="bgdc_dltb"] button[aria-label="地类图斑的透明度"]`).element;

    await userEvent.hover(row);
    expect(getComputedStyle(trigger).opacity).toBe('1');
    await userEvent.click(trigger);
    await expect.poll(() => trigger.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(trigger);
    await expect.poll(() => trigger.getAttribute('aria-pressed')).toBe('false');
    await userEvent.unhover(trigger);

    // 真实点击保留鼠标焦点，关闭后不能继续触发整行的操作显隐
    expect(document.activeElement).toBe(trigger);
    expect(getComputedStyle(trigger).opacity).toBe('0');
    expect(ctx.layers.state.value.displays.get('bgdc_dltb')?.checked).toBe(true);
  });

  it('默认收起只保留完整入口，展开再收起不改变分割线偏好、不超出列高度', async () => {
    using ctx = setup(360, undefined, false);
    await frames(4);
    const ratio = ctx.layout.checkedRatio.value;
    const panel = ctx.wrapper.get('[data-resource-layer-panel]').element;
    expect(ctx.wrapper.find('[role="separator"]').exists()).toBe(false);
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(360);
    await ctx.wrapper.get('[aria-label="展开已选择图层"]').trigger('click');
    await frames(4);
    expect(ctx.wrapper.find('[role="separator"]').exists()).toBe(true);
    await ctx.wrapper.get('[aria-label="收起已选择图层"]').trigger('click');
    await frames(4);
    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(360);
    expect(ctx.layout.checkedRatio.value).toBe(ratio);
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it.each([false, true])('已选择图层展开为 %s 时清空资源：目录获得全部剩余高度，重新勾选恢复布局', async expanded => {
    using ctx = setup(360, undefined, expanded);
    await frames(4);
    const tree = ctx.wrapper.get(`.${styles.tree}`).element;
    const before = tree.getBoundingClientRect().height;
    const ratio = ctx.layout.checkedRatio.value;

    ctx.layers.setChecked('bgdc_dltb', false);
    await frames(4);
    expect(ctx.wrapper.find(`.${styles.checked}`).exists()).toBe(false);
    expect(ctx.wrapper.find('[role="separator"]').exists()).toBe(false);
    expect(tree.getBoundingClientRect().height).toBeGreaterThan(before);
    const panel = ctx.wrapper.get('[data-resource-layer-panel]').element.getBoundingClientRect();
    expect(tree.getBoundingClientRect().bottom).toBeCloseTo(panel.bottom, 0);
    expect(panel.height).toBeCloseTo(360, 0);

    ctx.layers.setChecked('bgdc_dltb', true);
    await frames(4);
    expect(tree.getBoundingClientRect().height).toBeCloseTo(before, 0);
    expect(ctx.wrapper.find('[role="separator"]').exists()).toBe(expanded);
    expect(ctx.layout.checkedRatio.value).toBe(ratio);
    expect(ctx.loopErrors).toStrictEqual([]);
  });

  it('目录都收起时面板跟着内容变矮："已选择图层"完整显示，目录和"已选择图层"都没有滚动（2026-10-16 用户发现）', async () => {
    using ctx = setup(700);
    await frames(3);

    await collapseAll(ctx.wrapper);
    await frames(6);

    const { panelHeight, treeOverflows, checkedOverflows } = measure(ctx.wrapper);
    expect(panelHeight).toBeLessThan(700);
    expect(treeOverflows).toBe(false);
    expect(checkedOverflows).toBe(false);
    expect(ctx.loopErrors).toEqual([]);
  });

  it('分割线拖到最上面后收起目录：高度稳定下来，不来回变（2026-10-16 用户发现一直闪）', async () => {
    using ctx = setup(700);
    await frames(3);
    ctx.layout.setCheckedRatio(0.95);
    await frames(3);

    await collapseAll(ctx.wrapper);
    await frames(6);
    const heights = new Set<number>();
    for (let index = 0; index < 12; index++) {
      heights.add(Math.round(measure(ctx.wrapper).panelHeight));
      // oxlint-disable-next-line no-await-in-loop -- 每一帧量一次，看高度是不是在来回变
      await frames(1);
    }

    expect([...heights]).toHaveLength(1);
    expect(measure(ctx.wrapper).checkedOverflows).toBe(false);
    expect(ctx.loopErrors).toEqual([]);
  });

  it('放不下时面板占满所在的列，目录滚动，"已选择图层"不滚动', async () => {
    using ctx = setup(360);
    await frames(6);

    const { panelHeight, treeOverflows, checkedOverflows } = measure(ctx.wrapper);
    expect(panelHeight).toBeCloseTo(360, 0);
    expect(treeOverflows).toBe(true);
    expect(checkedOverflows).toBe(false);
    expect(ctx.loopErrors).toEqual([]);
  });

  it('列变矮时面板跟着变矮，不超出列；再变高时跟着变高', async () => {
    using ctx = setup(700);
    await frames(3);

    ctx.column.style.height = '300px';
    await frames(3);
    expect(measure(ctx.wrapper).panelHeight).toBeCloseTo(300, 0);

    ctx.column.style.height = '420px';
    await frames(3);
    expect(measure(ctx.wrapper).panelHeight).toBeCloseTo(420, 0);
    expect(ctx.loopErrors).toEqual([]);
  });

  it('两区都放不下时拖动分割线：线跟着指针走，到两边的最小高度为止，松开后记住位置', async () => {
    using ctx = setup(600);
    ctx.layers.setCheckedMany(MANY, true);
    await frames(4);
    const before = areas(ctx.wrapper);

    drag(before.separator, -60);
    await frames(3);
    const up = areas(ctx.wrapper);
    expect(up.splitterTop).toBeCloseTo(before.splitterTop - 60, 0);
    expect(up.checked).toBeCloseTo(before.checked + 60, 0);
    expect(up.tree + up.checked).toBeCloseTo(before.tree + before.checked, 0);
    expect(ctx.layout.checkedRatio.value).toBeGreaterThan(0.4);

    drag(up.separator, 1000);
    await frames(3);
    expect(areas(ctx.wrapper).checked).toBeCloseTo(40 + 2 * 36, 0);

    drag(up.separator, -1000);
    await frames(3);
    expect(areas(ctx.wrapper).tree).toBeCloseTo(3 * 32, 0);
    expect(measure(ctx.wrapper).panelHeight).toBeCloseTo(600, 0);
    expect(ctx.loopErrors).toEqual([]);
  });

  it.each(['lostpointercapture', 'deactivated', 'buttons'] as const)(
    '拖动在 %s 时结束，之后经过分割线不再改变高度',
    async reason => {
      const shown = ref(true);
      using ctx = setup(600, shown);
      ctx.layers.setCheckedMany(MANY, true);
      await frames(4);
      const { separator } = areas(ctx.wrapper);
      const { left, top } = separator.getBoundingClientRect();
      const init = { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: left + 10, clientY: top + 12 };
      const before = ctx.layout.checkedRatio.value;
      separator.dispatchEvent(new PointerEvent('pointerdown', init));
      separator.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: top - 30 }));
      await nextTick();
      expect(ctx.layout.checkedRatio.value).not.toBe(before);
      const stopped = ctx.layout.checkedRatio.value;

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
      expect(ctx.layout.checkedRatio.value).toBe(stopped);
    }
  );

  it('分割线上按方向键：往上一步"已选择图层"高可用高度的 5%', async () => {
    using ctx = setup(600);
    ctx.layers.setCheckedMany(MANY, true);
    await frames(4);
    const before = areas(ctx.wrapper);
    const available = before.tree + before.checked;

    before.separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await frames(3);
    expect(areas(ctx.wrapper).checked).toBeCloseTo(before.checked + available * 0.05, 0);

    before.separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await frames(3);
    expect(areas(ctx.wrapper).checked).toBeCloseTo(before.checked, 0);
  });

  it('"已选择图层"只有一行时照常拖动：按分割线的位置分，下面留白（2026-10-16 用户要求分割线能正常使用）', async () => {
    using ctx = setup(600);
    await frames(4);
    const before = areas(ctx.wrapper);
    expect(before.separator.getAttribute('aria-disabled')).toBe('false');
    expect(getComputedStyle(before.separator).cursor).toBe('row-resize');

    drag(before.separator, -80);
    await frames(3);
    const up = areas(ctx.wrapper);
    expect(up.splitterTop).toBeCloseTo(before.splitterTop - 80, 0);
    expect(up.checked).toBeCloseTo(before.checked + 80, 0);

    drag(up.separator, 40);
    await frames(3);
    expect(areas(ctx.wrapper).splitterTop).toBeCloseTo(up.splitterTop + 40, 0);
    expect(ctx.loopErrors).toEqual([]);
  });

  it('目录已经全部显示时：往下拖不动，往上拖让目录滚动、"已选择图层"变高', async () => {
    using ctx = setup(600);
    ctx.layers.setCheckedMany(MANY, true);
    await frames(3);
    // 目录剩 4 行：基础库、土地资源（收起）、三区三线和它下面的生态保护红线
    await ctx.wrapper.get('[aria-label="收起土地资源"]').trigger('click');
    await ctx.wrapper.get('[aria-label="展开三区三线"]').trigger('click');
    await frames(4);
    const before = areas(ctx.wrapper);
    expect(before.tree).toBeCloseTo(4 * 32, 0);

    drag(before.separator, 40);
    await frames(3);
    expect(areas(ctx.wrapper).splitterTop).toBeCloseTo(before.splitterTop, 0);

    drag(before.separator, -20);
    await frames(3);
    const up = areas(ctx.wrapper);
    expect(up.splitterTop).toBeCloseTo(before.splitterTop - 20, 0);
    expect(up.tree).toBeCloseTo(4 * 32 - 20, 0);
    expect(measure(ctx.wrapper).treeOverflows).toBe(true);
    expect(ctx.loopErrors).toEqual([]);
  });

  it('拖动改变不了两区时分割线不能调整：拖动、方向键都不改位置，不显示成能拖的样子', async () => {
    // 都放得下
    using fits = setup(700);
    await frames(3);
    await collapseAll(fits.wrapper);
    await frames(4);
    // 目录收起到 2 行，"已选择图层"放不下
    using short = setup(600);
    short.layers.setCheckedMany(MANY, true);
    await frames(3);
    await collapseAll(short.wrapper);
    await frames(4);

    for (const ctx of [fits, short]) {
      const before = areas(ctx.wrapper);
      const ratio = ctx.layout.checkedRatio.value;
      expect(before.separator.getAttribute('aria-disabled')).toBe('true');
      expect(getComputedStyle(before.separator).cursor).toBe('default');

      drag(before.separator, -60);
      before.separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      // oxlint-disable-next-line no-await-in-loop -- 两种情况依次检查
      await frames(3);
      expect(areas(ctx.wrapper).splitterTop).toBeCloseTo(before.splitterTop, 0);
      expect(ctx.layout.checkedRatio.value).toBe(ratio);
      expect(ctx.loopErrors).toEqual([]);
    }
  });

  it('分割线的线上下离目录、"已选择图层"的标题一样远', async () => {
    using ctx = setup(700);
    await frames(3);
    await collapseAll(ctx.wrapper);
    await frames(6);

    const separator = ctx.wrapper.get('[role="separator"]').element;
    const tree = separator.previousElementSibling?.getBoundingClientRect();
    // 分割线两侧的容器边缘等距，标题内边距由整行按钮提供
    const title = separator.nextElementSibling?.firstElementChild?.getBoundingClientRect();
    if (!tree || !title) {
      throw new Error('没有找到目录和"已选择图层"的标题');
    }
    // 线是分割线的 ::before
    const line = getComputedStyle(separator, '::before');
    const lineTop = separator.getBoundingClientRect().top + Number.parseFloat(line.top);
    const above = lineTop - tree.bottom;
    const below = title.top - (lineTop + Number.parseFloat(line.height));
    expect(above).toBeCloseTo(below, 0);
    expect(above).toBeGreaterThan(8);
  });
  it('所在页面被缓存：停用期间量到的 0 不采用，再次激活的那一刻两区的高度和停用前一样（ADR 0063）', async () => {
    const shown = ref(true);
    using env = setup(400, shown);
    env.layers.setCheckedMany(MANY, true);
    await frames(3);
    const before = areas(env.wrapper);

    shown.value = false;
    await nextTick();
    // 停用后 DOM 离开文档，等尺寸监听报完量到的 0
    await frames(3);
    shown.value = true;
    await nextTick();

    // 激活的那一刻，尺寸监听还没重新量
    const after = areas(env.wrapper);
    expect([after.tree, after.checked]).toStrictEqual([before.tree, before.checked]);
    expect(env.loopErrors).toStrictEqual([]);
  });
});
