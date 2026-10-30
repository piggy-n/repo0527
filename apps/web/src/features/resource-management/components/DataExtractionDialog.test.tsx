import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { required } from '@/shared/testing/required';
import { type DataExtractionOwner, useDataExtraction } from '../composables/useDataExtraction';
import { DataExtractionDialog } from './DataExtractionDialog';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

function host() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSessionStore();
  session.start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000),
    user: { loginName: 'admin', role: Role.admin }
  });
  let owner: DataExtractionOwner | undefined;
  mount(
    defineComponent(() => {
      const extraction = useDataExtraction();
      owner = extraction;
      return () => <DataExtractionDialog owner={extraction} />;
    }),
    // 关系图要真实画布，在浏览器测试里验证；这里只测流程
    { attachTo: document.body, global: { plugins: [pinia], stubs: { KnowledgeGraphChart: true } } }
  );
  return { owner: required(owner, '自助取数的拥有者'), session };
}

function dialog(): HTMLElement {
  return required(document.querySelector<HTMLElement>('[role="dialog"][aria-label="知识库-自助取数"]'), '自助取数弹窗');
}

async function click(text: string) {
  const buttons = [...dialog().querySelectorAll('button')];
  required(buttons.find(button => button.textContent?.trim() === text), `「${text}」按钮`).click();
  await flushPromises();
}

describe('useDataExtraction', () => {
  it('搜索：空关键词和没有结果都留在第一步，命中后进入关系图并记下关键词', () => {
    const { owner } = host();
    owner.start();

    expect(owner.search('  ')).toBe('请输入搜索关键词');
    expect(owner.search('不存在的测试地类')).toBe('未搜索到匹配节点');
    expect(owner.step.value).toBe('search');

    expect(owner.search(' 旱地 ')).toBeNull();
    expect(owner.step.value).toBe('graph');
    expect(owner.searched.value).toBe('旱地');
    expect(owner.graph.value.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['S01-0103', 'P01-0103']));
  });

  it('选节点不改条件；上一步保留条件、清掉节点；格式全空时不能提交', () => {
    const { owner } = host();
    owner.start();
    owner.search('耕地');
    owner.form.purpose = '  年度台账  ';
    owner.select(required(owner.graph.value.nodes.find(node => node.id === 'S01-0101'), '水田'));

    expect(owner.form.dataName).toBe('地类图斑');
    owner.back();
    expect(owner.selected.value).toBeNull();
    expect(owner.form.purpose).toBe('  年度台账  ');

    owner.search('耕地');
    owner.form.formats = [];
    expect(owner.submit()).toBe('请至少选择一种数据格式');
    expect(owner.step.value).toBe('graph');
  });

  it('提交只在前端记下条件快照：区划取最后一级、用途去掉空白，然后进入完成页', () => {
    const { owner } = host();
    owner.start();
    owner.search('耕地');
    const node = required(owner.graph.value.nodes.find(item => item.id === 'S01-0101'), '水田');
    owner.select(node);
    Object.assign(owner.form, {
      regionPath: ['320000', '320100', '320102'],
      purpose: ' 台账 ',
      formats: ['Excel', 'SHP']
    });

    expect(owner.submit()).toBeNull();
    expect(owner.step.value).toBe('done');
    expect(owner.request.value).toMatchObject({
      nodeId: 'S01-0101',
      nodeName: node.name,
      dataName: '地类图斑',
      layerCode: 'csxhjctb_xxp_2022',
      xzqdm: '320102',
      formats: ['Excel', 'SHP'],
      purpose: '台账'
    });
  });

  it('水资源的检索词进新的关系图，其他资源沿用旧版；按资源类别可以直接打开水资源', () => {
    const { owner } = host();
    owner.start();

    expect(owner.search(' 河流 ')).toBeNull();
    expect(owner.mode.value).toBe('relation');
    expect(owner.relation.keyword.value).toBe('河流');

    owner.back();
    expect(owner.search('耕地')).toBeNull();
    expect(owner.mode.value).toBe('legacy');
    expect(owner.relation.keyword.value).toBe('');
    expect(owner.graph.value.nodes.length).toBeGreaterThan(0);

    owner.back();
    owner.browseWater();
    expect(owner.step.value).toBe('graph');
    expect(owner.mode.value).toBe('relation');
    expect(owner.relation.view.value.lanes).toHaveLength(4);
  });

  it('关系图里选中的节点随条件提交；上一步清掉选中', () => {
    const { owner } = host();
    owner.start();
    owner.search('湖泊');
    owner.relation.select('land-survey/1102');
    owner.back();
    expect(owner.relation.selectedId.value).toBeNull();

    owner.search('湖泊');
    owner.relation.select('land-survey/1102');
    expect(owner.submit()).toBeNull();
    expect(owner.request.value).toMatchObject({ nodeId: 'land-survey/1102', nodeName: '湖泊水面' });
  });

  it('重新打开回到第一步和默认条件；换会话时关闭', () => {
    const { owner, session } = host();
    owner.start();
    owner.search('耕地');
    owner.form.formats = ['GDB'];
    owner.start();

    expect(owner.step.value).toBe('search');
    expect(owner.keyword.value).toBe('');
    expect(owner.form.formats).toEqual(['Excel']);

    session.start({
      token: createTestJwtExpiringAt(Date.now() + 7_200_000),
      user: { loginName: 'other', role: Role.admin }
    });
    expect(owner.open.value).toBe(false);
  });
});

describe('DataExtractionDialog', () => {
  it('热门词进入第二步，显示条件和底栏；全选、清空格式；开始取数后显示完成页，完成页没有底栏', async () => {
    const { owner } = host();
    owner.start();
    await flushPromises();
    expect(dialog().querySelector('.el-dialog__footer')).toBeNull();

    await click('湿地');
    expect(owner.step.value).toBe('graph');
    expect(dialog().textContent).toContain('请选择关系图节点');
    await click('全选');
    expect(owner.form.formats).toEqual(['Excel', 'Word', 'Echarts', 'SHP', 'GDB']);
    await click('清空');
    expect(owner.form.formats).toEqual([]);
    await click('开始取数');
    expect(owner.step.value).toBe('graph');

    await click('全选');
    await click('开始取数');
    expect(owner.step.value).toBe('done');
    expect(dialog().querySelector('[role="status"]')?.textContent).toBe('已转到后台处理数据');
    expect(dialog().querySelector('.el-dialog__footer')).toBeNull();
  });

  it('按资源类别打开水资源关系图：弹窗加宽，右侧是节点详情；选中节点后详情列出关系', async () => {
    const { owner } = host();
    owner.start();
    await flushPromises();

    await click('水资源');
    const graph = required(dialog().querySelector('[aria-label="水资源关系图"]'), '水资源关系图');
    expect(graph.querySelectorAll('[data-node-id]')).toHaveLength(35);
    expect(dialog().textContent).toContain('请选择关系图节点');
    expect(required(document.querySelector('.el-dialog'), '弹窗').className).toContain('wideRelation');

    required(graph.querySelector<HTMLElement>('[data-node-id="water-survey/HL_FS"]'), 'HL_FS').click();
    await flushPromises();
    expect(owner.relation.selectedId.value).toBe('water-survey/HL_FS');
    expect(dialog().textContent).toContain('时序关联');
    expect(dialog().textContent).toContain('13 个字段');
  });

  it('输入法选字时的回车不搜索，普通回车搜索', async () => {
    const { owner } = host();
    owner.start();
    await flushPromises();
    const input = required(dialog().querySelector<HTMLInputElement>('input[aria-label="搜索关键词"]'), '搜索框');
    input.value = '林地';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await flushPromises();
    expect(owner.step.value).toBe('search');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushPromises();
    expect(owner.step.value).toBe('graph');
  });
});
