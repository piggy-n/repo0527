import type { Locator, Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

interface Backend {
  role: 'admin' | 'user';
  // 已读接口收到的请求，按顺序
  reads: string[];
}

// 本地接口样本：字段按 2026-10-27 只读核对的真实接口（docs/migration.md），人名虚构
const messages = [
  { msgId: 'msg-approval', category: 'approval', title: '数据申请待审核', isRead: 'false', taskId: 'apply-001',
    content: '王立于2026年10月28日11时29分提交的资源申请需要您审批，请及时查看并处理相关申请。',
    createTime: '2026-10-28 11:29:36' },
  { msgId: 'msg-table', category: 'table', title: '报表分析通知', isRead: 'false', taskId: null,
    content: '基本统计报表_区级', createTime: '2026-10-14 14:28:00' },
  { msgId: 'msg-resource', category: 'resource', title: '数据准备完成', isRead: 'true', taskId: 'apply-001',
    content: '您于2026年10月25日14时20分提交的资源数据已处理完成。', createTime: '2026-10-25 14:52:27' }
];

const application = {
  apply_id: 'apply-001', apply_name: '拆除未尽区', user_name: '王立', receiver_dept_name: '江苏省基础地理信息中心',
  layer_code: 'bgdc_dltb_2022', xzqmc: '江苏省南京市', create_time: '2026-10-28T03:29:36.527+00:00',
  start_date: '2026-10-28T00:00:00.000+00:00', end_date: '2026-12-31T15:59:59.000+00:00', data_formats: 'gdb',
  apply_purpose: '用于城市更新专项核查', status: 'pending'
};

const emptyPage = { list: [], total: 0, pageNum: 1, pageSize: 20, pages: 0 };

// 产物测试只使用本地接口样本，不导入源码；没有列出的接口交给公共夹具（地图目录等）
const test = base.extend<{ backend: Backend }>({
  backend: [async ({ context }, use) => {
    const backend: Backend = { role: 'admin', reads: [] };
    const read = new Set<string>();
    const withReadState = (message: (typeof messages)[number]) =>
      ({ ...message, isRead: read.has(message.msgId) ? 'true' : message.isRead });
    await context.route('**/backend/**', async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice('/backend'.length);
      let data: unknown;
      if (endpoint === '/user/login') {
        const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'smoke', exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
        data = { token, loginName: 'smoke', realName: '冒烟测试', roleCode: backend.role };
      } else if (endpoint === '/api/message/list' && request.method() === 'POST') {
        const unreadOnly = (request.postDataJSON() as { isRead?: string }).isRead === 'false';
        const current = messages.map(withReadState);
        data = unreadOnly ? current.filter(message => message.isRead === 'false') : current;
      } else if (endpoint.startsWith('/api/message/read/') && request.method() === 'POST') {
        backend.reads.push(endpoint);
        read.add(decodeURIComponent(endpoint.slice('/api/message/read/'.length)));
        data = null;
      } else if (endpoint === '/api/apply/list' && request.method() === 'POST') {
        data = { list: [application], total: 1, pageNum: 1, pageSize: 20, pages: 1 };
      } else if (endpoint === '/api/apply/apply-001' && request.method() === 'GET') {
        data = application;
      } else if (endpoint === '/statistics/page' && request.method() === 'POST') {
        data = emptyPage;
      } else {
        await route.fallback();
        return;
      }
      await route.fulfill({ json: { code: 200, data } });
    });
    await use(backend);
  }, { auto: true }]
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('元素没有显示');
  }
  return box;
}

/** 打开消息弹框，等淡入结束后返回弹框和按钮 */
async function openMessages(page: Page, label: string) {
  const bell = page.getByRole('button', { name: label, exact: true });
  await bell.click();
  const popover = page.locator('.el-popover').filter({ has: page.getByLabel('消息列表') });
  await expect(popover).toBeVisible();
  await expect(popover).toHaveCSS('opacity', '1');
  return { bell, popover };
}

test('管理员：角标是未读数，点"去审核"标为已读、关上弹框并打开系统管理里的申请', async ({ page, backend }) => {
  await login(page);
  await expect(page.getByRole('button', { name: '消息，2 条未读', exact: true })).toBeVisible();

  const { bell, popover } = await openMessages(page, '消息，2 条未读');
  const header = await boxOf(page.locator('header').first());
  const box = await boxOf(popover);
  const bellBox = await boxOf(bell);
  expect(box.y - (header.y + header.height)).toBeCloseTo(8, 0);
  expect(box.x + box.width).toBeCloseTo(bellBox.x + bellBox.width, 0);
  expect(box.width).toBe(400);
  await expect(popover.getByRole('article')).toHaveCount(3);

  await popover.getByRole('button', { name: '去审核', exact: true }).click();
  await expect(page).toHaveURL(/\/system-management\?apply=apply-001$/);
  await expect(popover).toBeHidden();
  const dialog = page.locator('.el-dialog').filter({ hasText: '审核申请' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('拆除未尽区');
  await expect.poll(() => backend.reads).toEqual(['/api/message/read/msg-approval']);
  await expect(page.getByRole('button', { name: '消息，1 条未读', exact: true })).toBeVisible();

  // 关闭申请回到列表，再切到统计报表栏目
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL(/\/system-management$/);
  await page.getByRole('link', { name: '统计报表', exact: true }).click();
  await expect(page).toHaveURL(/\/system-management\/statistical-report$/);
  await expect(page.locator('.el-table__empty-text')).toContainText('暂无数据');
});

test('普通用户：业务按钮禁用并说明原因；窄屏时弹框左右离窗口 16', async ({ page, backend }) => {
  backend.role = 'user';
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  const { popover } = await openMessages(page, '消息，2 条未读');
  const box = await boxOf(popover);
  expect(box.x).toBeCloseTo(16, 0);
  expect(box.x + box.width).toBeCloseTo(390 - 16, 0);
  await Promise.all(
    ['去审核', '查看报表'].map(name => expect(popover.getByRole('button', { name, exact: true })).toBeDisabled())
  );
  await expect(popover.getByText('数据下载页面迁移后可用').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  expect(backend.reads).toEqual([]);
});
