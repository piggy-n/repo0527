import type { Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

// oxlint-disable no-await-in-loop -- 同一弹框按顺序验证尺寸与状态，不能并行改变视口

interface Backend {
  role: 'admin' | 'user';
  failList: boolean;
  failRead: boolean;
  writes: string[];
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const test = base.extend<{ messages: Backend }>({
  messages: [async ({ page }, use) => {
    const backend: Backend = { role: 'admin', failList: false, failRead: false, writes: [] };
    const rows = Array.from({ length: 24 }, (_, index) => ({
      msgId: String(index), title: `通知 ${index}`, content: index === 2 ? '<script>保持纯文本</script>' : '调查成果已更新。',
      category: index % 2 === 0 ? 'resource' : 'table', isRead: index < 4 ? 'false' : 'true',
      createTime: `2026-10-23 10:${String(59 - index).padStart(2, '0')}:00`,
      taskId: `application-${index}`, taskStatus: index === 0 ? 'pending' : null
    }));
    await page.route('**/backend/user/login', route => {
      const payload = encode({ exp: Math.floor(Date.now() / 1000) + 3600 });
      const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${payload}.test`;
      return route.fulfill({ json: { code: 200, data: {
        token, loginName: 'messages-test', realName: '消息测试', roleCode: backend.role
      } } });
    });
    await page.route('**/backend/api/message/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/list')) {
        expect(route.request().postDataJSON()).toEqual({});
        await route.fulfill({ json: backend.failList ? { code: 500 } : { code: 200, data: rows } });
        return;
      }
      const id = path.split('/').at(-1)!;
      backend.writes.push(id);
      if (backend.failRead) {
        await route.fulfill({ json: { code: 500, msg: '写入失败' } });
        return;
      }
      for (const row of rows) {
        if (id === 'all' || row.msgId === id) {
          row.isRead = 'true';
        }
      }
      await route.fulfill({ json: { code: 200, data: null } });
    });
    await page.route('**/backend/api/apply/**', route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const data = id === 'list'
        ? { list: [], total: 0, pageNum: 1, pageSize: 20, pages: 0 }
        : { apply_id: id, apply_name: '消息对应的申请', status: 'pending' };
      return route.fulfill({ json: { code: 200, data } });
    });
    await page.route('**/backend/statistics/page', route => route.fulfill({
      json: { code: 200, data: { list: [], total: 0, pageNum: 1, pageSize: 20, pages: 0 } }
    }));
    await use(backend);
  }, { auto: true }]
});

async function openFiles(page: Page) {
  await page.goto('/file-management');
  await page.getByPlaceholder('请输入账号').fill('messages-test');
  await page.getByPlaceholder('请输入密码').fill('test-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('link', { name: '文件管理', exact: true }).click();
  await expect(page).toHaveURL(/\/file-management$/);
}

test('Header 消息弹框支持关闭、筛选与内部滚动，窄屏和矮屏保留合理间距', async ({ page }) => {
  await openFiles(page);
  const bell = page.getByRole('button', { name: '消息中心，4 条未读', exact: true });
  const dialog = page.getByRole('dialog', { name: '消息中心', exact: true });
  await bell.click();
  await expect(dialog).toBeVisible();
  await bell.click();
  await expect(dialog).toBeHidden();
  await bell.click();
  await dialog.getByRole('button', { name: '已读', exact: true }).click();
  await expect(dialog.getByText('共 20 条消息', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '全部', exact: true }).click();
  await dialog.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^通知 / })).toHaveCount(24);
  for (const [width, height] of [[1440, 900], [1200, 768], [1199, 768], [390, 768], [1200, 600]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await dialog.boundingBox())!.y).toBe(83);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
    expect(box.y + box.height).toBeLessThanOrEqual(height - 16);
    expect(await page.locator('html').evaluate((element: { scrollWidth: number }) => element.scrollWidth))
      .toBeLessThanOrEqual(width);
    await expect(dialog.getByRole('button', { name: '关闭消息中心', exact: true })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`messages-${width}x${height}.png`) });
  }
  await dialog.getByRole('button', { name: /^通知 23，/ }).focus();
  await expect(dialog.getByRole('button', { name: /^通知 23，/ })).toBeInViewport();
  await expect(dialog.getByRole('heading', { name: '消息中心', exact: true })).toBeInViewport();
  await expect(dialog.getByText('共 24 条消息', { exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(bell).toHaveAttribute('aria-expanded', 'false');
  await bell.click();
  await dialog.getByRole('button', { name: '关闭消息中心', exact: true }).click();
  await expect(bell).toBeFocused();
  await bell.click();
  await page.getByRole('heading', { name: '自然资源调查类', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('单条失败可重试，全部已读同步红点，消息正文作为纯文本显示', async ({ page, messages }) => {
  await openFiles(page);
  messages.failRead = true;
  await page.getByRole('button', { name: '消息中心，4 条未读', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '消息中心', exact: true });
  await dialog.getByRole('button', { name: /^通知 2，/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('标记已读失败，请重试');
  await expect(dialog.getByText('<script>保持纯文本</script>', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '消息中心，4 条未读', exact: true })).toBeVisible();
  messages.failRead = false;
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '消息中心，3 条未读', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '返回消息列表', exact: true }).click();
  await dialog.getByRole('button', { name: '未读 3', exact: true }).click();
  await dialog.getByRole('button', { name: '全部已读', exact: true }).click();
  await expect(page.getByRole('button', { name: '消息中心，0 条未读', exact: true })).toBeVisible();
  await expect(dialog.getByText('暂无符合条件的消息', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '全部已读', exact: true })).toBeDisabled();
  expect(messages.writes).toEqual(['2', '2', 'all']);
});

test('管理员消息进入真实报表栏目和对应申请，详情参数消费后可重复打开', async ({ page }) => {
  await openFiles(page);
  const dialog = page.getByRole('dialog', { name: '消息中心', exact: true });
  await page.getByRole('button', { name: '消息中心，4 条未读', exact: true }).click();
  await dialog.getByRole('button', { name: /^通知 1，/ }).click();
  await dialog.getByRole('button', { name: '查看统计报表', exact: true }).click();
  await expect(page).toHaveURL(/\/system-management\/statistical-report$/);
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /^消息中心，/ }).click();
  await dialog.getByRole('button', { name: /^通知 1，/ }).click();
  await dialog.getByRole('button', { name: '查看统计报表', exact: true }).click();
  await expect(dialog).toBeHidden();
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: /^消息中心，/ }).click();
    await dialog.getByRole('button', { name: /^通知 0，/ }).click();
    await dialog.getByRole('button', { name: '查看相关申请', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '资源审核', exact: true });
    await expect(detail.getByText('消息对应的申请', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/system-management$/);
    await detail.getByRole('button', { name: '取消', exact: true }).click();
  }
});

test('读取失败可重试，普通用户关联业务未迁移时不跳往管理员或占位页', async ({ page, messages }) => {
  messages.role = 'user';
  messages.failList = true;
  await openFiles(page);
  const dialog = page.getByRole('dialog', { name: '消息中心', exact: true });
  // 先等首轮失败，再等打开弹框触发的刷新，避免恢复接口与自动刷新竞争
  await expect(page.getByText('消息加载失败', { exact: true })).toBeAttached();
  const refresh = page.waitForResponse(response => response.url().endsWith('/api/message/list'));
  await page.getByRole('button', { name: /^消息中心，/ }).click();
  await refresh;
  await expect(dialog.getByText('消息加载失败', { exact: true })).toBeVisible();
  messages.failList = false;
  await dialog.getByRole('button', { name: '重新加载', exact: true }).click();
  await dialog.getByRole('button', { name: /^通知 0，/ }).click();
  await expect(dialog.getByText('用户侧关联业务尚未迁移', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '查看相关申请', exact: true })).toBeDisabled();
  await expect(page).toHaveURL(/\/file-management$/);
});
