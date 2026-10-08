import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { ElMessage, ElMessageBox, type MessageBoxData } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { filePageResponse } from '@/features/file-management/test-data';
import { FileManagementPage } from './FileManagementPage';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

afterAll(() => {
  server.close();
});

// 每个分类 3 条数据；记录每次请求的分类，以及删除请求的 id
function mockFiles() {
  const pageRequests: string[] = [];
  const deleted: string[] = [];
  server.use(
    mock.get('/backend/file/page', ({ request }) => {
      const categoryId = new URL(request.url).searchParams.get('categoryId') ?? '';
      pageRequests.push(categoryId);
      return HttpResponse.json(filePageResponse({ categoryId, totalElements: 3 }));
    }),
    mock.get('/backend/file/delete', ({ request }) => {
      deleted.push(new URL(request.url).searchParams.get('id') ?? '');
      return HttpResponse.json({ code: 200, data: null, msg: '删除成功', success: true });
    })
  );
  return { pageRequests, deleted };
}

function mountPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(FileManagementPage, {
    global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    attachTo: document.body
  });
}

type Wrapper = ReturnType<typeof mountPage>;

// 主区的面板：标题、上级路径、表格第二列（文档名称）；元素不存在时是 undefined，由断言报出差异
function mainPanel(wrapper: Wrapper) {
  const panel = wrapper.findAll('section').find(section => section.find('table').exists());
  const textOf = (selector: string) => panel?.findAll(selector)[0]?.text();
  return {
    title: textOf('h2'),
    description: textOf('[class*="_description_"]'),
    names: panel?.findAll('.el-table__body tr').map(row => row.findAll('td')[1]?.text()) ?? []
  };
}

const treeNode = (wrapper: Wrapper, label: string) =>
  wrapper.findAll('.el-tree-node__content').filter(node => node.text() === label);

describe('FileManagementPage', () => {
  it('显示默认分类的标题、上级路径和文件', async () => {
    const { pageRequests } = mockFiles();
    const wrapper = mountPage();

    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));
    expect(pageRequests).toEqual(['technical-standard-current-survey']);
    expect(mainPanel(wrapper)).toMatchObject({
      title: '自然资源调查类',
      description: '技术标准规范 / 国家/行业现行技术规程、标准、规范',
      names: ['测试文件1.pdf', '测试文件2.pdf', '测试文件3.pdf']
    });
  });

  it('选中另一个分类：请求该分类，标题和路径随之变化', async () => {
    const { pageRequests } = mockFiles();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(1));

    await treeNode(wrapper, '政策法规')[0]?.trigger('click');
    await treeNode(wrapper, '地方层面政策法规')[0]?.trigger('click');

    await vi.waitFor(() => expect(pageRequests.at(-1)).toBe('policy-law-local'));
    await vi.waitFor(() => expect(mainPanel(wrapper).title).toBe('地方层面政策法规'));
    expect(mainPanel(wrapper).description).toBe('政策法规');
  });

  it('点分组只展开收起，不请求，选中的分类仍高亮', async () => {
    const { pageRequests } = mockFiles();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(1));

    await treeNode(wrapper, '设计与报告')[0]?.trigger('click');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(pageRequests).toHaveLength(1);
    expect(wrapper.find('.el-tree .is-current > .el-tree-node__content').text()).toBe('自然资源调查类');
  });

  it('窄屏：在抽屉里选中分类后关闭抽屉', async () => {
    // jsdom 没有 matchMedia，模拟一个始终是窄屏的版本
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    const { pageRequests } = mockFiles();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(1));

    await wrapper.findAll('button').find(button => button.text() === '文件目录')?.trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.el-drawer .el-tree').exists()).toBe(true));
    await treeNode(wrapper, '政策法规')[0]?.trigger('click');
    await treeNode(wrapper, '国家层面政策法规')[0]?.trigger('click');

    await vi.waitFor(() => expect(pageRequests.at(-1)).toBe('policy-law-national'));
    await vi.waitFor(() => expect(wrapper.find('.el-overlay').attributes('style')).toContain('display: none'));
  });

  it('确认后删除，列表重新请求，提示删除成功', async () => {
    const { pageRequests, deleted } = mockFiles();
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const success = vi.spyOn(ElMessage, 'success');
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));

    const deleteButtons = wrapper.findAll('.el-table__body button').filter(button => button.text() === '删除');
    await deleteButtons[1]?.trigger('click');

    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('删除成功'));
    expect(deleted).toEqual(['file-technical-standard-current-survey-2']);
    expect(pageRequests).toHaveLength(2);
  });

  it('取消确认时不删除', async () => {
    const { deleted } = mockFiles();
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));

    await wrapper.findAll('.el-table__body button').find(button => button.text() === '删除')?.trigger('click');
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(deleted).toEqual([]);
  });

  it('首次加载完成前不显示"暂无数据"', async () => {
    // 请求到达后挂起，用例调用 release 才返回
    const pending: (() => void)[] = [];
    server.use(
      mock.get('/backend/file/page', async () => {
        await new Promise<void>(resolve => {
          pending.push(resolve);
        });
        return HttpResponse.json(filePageResponse({ totalElements: 0 }));
      })
    );
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    expect(wrapper.find('.el-table__empty-text').text()).toBe('');

    pending[0]?.();
    await vi.waitFor(() => expect(wrapper.find('.el-table__empty-text').text()).toBe('暂无数据'));
  });

  it('加载失败时显示"加载失败"，点重试重新请求', async () => {
    const requests: number[] = [];
    server.use(
      mock.get('/backend/file/page', () => {
        requests.push(requests.length);
        return requests.length === 1
          ? HttpResponse.json({ code: 500, msg: '服务异常', data: null })
          : HttpResponse.json(filePageResponse({ totalElements: 3 }));
      })
    );
    const wrapper = mountPage();

    await vi.waitFor(() => expect(wrapper.find('.el-table__empty-text').text()).toContain('加载失败'));
    await wrapper.find('.el-table__empty-text button').trigger('click');

    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));
    expect(requests).toHaveLength(2);
  });
});
