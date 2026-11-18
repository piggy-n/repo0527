import { readFile } from 'node:fs/promises';
import type { Download, Page } from 'playwright/test';
import { CURRENT_MAP_URL, expect, test } from './fixtures.ts';

// 软件渲染时装饰动画让导出排队十几秒（docs/modules/city-dashboard.md），入场由浏览器测试覆盖
test.use({ reducedMotion: 'reduce' });

async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(CURRENT_MAP_URL);
}

// PNG 编码可解码且宽高非零，覆盖空白画布和下载生命周期
async function expectPng(download: Download): Promise<void> {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(300);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(300);
  expect(bytes.byteLength).toBeGreaterThan(10000);
}

test('综合分析驾驶舱需登录、独立懒加载，切换一级后地图和卡片跟着变，地图和雷达图可导出', async ({ page }) => {
  test.setTimeout(90000);
  // 字体不入库，固定复现 Linux CI 及未部署字体的环境
  await page.route('**/fonts/**', route => route.fulfill({ status: 404, body: '' }));
  const scripts: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') {
      scripts.push(request.url());
    }
  });
  const loaded = (chunk: string) => scripts.some(url => url.includes(`${chunk}-`));
  await page.goto('/land-space-analysis');
  await expect(page).toHaveURL(/\/login/);
  expect(loaded('LandSpaceDashboardPage')).toBe(false);
  await login(page);
  await expect(page.locator('[data-map-view-state]')).toHaveAttribute('data-map-view-state', 'ready');
  expect(loaded('LandSpaceDashboardPage')).toBe(false);
  await page.goto('/land-space-analysis');
  await expect(page.locator('[data-state]')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('江苏省城市国土空间监测综合分析');
  await expect(page.getByRole('link', { name: '现状底图', exact: true })).toHaveCount(0);
  expect(loaded('LandSpaceDashboardPage')).toBe(true);
  expect(loaded('CityDashboardPage')).toBe(false);

  const mapTitle = page.locator('[aria-label="江苏省当前指标分布地图"] h2');
  await expect(mapTitle).toHaveText('2025年江苏省教育便利性分布图');
  // 标签只写名称；指北针在，三维场景算出比例后有比例尺
  await expect(page.getByRole('button', { name: '南京市，查看详情', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '指北针', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /^比例尺，全长/ })).toBeVisible();

  await page.getByRole('button', { name: '交通网络通达性', exact: true }).click();
  await expect(mapTitle).toHaveText('2025年江苏省城市内部交通设施覆盖水平分布图');
  await expect(page.getByRole('heading', { level: 3, name: '交通网络通达性', exact: true })).toBeVisible();

  async function download(name: string): Promise<void> {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    await expectPng(await waiting);
  }
  await download('下载当前地图');
  await download('下载交通网络通达性图表');
  // 二级卡默认是雷达
  const radar = page.getByRole('button', { name: '城市内部交通设施覆盖水平显示为雷达图', exact: true });
  await expect(radar).toHaveAttribute('aria-pressed', 'true');
  await download('下载城市内部交通设施覆盖水平图表');
});

test.describe('综合分析驾驶舱的窄屏', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });

  test('窄屏不横向溢出，右栏放得下三张卡', async ({ page }) => {
    await page.goto('/login');
    await login(page);
    await page.goto('/land-space-analysis');
    await expect(page.locator('[data-dashboard-phase]')).toHaveAttribute('data-dashboard-phase', 'ready');
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    const fits = await page.locator('[data-card-list]').evaluate((element: unknown) => {
      const list = element as { scrollHeight: number; clientHeight: number };
      return list.scrollHeight <= list.clientHeight + 1;
    });
    expect(fits).toBe(true);
  });
});
