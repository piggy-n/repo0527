import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(owner.legacy.keyword.value).toBe('旱地');
    expect(owner.legacy.view.value.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['S01-0103', 'P01-0103']));
  });

  it('选节点时数据名称取节点名称、数据需求按名称生成，其余条件不变；上一步清掉节点和这两项；格式全空时不能提交', () => {
    const { owner } = host();
    owner.start();
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['', '']);
    owner.search('耕地');
    owner.form.purpose = '  年度台账  ';
    owner.legacy.select('S01-0101');

    expect([owner.form.dataName, owner.form.requirement]).toEqual(['水田', '水田图层']);
    expect(owner.form.purpose).toBe('  年度台账  ');
    owner.form.dataName = '改过的名称';
    owner.legacy.select('S01-0102');
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['水浇地', '水浇地图层']);

    owner.back();
    expect(owner.legacy.selected.value).toBeNull();
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['', '']);
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
    owner.legacy.select('S01-0101');
    const node = required(owner.legacy.selected.value, '水田');
    Object.assign(owner.form, {
      requirement: ' 水田面图层 ',
      regionPath: ['320000', '320100', '320102'],
      purpose: ' 台账 ',
      formats: ['Excel', 'SHP']
    });

    expect(owner.submit()).toBeNull();
    expect(owner.step.value).toBe('done');
    expect(owner.request.value).toMatchObject({
      nodeId: 'S01-0101',
      nodeName: node.name,
      dataName: '水田',
      requirement: '水田面图层',
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
    expect(owner.legacy.view.value.nodes.length).toBeGreaterThan(0);

    owner.back();
    owner.browseWater();
    expect(owner.step.value).toBe('graph');
    expect(owner.mode.value).toBe('relation');
    expect(owner.relation.view.value.nodes).toHaveLength(40);
    expect(owner.legacy.view.value.nodes).toEqual([]);
  });

  it('关系图里选中的节点随条件提交，数据需求带上数据表的几何类型；上一步清掉选中', () => {
    const { owner } = host();
    owner.start();
    owner.search('湖泊');
    owner.relation.select('land-survey/1102');
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['湖泊水面', '湖泊水面图层']);
    owner.back();
    expect(owner.relation.selectedId.value).toBeNull();
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['', '']);

    owner.browseWater();
    owner.relation.select('urban-monitoring/HYDL');
    // 名称已经以几何类型结尾时不重复
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['水域线', '水域线图层']);
    owner.relation.locate('land-survey/DLTB');
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['地类图斑', '地类图斑面图层']);
    expect(owner.submit()).toBeNull();
    expect(owner.request.value).toMatchObject({
      nodeId: 'land-survey/DLTB',
      nodeName: '地类图斑',
      dataName: '地类图斑',
      requirement: '地类图斑面图层'
    });
  });

  it('水资源的总节点和大类只是组织节点：点开看详情，不填写数据名称，不进快照', () => {
    const { owner } = host();
    owner.start();
    owner.browseWater();

    owner.relation.select('root');
    expect(owner.relation.detail.value?.isTarget).toBe(false);
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['', '']);

    owner.relation.select('land-survey');
    expect(owner.relation.selected.value).toBeNull();
    expect([owner.form.dataName, owner.form.requirement]).toEqual(['', '']);
    owner.form.dataName = '手填';
    owner.form.requirement = '手填图层';
    expect(owner.submit()).toBeNull();
    expect(owner.request.value).toMatchObject({ nodeId: '', nodeName: '', dataName: '手填' });
  });

  it('节点太多的检索先收起到一级类，定位时展开上级', () => {
    const { owner } = host();
    owner.start();
    expect(owner.search('用地')).toBeNull();

    expect(owner.mode.value).toBe('legacy');
    expect(owner.legacy.view.value.nodes.length).toBeLessThan(61);
    expect(owner.legacy.view.value.nodes.some(node => node.level === 2)).toBe(false);

    const [parent] = owner.legacy.collapsed.value;
    owner.legacy.select(parent);
    const child = required(owner.legacy.detail.value?.children[0], '收起的下级');
    expect(owner.legacy.view.value.nodes.some(node => node.id === child.id)).toBe(false);

    owner.legacy.locate(child.id);
    expect(owner.legacy.selectedId.value).toBe(child.id);
    expect(owner.legacy.view.value.nodes.some(node => node.id === child.id)).toBe(true);
    expect(owner.form.dataName).toBe(child.name);
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
    expect(dialog().textContent).toContain('请选择知识图谱节点');
    // 没选节点时数据名称、数据需求是空的，必填校验不通过
    await click('开始取数');
    await vi.waitFor(() => expect(dialog().textContent).toContain('请选择节点或填写数据名称'));
    expect(dialog().textContent).toContain('请选择节点或填写数据需求');
    expect(owner.step.value).toBe('graph');

    owner.legacy.select(required(owner.legacy.view.value.nodes.at(-1), '湿地的节点').id);
    await flushPromises();
    const inputs = [...dialog().querySelectorAll<HTMLInputElement>('.el-form-item input')].slice(0, 2);
    expect(inputs.map(input => input.value)).toEqual([owner.form.dataName, owner.form.requirement]);
    expect(owner.form.requirement).toBe(`${owner.form.dataName}图层`);
    expect(dialog().textContent).not.toContain('请选择节点或填写数据名称');
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

  it('按资源类别打开水资源图谱：弹窗加宽，有数据成果筛选，右侧是节点详情；选中节点后详情列出关系', async () => {
    const { owner } = host();
    owner.start();
    await flushPromises();

    await click('水资源调查监测成果');
    expect(dialog().querySelector('[role="group"][aria-label="数据成果"]')).not.toBeNull();
    expect(dialog().textContent).toContain('请选择知识图谱节点');
    expect(required(document.querySelector('.el-dialog'), '弹窗').className).toContain('wide');

    owner.relation.select('water-survey/HL_FS');
    await flushPromises();
    expect(dialog().textContent).toContain('时序关联');
    expect(dialog().textContent).toContain('13 个字段');
  });

  it('其他资源没有数据成果筛选，详情同样列出关系和下级，点了定位过去', async () => {
    const { owner } = host();
    owner.start();
    await flushPromises();

    await click('耕地');
    expect(dialog().querySelector('[role="group"][aria-label="数据成果"]')).toBeNull();
    owner.legacy.select('S01');
    await flushPromises();
    expect(dialog().textContent).toContain('国土调查工作分类 · 一级类');
    expect(dialog().textContent).toContain('下级3');

    await click('0101水田');
    expect(owner.legacy.selectedId.value).toBe('S01-0101');
    expect(dialog().textContent).toContain('分类对应');
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
