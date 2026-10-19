import { readdirSync } from 'node:fs';
import type { Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';

/** 通过真实登录表单提交，只替换接口响应 */
async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

/** 就绪取自视图状态，不能用延迟出现的“加载中”是否隐藏判断 */
async function readyMap(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/current-map$/);
  await expect(page.locator('[data-map-view-state]')).toHaveAttribute('data-map-view-state', 'ready');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('[data-map-status]')).toHaveCount(0);
}

/** 找到实际的生产分块，避免写死内容哈希或请求顺序 */
function chunkFile(prefix: string): string {
  const files = readdirSync(new URL('../../dist/assets/', import.meta.url));
  const matches = files.filter(name => name.startsWith(`${prefix}-`) && name.endsWith('.js'));
  expect(matches, `应有唯一的 ${prefix} 生产分块`).toHaveLength(1);
  return matches[0]!;
}

test('登录到地图，切页期间改变尺寸，返回后复用画布并保留状态', async ({ page }) => {
  await page.goto('/login');
  await login(page);
  await readyMap(page);
  // 首次画面稳定由真实引擎的 idle 标记；不使用固定延时或毫秒性能门槛
  await page.waitForFunction(() => performance.getEntriesByName('login-to-map:settled', 'measure').length > 0);
  await page.getByRole('button', { name: '区划定位', exact: true }).click();
  const search = page.getByPlaceholder('搜索市、区/县');
  await search.fill('南京');
  await expect(page.locator('[data-region-locate-panel]')).toContainText('南京市');

  const level = page.getByRole('status', { name: /^当前层级/ });
  const before = await level.getAttribute('aria-label');
  const precise = Number(before?.match(/（([\d.]+)）/)?.[1]);
  expect(Number.isFinite(precise)).toBe(true);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(level).toHaveAttribute('aria-label', new RegExp(`（${(precise + 1).toFixed(1).replace('.', '\\.')}）$`));
  const savedLevel = await level.getAttribute('aria-label');
  const canvas = page.locator('.maplibregl-canvas');
  const original = await canvas.elementHandle();
  expect(original).not.toBeNull();
  try {
    await page.getByRole('link', { name: '文件管理', exact: true }).click();
    await expect(page).toHaveURL(/\/file-management$/);
    await expect(page.getByRole('button', { name: '上传文档', exact: true })).toBeVisible();
    // KeepAlive 将旧画布移出文档；只检查新画布存在不足以发现意外重建
    expect(await original!.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(false);
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.getByRole('link', { name: '现状底图', exact: true }).click();
    await readyMap(page);
    expect(await original!.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    await expect(search).toHaveValue('南京');
    await expect(level).toHaveAttribute('aria-label', savedLevel!);
    // 设备比例为 1，绘图缓冲区应随恢复后的 CSS 尺寸调整
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      if (!box || box.width <= 0 || box.height <= 0) {
        return false;
      }
      const width = Number(await canvas.getAttribute('width'));
      const height = Number(await canvas.getAttribute('height'));
      return Math.abs(width - box.width) <= 1 && Math.abs(height - box.height) <= 1;
    }).toBe(true);
  } finally {
    await original?.dispose();
  }
});

for (const prefix of ['LoginPage', 'CurrentMapPage', 'map-runtime']) {
  test(`${prefix} 加载失败只显示一份提示，重复失败后可刷新恢复`, async ({ context, page }) => {
    let blocked = true;
    let injected = 0;
    const file = chunkFile(prefix);
    await context.route(`**/assets/${file}`, async route => {
      if (!blocked) {
        await route.fallback();
        return;
      }
      injected++;
      // 模拟分块执行失败；ES 模块会缓存失败，原地重试仍失败，需要刷新当前文档
      await route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("smoke-load-failure");' });
    });
    await page.goto('/login');
    if (prefix !== 'LoginPage') {
      await login(page);
    }
    const notice = page.getByRole('dialog', { name: '页面加载失败', exact: true });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(1);
    expect(injected).toBeGreaterThan(0);
    const retry = notice.getByRole('button', { name: '重试', exact: true });
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(1);
    blocked = false;
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      notice.getByRole('button', { name: '刷新页面', exact: true }).click()
    ]);
    if (prefix === 'LoginPage') {
      await login(page);
    }
    await readyMap(page);
    await expect(notice).toHaveCount(0);
  });
}
