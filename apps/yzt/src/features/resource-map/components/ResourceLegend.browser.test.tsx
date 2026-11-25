import 'element-plus/dist/index.css';
import type { CameraState } from '@mx/map-core';
import { provideMap } from '@mx/map-vue';
import { MxPanel } from '@mx/ui';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { defineComponent, nextTick, ref, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { buildCatalog } from '../catalog';
import { type ResourceLayers, useResourceLayers } from '../composables/useResourceLayers';
import { type ResourceSymbols, useResourceSymbols } from '../composables/useResourceSymbols';
import { CLASS_FIELD } from '../filter-fields';
import { ResourceLegend } from './ResourceLegend';
import { ResourceLegendReset } from './ResourceLegendReset';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
// 地类、按取值配色的线、单一符号、再一个按取值配色的线（用来切成统一配色）；只有地类图斑默认勾选
const CATALOG = buildCatalog([{
  code: null,
  name: '测试',
  children: [
    { code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2022] },
    { code: 'csxhjctb_hydl', name: '水域线层', geoType: 'Line', yearList: [2025] },
    { code: 'bgdc_ccwjq', name: '坑塘', geoType: 'Polygon', yearList: [2022] },
    { code: 'csxhjctb_lctl', name: '城市道路', geoType: 'Line', yearList: [2025] }
  ]
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

// 固定目录、不挂载地图引擎；外壳和页面的功能面板（MapPanelGroup）一样是浮层、浅灰标题栏，内容区上内边距 8，
// 提供滚动与固定底栏
function setup(width: number) {
  const host = document.body.appendChild(document.createElement('div'));
  host.style.width = `${width}px`;
  // 浮层传送到 body，测试令牌与真实页面一样从文档根继承
  const tokens = host.appendChild(document.createElement('style'));
  tokens.textContent = `:root { ${Object.entries(TOKENS).map(([key, value]) => `${key}: ${value};`).join(' ')} }`;
  let symbolsOwner: ResourceSymbols | undefined;
  let layersOwner: ResourceLayers | undefined;
  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['resources'], camera: CAMERA });
    const catalog = shallowRef(CATALOG);
    const symbols = useResourceSymbols({ catalog });
    symbolsOwner = symbols;
    const editing = ref(false);
    const layers = useResourceLayers(map, { catalog, tileBase: 'http://localhost/tiles/', symbols });
    layersOwner = layers;
    return () => (
      <MxPanel floating headerTone="muted" title="图例" style={{ height: '360px', flex: 'none', ...TOKENS }}>
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
  if (!scroller || !symbolsOwner || !layersOwner) {
    throw new Error('没有图例滚动容器或拥有者');
  }
  return {
    wrapper,
    host,
    scroller,
    symbols: symbolsOwner,
    layers: layersOwner,
    [Symbol.dispose]() {
      wrapper.unmount();
      host.remove();
    }
  };
}

// 图例的一行：摘要四列（箭头、摘要、名称、年份）加行尾的样式设置
const rowOf = (code: string) =>
  required(document.querySelector<HTMLElement>(`[data-legend="${code}"] > div`), `${code}的行`);
const summaryOf = (code: string) =>
  required(document.querySelector<HTMLElement>(`[data-legend="${code}"] > div > :first-child`), `${code}的摘要`);
const settingsOf = (code: string) =>
  required(
    document.querySelector<HTMLElement>(`[data-legend="${code}"] [data-legend-settings-button]`),
    `${code}的样式设置按钮`
  );
// 年份是摘要的最后一列
const yearOf = (code: string) => required(summaryOf(code).lastElementChild, `${code}的年份`);
// 量年份和行尾样式设置的右边
const rights = (code: string) => [
  yearOf(code).getBoundingClientRect().right,
  settingsOf(code).getBoundingClientRect().right
];
// 按取值配色的子图例里一类的按钮
const valueOf = (code: string, key: string) =>
  required(document.querySelector(`[data-legend="${code}"] [data-value="${key}"] button`), `${code}的${key}`);

describe('ResourceLegend（真实布局）', () => {
  it.each([320, 280, 240])('%s 像素面板完整显示名称、符号，浏览和样式设置均不横向溢出', async width => {
    using ctx = setup(width);
    // 按类别配色默认展开（ADR 0094）
    expect(summaryOf('bgdc_dltb').getAttribute('aria-expanded')).toBe('true');
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
    const row = rowOf('bgdc_dltb').getBoundingClientRect();
    const search = ctx.wrapper.get('input[placeholder="搜索编码或名称"]').element.closest('.el-input');
    expect(search?.getBoundingClientRect().left).toBe(row.left + 24);
    expect(swatch.left).toBe(search?.getBoundingClientRect().left);

    await ctx.wrapper.get('[aria-label="编辑水田样式"]').trigger('click');
    expect(ctx.scroller.scrollWidth).toBe(ctx.scroller.clientWidth);
    const settings = ctx.wrapper.get('[data-legend-settings="bgdc_dltb"]').element.getBoundingClientRect();
    // 标题行：资源名在左，"返回图例"在最右、和标题垂直居中
    const heading = ctx.wrapper.get('[data-settings-heading]');
    const title = heading.get('h3');
    expect(title.text()).toBe('地类图斑');
    const titleRect = title.element.getBoundingClientRect();
    const back = required(heading.findAll('button').find(item => item.text() === '返回图例'), '返回图例').element;
    const backRect = back.getBoundingClientRect();
    expect(Math.abs(backRect.top + backRect.height / 2 - titleRect.top - titleRect.height / 2)).toBeLessThan(1);
    expect(Math.abs(backRect.right - heading.element.getBoundingClientRect().right)).toBeLessThan(1);
    // 显示方式一行：两个选项都在面板里
    const modes = ctx.wrapper.get('[aria-label="图层配色方式"]').element;
    const modeRow = required(modes.parentElement, '显示方式一行');
    expect(modeRow.scrollWidth).toBe(modeRow.clientWidth);
    const options = [...modes.querySelectorAll('.el-radio-button')].map(option => option.getBoundingClientRect());
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option.right).toBeLessThanOrEqual(Math.min(modeRow.getBoundingClientRect().right, settings.right));
    }
    // 编辑器灰框的第一行选类别，选着点进来的这一类
    const editor = ctx.wrapper.get('[data-symbol-editor="0101"]').element;
    const pickerRow = required(editor.firstElementChild, '编辑器的第一行');
    const picker = required(pickerRow.querySelector('[aria-label="选择要修改的类别"]'), '选类别的下拉');
    expect(pickerRow.textContent).toContain('水田');
    expect(pickerRow.scrollWidth).toBe(pickerRow.clientWidth);
    const select = required(picker.closest('.el-select'), '类别下拉框').getBoundingClientRect();
    expect(select.right).toBeLessThanOrEqual(pickerRow.getBoundingClientRect().right);
    expect(editor.getBoundingClientRect().right).toBeLessThanOrEqual(settings.right);
  });

  it('按类别配色、统一配色、单一符号、按分类过滤的行，年份和样式设置逐行右对齐、行高相同；没有可点的占位', async () => {
    using ctx = setup(320);
    ctx.layers.add(['csxhjctb_hydl', 'bgdc_ccwjq', 'csxhjctb_lctl']);
    ctx.symbols.setMode('csxhjctb_lctl', 'uniform');
    ctx.layers.setFilter('csxhjctb_hydl', { [CLASS_FIELD]: ['河流'] });
    await nextTick();
    // 过滤着的行照样按类别展开，过滤掉的类别淡显
    expect(valueOf('csxhjctb_hydl', '河流').hasAttribute('data-excluded')).toBe(false);
    expect(valueOf('csxhjctb_hydl', '水渠').hasAttribute('data-excluded')).toBe(true);
    // 淡显叠在图层透明度上：图层调淡后过滤掉的仍比勾着的淡（2026-11-24 审查）
    const swatchOpacity = (key: string) =>
      Number(getComputedStyle(required(valueOf('csxhjctb_hydl', key).querySelector('[data-swatch]'), key)).opacity);
    expect(swatchOpacity('河流')).toBe(1);
    expect(swatchOpacity('水渠')).toBeCloseTo(0.35);
    ctx.layers.setOpacity('csxhjctb_hydl', 0.5);
    await nextTick();
    expect(swatchOpacity('河流')).toBe(0.5);
    expect(swatchOpacity('水渠')).toBeCloseTo(0.175);
    const codes = ['bgdc_dltb', 'csxhjctb_hydl', 'bgdc_ccwjq', 'csxhjctb_lctl'];
    const height = rowOf('bgdc_dltb').getBoundingClientRect().height;
    for (const code of codes) {
      expect(rights(code)).toStrictEqual(rights('bgdc_dltb'));
      expect(rowOf(code).getBoundingClientRect().height).toBe(height);
    }

    // 只有按类别配色的摘要是按钮；别的行里只有样式设置一个按钮，以前行尾可点的占位没有了
    expect(summaryOf('csxhjctb_hydl').tagName).toBe('BUTTON');
    expect(document.querySelector('[data-legend-slot]')).toBeNull();
    for (const code of ['bgdc_ccwjq', 'csxhjctb_lctl']) {
      expect(summaryOf(code).tagName).toBe('DIV');
      expect(rowOf(code).querySelectorAll('button')).toHaveLength(1);
    }
    // 单击单一符号、统一配色的行尾不做什么；按类别配色的只收起，都不进设置
    await userEvent.click(yearOf('bgdc_ccwjq'));
    await userEvent.click(yearOf('csxhjctb_lctl'));
    expect(ctx.wrapper.find('[data-legend-settings]').exists()).toBe(false);
    await userEvent.click(yearOf('csxhjctb_hydl'));
    expect(summaryOf('csxhjctb_hydl').getAttribute('aria-expanded')).toBe('false');
    expect(ctx.wrapper.find('[data-legend-settings]').exists()).toBe(false);
  });

  it('从列表中间的子图例进样式设置时滚到顶、焦点在标题行，返回后回到原来的滚动位置、焦点回到这一行的样式设置', async () => {
    using ctx = setup(320);
    ctx.scroller.scrollTop = 180;
    const before = ctx.scroller.scrollTop;
    expect(before).toBe(180);
    // 取滚动容器正中的一项：顶上一段被吸顶的行头盖着
    const bounds = ctx.scroller.getBoundingClientRect();
    const middle = bounds.top + bounds.height / 2;
    const item = required(
      ctx.wrapper.findAll('[data-landuse] button').find(button => {
        const rect = button.element.getBoundingClientRect();
        return rect.top <= middle && rect.bottom >= middle;
      }),
      '列表中间的地类'
    );
    const key = required(item.element.closest('[data-landuse]')?.getAttribute('data-landuse'), '地类编码');
    await userEvent.click(item.element);
    expect(ctx.scroller.scrollTop).toBe(0);
    expect(ctx.wrapper.find(`[data-symbol-editor="${key}"]`).exists()).toBe(true);
    expect(document.activeElement?.hasAttribute('data-settings-heading')).toBe(true);

    const back = required(ctx.wrapper.findAll('button').find(button => button.text() === '返回图例'), '返回图例');
    await userEvent.click(back.element);
    await nextTick();
    expect(ctx.scroller.scrollTop).toBe(before);
    expect(document.activeElement).toBe(settingsOf('bgdc_dltb'));
  });

  it('样式设置按钮只在悬停这一行或键盘焦点在行内时显示，平时不接收点击', async () => {
    using ctx = setup(320);
    ctx.layers.add(['bgdc_ccwjq']);
    await nextTick();
    const row = rowOf('bgdc_dltb');
    const settings = settingsOf('bgdc_dltb');
    const other = settingsOf('bgdc_ccwjq');
    await userEvent.unhover(row);
    expect(getComputedStyle(settings).opacity).toBe('0');
    expect(getComputedStyle(settings).pointerEvents).toBe('none');

    await userEvent.hover(row);
    expect(getComputedStyle(settings).opacity).toBe('1');
    expect(getComputedStyle(settings).pointerEvents).toBe('auto');
    expect(getComputedStyle(other).opacity).toBe('0');
    await userEvent.unhover(row);
    expect(getComputedStyle(settings).opacity).toBe('0');

    // 键盘从摘要 Tab 到样式设置
    summaryOf('bgdc_dltb').focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(settings);
    expect(getComputedStyle(settings).opacity).toBe('1');
    settings.blur();
    expect(getComputedStyle(settings).opacity).toBe('0');
  });

  it('展开的长地类图例往下滚时，行头吸在滚动容器的可见上沿、上面不留缝，并盖住滚过去的子图例', async () => {
    using ctx = setup(320);
    const row = rowOf('bgdc_dltb');
    expect(getComputedStyle(row).position).toBe('sticky');
    const top = ctx.scroller.getBoundingClientRect().top;
    // 没滚动时在内容区的上内边距下面
    expect(row.getBoundingClientRect().top).toBe(top + 8);
    ctx.scroller.scrollTop = 400;
    expect(ctx.scroller.scrollTop).toBe(400);
    const rect = row.getBoundingClientRect();
    expect(rect.top).toBe(top);
    // 前面的子图例已经滚过行头；行头叠在子图例上面，贴着上沿的地方也是行头（2026-11-24 审查：原来上面露出 8 像素）
    const first = ctx.wrapper.get('[data-landuse] button').element.getBoundingClientRect();
    expect(first.bottom).toBeLessThan(top);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(hit !== null && row.contains(hit)).toBe(true);
    const edge = document.elementFromPoint(rect.left + rect.width / 2, top + 2);
    expect(edge !== null && row.contains(edge)).toBe(true);
  });

  it('子图例里获得焦点的一类在吸顶的行头下面时滚出来，不被行头盖住（Shift+Tab 往上走）', async () => {
    using ctx = setup(320);
    const row = rowOf('bgdc_dltb');
    ctx.scroller.scrollTop = 400;
    const header = row.getBoundingClientRect();
    // 挑一个被行头盖住的地类
    const covered = ctx.wrapper
      .findAll<HTMLButtonElement>('[data-landuse] button')
      .map(item => item.element)
      .find(item => {
        const rect = item.getBoundingClientRect();
        return rect.top >= header.top && rect.top < header.bottom;
      });
    const target = required(covered, '被行头盖住的地类');

    target.focus();
    expect(document.activeElement).toBe(target);
    expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(row.getBoundingClientRect().bottom);
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
