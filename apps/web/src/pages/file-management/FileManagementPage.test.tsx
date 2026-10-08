import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { ElMessage, ElMessageBox, type MessageBoxData } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { filePageResponse } from '@/features/file-management/test-data';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
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
  localStorage.clear();
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

// 请求到达后挂起，调用 release 才返回，用来观察请求进行中的界面；每个分类 totalElements 条数据
function holdFiles(totalElements = 3) {
  const pageRequests: string[] = [];
  const held: (() => void)[] = [];
  server.use(
    mock.get('/backend/file/page', async ({ request }) => {
      const categoryId = new URL(request.url).searchParams.get('categoryId') ?? '';
      pageRequests.push(categoryId);
      await new Promise<void>(resolve => {
        held.push(resolve);
      });
      return HttpResponse.json(filePageResponse({ categoryId, totalElements }));
    })
  );
  const release = () => {
    for (const resolve of held.splice(0)) {
      resolve();
    }
  };
  return { pageRequests, release };
}

// 骨架屏和遮罩都延迟 300ms 才出现，断言它们出现或没有出现都要等过这段时间
const waitPastLoadingDelay = () => new Promise(resolve => setTimeout(resolve, 400));

// 已登录：删除前要确认会话仍然有效
// 传入同一个 queryClient 可以模拟离开列表后重新进入（缓存还在）
function mountPage(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({
    token: createTestJwtExpiringAt(Date.now() + 3_600_000),
    user: { loginName: 'zhangsan', role: Role.user }
  });
  return mount(FileManagementPage, {
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] },
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

const deleteButtons = (wrapper: Wrapper) =>
  wrapper.findAll('.el-table__body button').filter(button => button.text() === '删除');

// 确认框挂起，由用例决定何时点确认
function holdConfirm() {
  const pending: ((action: MessageBoxData) => void)[] = [];
  vi.spyOn(ElMessageBox, 'confirm').mockImplementation(
    () =>
      new Promise<MessageBoxData>(resolve => {
        pending.push(resolve);
      })
  );
  return {
    pending,
    confirm: () => pending.shift()?.('confirm' as MessageBoxData)
  };
}

// 第 1 页 45 条（共 3 页），其他页都返回服务异常；记录每次请求的页码
function failBeyondFirstPage() {
  const pageNumbers: string[] = [];
  server.use(
    mock.get('/backend/file/page', ({ request }) => {
      const pageNo = new URL(request.url).searchParams.get('pageNo') ?? '';
      pageNumbers.push(pageNo);
      return pageNo === '1'
        ? HttpResponse.json(filePageResponse({ totalElements: 45 }))
        : HttpResponse.json({ code: 500, msg: '服务异常', data: null });
    })
  );
  vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
  return pageNumbers;
}

// 点分页器上的页码，等这一页的请求失败、结果渲染出来；如果分页器要改页码，这时也已经改了
async function goToFailingPage(wrapper: Wrapper, page: string, pageNumbers: string[]) {
  await wrapper.findAll('.el-pager li').find(item => item.text() === page)?.trigger('click');
  await vi.waitFor(() => expect(pageNumbers).toContain(page));
  await new Promise(resolve => setTimeout(resolve, 100));
}

function expectStayedOn(wrapper: Wrapper, page: string) {
  expect(wrapper.findAll('.el-pager li.is-active').map(item => item.text())).toEqual([page]);
  // 测试里没有装中文语言包，总数显示为 "Total 45"
  expect(wrapper.findAll('.el-pagination__total').map(item => item.text())).toEqual([expect.stringContaining('45')]);
  expect(wrapper.findAll('.el-table__empty-text').map(item => item.text())).toEqual(['加载失败重试']);
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

  it('切回看过的分类：立即显示缓存的数据，后台重新请求期间不出遮罩', async () => {
    const { pageRequests, release } = holdFiles();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));
    await treeNode(wrapper, '政策法规')[0]?.trigger('click');
    await treeNode(wrapper, '国家层面政策法规')[0]?.trigger('click');
    await vi.waitFor(() => expect(pageRequests).toHaveLength(2));
    release();
    await vi.waitFor(() => expect(mainPanel(wrapper).title).toBe('国家层面政策法规'));

    await treeNode(wrapper, '自然资源调查类')[0]?.trigger('click');
    await vi.waitFor(() => expect(pageRequests).toHaveLength(3));
    await waitPastLoadingDelay();

    expect(mainPanel(wrapper)).toMatchObject({ title: '自然资源调查类', names: ['测试文件1.pdf', '测试文件2.pdf', '测试文件3.pdf'] });
    expect(wrapper.findAll('.el-loading-mask')).toHaveLength(0);
    release();
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

    await deleteButtons(wrapper)[1]?.trigger('click');

    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('删除成功'));
    expect(deleted).toEqual(['file-technical-standard-current-survey-2']);
    expect(pageRequests).toHaveLength(2);
  });

  it('确认框打开期间页面卸载：关闭确认框，之后再点确认也不删除', async () => {
    const { deleted } = mockFiles();
    const dialog = holdConfirm();
    const close = vi.spyOn(ElMessageBox, 'close');
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));
    await deleteButtons(wrapper)[0]?.trigger('click');
    await vi.waitFor(() => expect(dialog.pending).toHaveLength(1));

    wrapper.unmount();
    expect(close).toHaveBeenCalled();
    dialog.confirm();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(deleted).toEqual([]);
  });

  it('确认框打开期间会话结束：再点确认也不删除', async () => {
    const { deleted } = mockFiles();
    const dialog = holdConfirm();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));
    await deleteButtons(wrapper)[0]?.trigger('click');
    await vi.waitFor(() => expect(dialog.pending).toHaveLength(1));

    useSessionStore().clear();
    dialog.confirm();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(deleted).toEqual([]);
  });

  it('删除 A 未完成时删除 B：A 仍显示删除中，不能再次删除', async () => {
    mockFiles();
    // 删除请求挂起，由用例放行
    const deleted: string[] = [];
    const held: (() => void)[] = [];
    server.use(
      mock.get('/backend/file/delete', async ({ request }) => {
        deleted.push(new URL(request.url).searchParams.get('id') ?? '');
        await new Promise<void>(resolve => {
          held.push(resolve);
        });
        return HttpResponse.json({ code: 200, data: null, msg: '删除成功', success: true });
      })
    );
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue({ close: () => undefined });
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));

    await deleteButtons(wrapper)[0]?.trigger('click');
    await vi.waitFor(() => expect(deleted).toHaveLength(1));
    await deleteButtons(wrapper)[1]?.trigger('click');
    await vi.waitFor(() => expect(deleted).toHaveLength(2));

    expect(deleteButtons(wrapper).map(button => button.classes().includes('is-loading'))).toEqual([true, true, false]);
    await deleteButtons(wrapper)[0]?.trigger('click');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(deleted).toEqual(['file-technical-standard-current-survey-1', 'file-technical-standard-current-survey-2']);

    // 放行后两次删除各自完成；等列表刷新完再结束，避免请求落到下一个用例
    for (const resolve of held.splice(0)) {
      resolve();
    }
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(deleteButtons(wrapper).some(button => button.classes().includes('is-loading'))).toBe(false));
  });

  it('翻页请求失败时停在当前页，不因总数未知跳回第 1 页', async () => {
    const pageNumbers = failBeyondFirstPage();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(20));

    await goToFailingPage(wrapper, '2', pageNumbers);

    expect(pageNumbers).toEqual(['1', '2']);
    expectStayedOn(wrapper, '2');
  });

  it('条件不变再点查询后翻页失败：同样停在当前页', async () => {
    const pageNumbers = failBeyondFirstPage();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(20));
    await wrapper.findAll('button').find(button => button.text() === '查询')?.trigger('click');
    await vi.waitFor(() => expect(pageNumbers).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 50));

    await goToFailingPage(wrapper, '3', pageNumbers);

    expect(pageNumbers).toEqual(['1', '1', '3']);
    expectStayedOn(wrapper, '3');
  });

  it('离开列表后重新进入（有缓存）再翻页失败：同样停在当前页', async () => {
    const pageNumbers = failBeyondFirstPage();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountPage(queryClient);
    await vi.waitFor(() => expect(mainPanel(first).names).toHaveLength(20));
    first.unmount();

    const wrapper = mountPage(queryClient);
    // 先显示缓存的数据，后台重新请求返回同样的数据
    await vi.waitFor(() => expect(pageNumbers).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 50));
    await goToFailingPage(wrapper, '3', pageNumbers);

    expect(pageNumbers).toEqual(['1', '1', '3']);
    expectStayedOn(wrapper, '3');
  });

  it('总数先减少再增加后跳到第 3 页：不被旧缓存跳回第 2 页', async () => {
    let totalElements = 45;
    const pageNumbers: string[] = [];
    server.use(
      mock.get('/backend/file/page', ({ request }) => {
        const pageNo = Number(new URL(request.url).searchParams.get('pageNo'));
        pageNumbers.push(String(pageNo));
        return HttpResponse.json(filePageResponse({ pageNo, totalElements }));
      })
    );
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(20));

    // 总数减到 40（2 页）时翻到第 3 页：后端返回第 2 页的数据，页码改到 2；第 3 页的缓存记着"共 2 页"
    totalElements = 40;
    await wrapper.findAll('.el-pager li').find(item => item.text() === '3')?.trigger('click');
    await vi.waitFor(() => expect(pageNumbers).toContain('2'));
    await vi.waitFor(() => expect(wrapper.findAll('.el-pager li').map(item => item.text())).toEqual(['1', '2']));
    // 总数又回到 45：点查询回到第 1 页，可以看到 3 页
    totalElements = 45;
    await wrapper.findAll('button').find(button => button.text() === '查询')?.trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.el-pager li').map(item => item.text())).toEqual(['1', '2', '3']));

    await wrapper.findAll('.el-pager li').find(item => item.text() === '3')?.trigger('click');
    await vi.waitFor(() => expect(pageNumbers.filter(page => page === '3')).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(wrapper.findAll('.el-pager li.is-active').map(item => item.text())).toEqual(['3']);
    expect(mainPanel(wrapper).names[0]).toBe('测试文件41.pdf');
  });

  it('总数 60 → 40 → 60 后进入第 3 页、这次请求失败：不用旧缓存修正页码', async () => {
    let totalElements = 60;
    let failThirdPage = false;
    const pageNumbers: string[] = [];
    server.use(
      mock.get('/backend/file/page', ({ request }) => {
        const pageNo = Number(new URL(request.url).searchParams.get('pageNo'));
        pageNumbers.push(String(pageNo));
        return failThirdPage && pageNo === 3
          ? HttpResponse.json({ code: 500, msg: '服务异常', data: null })
          : HttpResponse.json(filePageResponse({ pageNo, totalElements }));
      })
    );
    vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
    const wrapper = mountPage();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(20));

    // 总数减到 40（2 页）时翻到第 3 页：后端返回第 2 页的数据，页码改到 2；第 3 页的缓存记着"共 2 页"
    totalElements = 40;
    await wrapper.findAll('.el-pager li').find(item => item.text() === '3')?.trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.el-pager li').map(item => item.text())).toEqual(['1', '2']));
    // 总数回到 60，点查询后可以看到 3 页
    totalElements = 60;
    await wrapper.findAll('button').find(button => button.text() === '查询')?.trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.el-pager li').map(item => item.text())).toEqual(['1', '2', '3']));

    // 再进入第 3 页：先显示旧缓存，后台请求失败
    failThirdPage = true;
    await wrapper.findAll('.el-pager li').find(item => item.text() === '3')?.trigger('click');
    await vi.waitFor(() => expect(pageNumbers.filter(page => page === '3')).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(wrapper.findAll('.el-pager li.is-active').map(item => item.text())).toEqual(['3']);
    expect(wrapper.findAll('.el-pagination__total').map(item => item.text())).toEqual([expect.stringContaining('60')]);
  });

  it('从缓存重新进入列表、后台刷新还没完成时翻页失败：保持页码和总数', async () => {
    const pageNumbers: string[] = [];
    // 第 1 页的第二次请求（重新进入时的后台刷新）挂起，第 3 页失败
    const held: (() => void)[] = [];
    server.use(
      mock.get('/backend/file/page', async ({ request }) => {
        const pageNo = new URL(request.url).searchParams.get('pageNo') ?? '';
        pageNumbers.push(pageNo);
        if (pageNo === '3') {
          return HttpResponse.json({ code: 500, msg: '服务异常', data: null });
        }
        if (pageNumbers.filter(page => page === '1').length === 2) {
          await new Promise<void>(resolve => {
            held.push(resolve);
          });
        }
        return HttpResponse.json(filePageResponse({ totalElements: 45 }));
      })
    );
    vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = mountPage(queryClient);
    await vi.waitFor(() => expect(mainPanel(first).names).toHaveLength(20));
    first.unmount();

    const wrapper = mountPage(queryClient);
    await vi.waitFor(() => expect(pageNumbers).toEqual(['1', '1']));
    await vi.waitFor(() => expect(wrapper.findAll('.el-pager li').map(item => item.text())).toEqual(['1', '2', '3']));
    await wrapper.findAll('.el-pager li').find(item => item.text() === '3')?.trigger('click');
    await vi.waitFor(() => expect(pageNumbers).toContain('3'));
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(pageNumbers).toEqual(['1', '1', '3']);
    expect(wrapper.findAll('.el-pager li.is-active').map(item => item.text())).toEqual(['3']);
    expect(wrapper.findAll('.el-pagination__total').map(item => item.text())).toEqual([expect.stringContaining('45')]);
    for (const resolve of held.splice(0)) {
      resolve();
    }
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

  it('首次加载：请求较慢时延迟出现骨架屏，不出遮罩，也不显示"暂无数据"', async () => {
    const { pageRequests, release } = holdFiles(0);
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(1));

    // 延迟之内表体留空
    expect(wrapper.findAll('.table-skeleton')).toHaveLength(0);
    expect(wrapper.find('.el-table__empty-text').text()).toBe('');

    await waitPastLoadingDelay();

    expect(wrapper.findAll('.el-table__empty-text .table-skeleton')).toHaveLength(1);
    expect(wrapper.find('.el-table__empty-text').text()).toBe('');
    expect(wrapper.findAll('.el-loading-mask')).toHaveLength(0);

    release();
    await vi.waitFor(() => expect(wrapper.find('.el-table__empty-text').text()).toBe('暂无数据'));
    expect(wrapper.findAll('.table-skeleton')).toHaveLength(0);
  });

  it('换条件查询：请求期间保留上一次的数据并显示遮罩', async () => {
    const { pageRequests, release } = holdFiles();
    const wrapper = mountPage();
    await vi.waitFor(() => expect(pageRequests).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(mainPanel(wrapper).names).toHaveLength(3));

    await wrapper.find('input[placeholder="请输入文档名称"]').setValue('测试');
    await wrapper.findAll('button').find(button => button.text() === '查询')?.trigger('click');
    await vi.waitFor(() => expect(pageRequests).toHaveLength(2));

    await vi.waitFor(() => expect(wrapper.findAll('.el-loading-mask')).toHaveLength(1));
    expect(mainPanel(wrapper).names).toHaveLength(3);
    release();
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
