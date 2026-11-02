import { flushPromises, mount } from '@vue/test-utils';
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

describe('AreaAnalysisPanel', () => {
  it('还没有范围时说明怎样上传、绘制和支持的格式', () => {
    const { wrapper } = mountPanel();
    expect(wrapper.text()).toContain('上传范围文件，或用地图左上角的工具绘制范围');
    expect(wrapper.text()).toContain('文件不超过 50 MB');
  });

  it('市和区县少时全部展开、没有搜索框；四个数各带一行说明', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    expect(wrapper.find('input[aria-label="搜索市、区县"]').exists()).toBe(false);
    expect(cityButton(wrapper, '南京市').attributes('aria-expanded')).toBe('true');
    expect(districtNames(wrapper).length).toBeGreaterThan(2);
    const stats = wrapper.findAll('dl > div').map(item => item.text());
    expect(stats[0]).toMatch(/^范围面积[\d,.]+ km²$/);
    expect(stats[1]).toMatch(/^涉及区县\d+ 个全部 \d+ · 部分 \d+$/);
    expect(stats[2]).toBe('涉及市2 个南京、镇江');
    expect(stats[3]).toMatch(/^估算常住人口≈[\d,.]+ 万人部分覆盖按面积折算$/);
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
      wrapper.findAll('label').find(label => label.text().startsWith('部分覆盖')),
      '"部分覆盖"筛选'
    );
    await partial.get('input').setValue(true);
    const rows = wrapper.findAll('button[aria-label$="移到这里"]');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every(row => row.text().includes('部分'))).toBe(true);

    const search = wrapper.get('input[aria-label="搜索市、区县"]');
    await search.setValue('江宁');
    expect(districtNames(wrapper)).toEqual(['江宁区']);
    await search.setValue('不存在');
    expect(wrapper.text()).toContain('没有符合条件的区县');
  });

  it('行里只有名称、标签和面积：市的标签合计区县，占比在标签的悬浮提示里，读屏也能读到', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    const nanjing = cityButton(wrapper, '南京市');
    expect(nanjing.get('.el-tag').text()).toBe('部分 2');
    expect(nanjing.text()).toMatch(/^南京市部分 2[\d,.]+ km²$/);
    const detail = /[\d,.]+ km² \/ [\d,.]+ km²（[\d.]+%）$/;
    expect(nanjing.attributes('aria-label')).toMatch(/^南京市，部分覆盖，涉及区县部分 2，/);
    expect(nanjing.attributes('aria-label')).toMatch(detail);

    const district = wrapper.get('button[aria-label$="移到这里"]');
    expect(district.get('.el-tag').text()).toBe('部分');
    expect(district.text()).toMatch(/^.+区部分[\d,.]+ km²$/);

    expect(document.body.textContent).not.toMatch(detail);
    await nanjing.get('.el-tag').trigger('mouseenter');
    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(detail);
    });
  });

  it('省的标签合计全部区县；全部、部分都有时写在一个标签里，有部分覆盖时是橙色', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, [box(118.7, 31.95, 118.95, 32.15)]);
    const tags = wrapper.findAll('.el-tag');
    expect(tags[0]?.text()).toMatch(/^全部 \d+ · 部分 \d+$/);
    expect(tags[0]?.classes()).toContain('el-tag--warning');
    const full = required(
      wrapper.findAll('button[aria-label$="移到这里"]').find(row => row.get('.el-tag').text() === '全部'),
      '全部覆盖的区县'
    );
    expect(full.get('.el-tag').classes()).toContain('el-tag--primary');
  });

  it('悬停区县时地图描出它，移出列表时取消', async () => {
    const { wrapper, editor } = mountPanel();
    await analyzed(editor, NINGZHEN_RINGS);
    const first = wrapper.get('button[aria-label$="移到这里"]');
    await first.trigger('mouseenter');
    expect(editor.hovered.value).not.toBeNull();
    await wrapper.get('section').trigger('mouseleave');
    expect(editor.hovered.value).toBeNull();
  });

  it('不能用时写出原因，可以重试的有"重试"', async () => {
    const { wrapper, editor } = mountPanel({ status: 'loading' });
    await analyzed(editor, NINGZHEN_RINGS);
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('区县数据还没有加载好');
    expect(alert.findAll('button').map(button => button.text())).toEqual(['重试']);
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('不能使用');
  });
});
