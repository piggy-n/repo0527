import { flushPromises, mount } from '@vue/test-utils';
import { ElTooltip } from 'element-plus';
import type { Position } from 'geojson';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { createTestEditor } from '../composables/test-scope-editor';
import type { ScopeEditor } from '../composables/useScopeEditor';
import type { SimulationModel } from '../composables/useSimulationModel';
import { type Calculator, createCalculator } from '../model/calculator';
import { box, geojsonFile, NINGZHEN_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { AreaAnalysisPanel } from './AreaAnalysisPanel';

let calculator: Calculator;
beforeAll(async () => {
  calculator = createCalculator(await loadTestAtlas());
});

// 标签的悬浮提示放在 body 下
afterEach(() => {
  document.body.innerHTML = '';
});

// before 在面板挂载前操作拥有者，如打开已有的范围
function mountPanel(model: SimulationModel = { status: 'ready', calculator }, before?: (editor: ScopeEditor) => void) {
  let owner: ScopeEditor | undefined;
  // 模型不经过挂载的 props：test-utils 会把 props 包成深层的响应式代理
  const Host = defineComponent({
    setup() {
      const { editor } = createTestEditor(shallowRef(model));
      owner = editor;
      before?.(editor);
      return () => <AreaAnalysisPanel editor={editor} />;
    }
  });
  const wrapper = mount(Host);
  return { wrapper, editor: required(owner, '范围弹窗的拥有者') };
}

async function analyzed(editor: ScopeEditor, rings: readonly Position[][]) {
  editor.start('upload', { files: [geojsonFile('范围.geojson', rings)] });
  await vi.waitFor(() => {
    expect(editor.analysis.value.status).not.toBe('running');
  });
  await flushPromises();
}

type Wrapper = ReturnType<typeof mountPanel>['wrapper'];
const districtNames = (wrapper: Wrapper) =>
  wrapper.findAll('button[aria-label$="移到这里"]').map(button => button.get('[class*="_name_"]').text());
const cityButton = (wrapper: Wrapper, name: string) =>
  required(
    wrapper.findAll('button[aria-expanded]').find(button => button.text().startsWith(name)),
    `${name}的一行`
  );
// 一行里的覆盖占比
const ratioOf = (row: Pick<ReturnType<Wrapper['get']>, 'get'>) => row.get('[class*="_ratio_"]');

describe('AreaAnalysisPanel', () => {
  it('还没有范围时说明怎样上传、绘制，不列坐标系、文件后缀这些细节', () => {
    const { wrapper } = mountPanel();
    expect(wrapper.text()).toContain('上传范围文件，或用地图左上角的工具绘制范围');
    expect(wrapper.text()).toContain('支持 GeoJSON、Shapefile');
    expect(wrapper.text()).not.toMatch(/CGCS2000|\.shp|MB/);
  });

  it('市和区县少时全部展开、没有搜索框；四个数不带重复的说明，完成时不写状态', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    expect(wrapper.find('input[aria-label="搜索市、区县"]').exists()).toBe(false);
    expect(cityButton(wrapper, '南京市').attributes('aria-expanded')).toBe('true');
    expect(districtNames(wrapper).length).toBeGreaterThan(2);
    const stats = wrapper.findAll('dl > div').map(item => item.text());
    expect(stats[0]).toMatch(/^范围面积[\d,.]+ km²$/);
    expect(stats[1]).toMatch(/^涉及区县\d+ 个$/);
    expect(stats[2]).toBe('涉及市2 个');
    expect(stats[3]).toMatch(/^估算常住人口≈[\d,.]+ 万人$/);
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('');
  });

  it('范围跨出省界时面积下面写省内的部分；只沿边界相交的区县不写提示，收在列表下面', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.6, 31.6, 120.6, 33.4)]);
    expect(wrapper.findAll('dl > div')[0]?.text()).toMatch(/^范围面积[\d,.]+ km²省内 [\d,.]+ km²$/);
    expect(wrapper.text()).not.toContain('细条或不足 1 公顷');
  });

  it('读文件、整理时做过的处理收在标题旁的说明里，不铺在面板上', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.8, 32, 119, 32.2), box(118.9, 32.1, 119.1, 32.3)]);
    const note = wrapper.get('[role="note"]');
    expect(note.attributes('aria-label')).toContain('处理说明：范围里有交叉的边或互相重叠的面');
    expect(wrapper.text()).not.toContain('已合并为有效的面');
  });

  it('编辑已有的范围时打开就有分析：市和区县少时同样全部展开', async () => {
    const area = await testArea(calculator.atlas, NINGZHEN_RINGS);
    const { wrapper } = mountPanel(undefined, editor => editor.start('edit', { area }));
    expect(cityButton(wrapper, '南京市').attributes('aria-expanded')).toBe('true');
    expect(districtNames(wrapper).length).toBeGreaterThan(2);
  });

  it('区县多时先只列各市，点开看区县；按覆盖方式筛选、按名称搜索时展开符合的', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.6, 31.6, 120.6, 33.4)]);
    expect(wrapper.text()).toContain('江苏省外，不参与计算');
    expect(districtNames(wrapper)).toEqual([]);
    await cityButton(wrapper, '镇江市').trigger('click');
    expect(districtNames(wrapper)).toHaveLength(6);
    await cityButton(wrapper, '镇江市').trigger('click');
    expect(districtNames(wrapper)).toEqual([]);

    const partial = required(
      wrapper.findAll('label').find(label => label.text().startsWith('部分')),
      '"部分"筛选'
    );
    await partial.get('input').setValue(true);
    const rows = wrapper.findAll('button[aria-label$="移到这里"]');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every(row => row.attributes('aria-label')?.includes('部分覆盖'))).toBe(true);

    const search = wrapper.get('input[aria-label="搜索市、区县"]');
    await search.setValue('江宁');
    expect(districtNames(wrapper)).toEqual(['江宁区']);
    await search.setValue('不存在');
    expect(wrapper.text()).toContain('没有符合条件的区县');
  });

  it('行里是名称、占比和面积，不再有标签；市的占比是占全市的，面积和区县个数在悬浮提示里，读屏也能读到', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    expect(wrapper.find('.el-tag').exists()).toBe(false);
    const nanjing = cityButton(wrapper, '南京市');
    expect(nanjing.text()).toMatch(/^南京市[\d.]+%[\d,.]+ km²$/);
    const detail = /[\d,.]+ km² \/ [\d,.]+ km²（[\d.]+%）$/;
    expect(nanjing.attributes('aria-label')).toMatch(/^南京市，部分覆盖，涉及区县部分 2，/);
    expect(nanjing.attributes('aria-label')).toMatch(detail);

    const district = wrapper.get('button[aria-label$="移到这里"]');
    expect(district.text()).toMatch(/^.+区[\d.]+%[\d,.]+ km²$/);

    expect(document.body.textContent).not.toMatch(detail);
    await ratioOf(nanjing).trigger('mouseenter');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('部分 2；');
      expect(document.body.textContent).toMatch(detail);
    });
  });

  it('列头写明两列是什么；"全部"只用在筛选里，覆盖方式叫完整、部分', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.7, 31.95, 118.95, 32.15)]);
    expect(wrapper.text()).toContain('覆盖占比');
    expect(wrapper.text()).toContain('范围内面积');
    const filters = wrapper.findAll('label').map(label => label.text());
    expect(filters).toHaveLength(3);
    expect(filters[0]).toMatch(/^全部 \d+$/);
    expect(filters[1]).toMatch(/^完整 \d+$/);
    expect(filters[2]).toMatch(/^部分 \d+$/);
    expect(wrapper.text()).not.toContain('全部覆盖');
  });

  it('部分覆盖的占比是橙色、占满的是灰色；占满时没有悬浮提示；提示移开后立即关闭、不留节点（同地图工具栏）', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.7, 31.95, 118.95, 32.15)]);
    const rows = wrapper.findAll('button[aria-label$="移到这里"]');
    const rowOf = (relation: string) =>
      required(
        rows.find(row => row.attributes('aria-label')?.includes(relation)),
        `${relation}的区县`
      );
    const full = ratioOf(rowOf('完整覆盖'));
    const partial = ratioOf(rowOf('部分覆盖'));
    expect(full.text()).toBe('100%');
    expect(full.classes().join(' ')).not.toContain('ratioPartial');
    expect(partial.text()).not.toBe('100%');
    expect(partial.classes().join(' ')).toContain('ratioPartial');

    // 先悬停占满的，再悬停部分覆盖的：后者的提示出现时，前者该出现也出现了
    await full.trigger('mouseenter');
    await partial.trigger('mouseenter');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('km² / ');
    });
    expect(document.body.textContent).not.toContain('（100%）');

    const tips = wrapper.findAllComponents(ElTooltip);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every(tip => tip.props('hideAfter') === 0 && tip.props('persistent') === false)).toBe(true);
  });

  it('省的占比是占全省的，有部分覆盖时是橙色', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.7, 31.95, 118.95, 32.15)]);
    const province = wrapper.get('[class*="_provinceRow_"]');
    expect(province.text()).toMatch(/^江苏省(<1|[\d.]+)%[\d,.]+ km²$/);
    expect(ratioOf(province).classes().join(' ')).toContain('ratioPartial');
  });

  it('省、市、区县三级的缩进不变：名称列的样式各是各的，占比和面积共用一套列', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    expect(wrapper.get('[class*="_provinceRow_"]').find('[class*="_cityName_"]').exists()).toBe(false);
    expect(cityButton(wrapper, '南京市').classes().join(' ')).toContain('cityRow');
    expect(cityButton(wrapper, '南京市').find('[class*="_caret_"]').exists()).toBe(true);
    expect(wrapper.get('button[aria-label$="移到这里"]').classes().join(' ')).toContain('districtRow');
    expect(wrapper.find('[class*="_districts_"]').exists()).toBe(true);
  });

  it('悬停、聚焦区县时地图高亮它，移出这一行就取消：移到市的行上不留着上一个区县', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    const first = wrapper.get('button[aria-label$="移到这里"]');
    await first.trigger('mouseenter');
    expect(editor.hovered.value).not.toBeNull();
    await first.trigger('mouseleave');
    expect(editor.hovered.value).toBeNull();
    await first.trigger('focus');
    expect(editor.hovered.value).not.toBeNull();
    await first.trigger('blur');
    expect(editor.hovered.value).toBeNull();
  });

  it('不能用时写给用户的话，可以重试的有"重试"，没有技术原因时不出现"查看原因"', async () => {
    const { wrapper, editor } = mountPanel({ status: 'loading' });
    await analyzed(editor, NINGZHEN_RINGS);
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('区县数据还没有加载好');
    expect(alert.findAll('button').map(button => button.text())).toEqual(['重试']);
  });

  it('文件读不了：不显示技术原因和进度，悬停"查看原因"才看到', async () => {
    const { wrapper, editor } = mountPanel();
    editor.start('upload', { files: [new File(['{"type":'], 'broken.geojson')] });
    await vi.waitFor(() => {
      expect(editor.analysis.value.status).toBe('failed');
    });
    await flushPromises();
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('文件无法读取，请检查后重新上传');
    expect(wrapper.text()).not.toContain('JSON');
    expect(wrapper.find('ol').exists()).toBe(false);
    const reason = required(
      alert.findAll('button').find(button => button.text() === '查看原因'),
      '"查看原因"'
    );
    await reason.trigger('mouseenter');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('broken.geojson 不是有效的 JSON');
    });
  });
});
