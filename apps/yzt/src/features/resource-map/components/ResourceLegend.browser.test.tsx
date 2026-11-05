import 'element-plus/dist/index.css';
import type { CameraState } from '@yzt/map-core';
import { provideMap } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { buildCatalog } from '../catalog';
import { useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { ResourceLegend } from './ResourceLegend';
import { ResourceLegendReset } from './ResourceLegendReset';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
const CATALOG = buildCatalog([{
  code: null,
  name: '测试',
  children: [{ code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2022] }]
}]);
// 与页面一致的布局令牌，feature 测试不反向导入 app
const TOKENS = {
  '--space-xs': '4px',
  '--space-sm': '8px',
  '--space-md': '12px',
  '--space-lg': '16px',
  '--space-xl': '24px',
  '--font-size-xs': '12px',
  '--font-size-base': '14px',
  '--font-size-lg': '16px',
  '--font-weight-semibold': '600'
};

// 固定目录、不挂载地图引擎，真实外壳提供滚动与固定底栏
function setup(width: number) {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.width = `${width}px`;
  // 浮层传送到 body，测试令牌与真实页面一样从文档根继承
  const tokens = host.appendChild(document.createElement('style'));
  tokens.textContent = `:root { ${Object.entries(TOKENS).map(([key, value]) => `${key}: ${value};`).join(' ')} }`;
  let symbolsOwner: ResourceSymbols | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    symbolsOwner = symbols;
    const editing = ref(false);
    const layers = useResourceLayers(map, { catalog, tileBase: 'http://localhost/tiles/', symbols });
    return () => (
      <MxPanel title="图例" style={{ height: '360px', flex: 'none', ...TOKENS }}>
        {{
          default: () => [
            <ResourceLegend
              layers={layers}
              symbols={symbols}
              onEditingChange={value => {
                editing.value = value;
              }}
            />
          ],
          footer: !editing.value && symbols.overrides.value.size
            ? () => [<ResourceLegendReset symbols={symbols} />]
            : undefined
        }}
      </MxPanel>
    );
  });
  const wrapper = mount(Page, { attachTo: host });
  const scroller = wrapper.get('[data-resource-legend]').element.parentElement;
  if (!scroller || !symbolsOwner) {
    throw new Error('没有图例滚动容器或样式拥有者');
  }
  return {
    wrapper,
    host,
    scroller,
    symbols: symbolsOwner,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

describe('ResourceLegend（真实布局）', () => {
  it.each([320, 280, 240])('%s 像素面板完整显示名称、符号，浏览和编辑均不横向溢出', async width => {
    using ctx = setup(width);
    // 复合图例默认展开（ADR 0094）
    expect(ctx.wrapper.find('[aria-label="收起地类图斑"]').exists()).toBe(true);
    const items = ctx.wrapper.findAll('[data-landuse] button');
    expect(items).toHaveLength(76);
    expect(ctx.scroller.scrollWidth).toBe(ctx.scroller.clientWidth);
    for (const item of items) {
      const name = item.element.querySelector('span');
      expect(name).not.toBeNull();
      expect(name?.scrollWidth).toBe(name?.clientWidth);
      expect(getComputedStyle(item.element).fontSize).toBe('12px');
    }
    const swatch = ctx.wrapper.get('[data-landuse="0101"] [data-swatch]').element.getBoundingClientRect();
    expect([swatch.width, swatch.height]).toStrictEqual([22, 16]);
    const row = ctx.wrapper.get('[aria-label="收起地类图斑"]').element.parentElement?.getBoundingClientRect();
    const search = ctx.wrapper.get('input[placeholder="搜索编码或名称"]').element.closest('.el-input');
    expect(row).toBeDefined();
    expect(search?.getBoundingClientRect().left).toBe((row?.left ?? 0) + 24);
    expect(swatch.left).toBe(search?.getBoundingClientRect().left);

    await ctx.wrapper.get('[aria-label="编辑水田样式"]').trigger('click');
    expect(ctx.scroller.scrollWidth).toBe(ctx.scroller.clientWidth);
    const back = ctx.wrapper.findAll('button').find(item => item.text() === '返回图例');
    const title = ctx.wrapper.get('[data-legend-settings] h3').element.getBoundingClientRect();
    const backRect = back?.element.getBoundingClientRect();
    expect(backRect).toBeDefined();
    expect(Math.abs((backRect?.top ?? 0) + (backRect?.height ?? 0) / 2 - title.top - title.height / 2)).toBeLessThan(1);
  });

  it('点击可见条目进入编辑后回到列表原滚动位置，鼠标移出时设置入口隐藏', async () => {
    using ctx = setup(320);
    ctx.scroller.scrollTop = 180;
    const bounds = ctx.scroller.getBoundingClientRect();
    const visible = ctx.wrapper.findAll('[data-landuse] button').find(item => {
      const rect = item.element.getBoundingClientRect();
      return rect.top > bounds.top && rect.bottom < bounds.bottom;
    });
    if (!visible) {
      throw new Error('没有可点击的图例');
    }
    const before = ctx.scroller.scrollTop;
    expect(visible.attributes('title')).not.toBe('');
    await userEvent.click(visible.element);
    expect(ctx.scroller.scrollTop).toBe(0);
    const back = ctx.wrapper.findAll('button').find(item => item.text() === '返回图例');
    if (!back) {
      throw new Error('没有返回图例入口');
    }
    await userEvent.click(back.element);
    await nextTick();
    expect(ctx.scroller.scrollTop).toBe(before);

    ctx.scroller.scrollTop = 0;
    const settings = ctx.wrapper.get('[aria-label="编辑地类图斑样式"]').element;
    const row = settings.parentElement;
    if (!row) {
      throw new Error('没有图层标题行');
    }
    await userEvent.hover(row);
    expect(getComputedStyle(settings).opacity).toBe('1');
    await userEvent.unhover(row);
    expect(getComputedStyle(settings).opacity).toBe('0');
  });

  it('恢复入口上方留出间距，滚动不移动底栏，确认提示可取消且编辑时隐藏', async () => {
    using ctx = setup(320);
    ctx.symbols.setSymbol({ code: 'bgdc_dltb', item: '0101' }, { fillColor: '#000' });
    await nextTick();
    const footer = ctx.wrapper.get('[data-legend-reset]').element;
    const reset = footer.querySelector('button');
    if (!reset) {
      throw new Error('没有全部恢复默认入口');
    }
    expect(reset.getBoundingClientRect().top - footer.getBoundingClientRect().top).toBe(12);
    const before = footer.getBoundingClientRect().top;
    ctx.scroller.scrollTop = 200;
    expect(footer.getBoundingClientRect().top).toBe(before);
    await userEvent.click(reset);
    const prompt = document.querySelector<HTMLElement>('.el-popconfirm');
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain('包括未勾选图层');
    expect(prompt && getComputedStyle(prompt).fontSize).toBe('12px');
    const cancel = [...(prompt?.querySelectorAll('button') ?? [])].find(item => item.textContent === '取消');
    if (!cancel) {
      throw new Error('没有取消恢复入口');
    }
    await userEvent.click(cancel);
    expect(ctx.symbols.overrides.value.size).toBe(1);
    await ctx.wrapper.get('[aria-label="编辑水田样式"]').trigger('click');
    expect(ctx.wrapper.find('[data-legend-reset]').exists()).toBe(false);
  });
});
