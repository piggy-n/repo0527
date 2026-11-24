import type { Locator, Page } from 'playwright/test';
import { CURRENT_MAP_URL, expect, test } from './fixtures.ts';

/** 通过真实登录表单提交，只替换接口响应 */
async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

async function box(locator: Locator, name: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) {
    throw new Error(`量不到${name}`);
  }
  return found;
}

// 数据加载的明细（ADR 0158，用户 2026-11-23）：量的是左列里的面板本身（按内容定高，收起后是竖条），不是撑满高度的一列；
// 面板下面到状态栏放得下最高的明细（420）时在面板下方，放不下时在它右边，宽度同面板展开时。
// 样例目录只有几项，展开的面板矮：窗口高时在下方，压矮窗口后放不下、回到右边
test('数据加载的明细：面板下面放得下时在下方、放不下时在右边，和面板同宽；收起成竖条后在竖条下方', async ({ page }) => {
  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(CURRENT_MAP_URL);
  const panel = page.locator('[data-layer-panel]');
  const chip = page.locator('[data-request-chip]');
  const popover = page.locator('[data-request-popover]');
  await expect(panel.getByRole('heading', { name: '资源图层' })).toBeVisible();

  await chip.click();
  await expect(popover.getByRole('heading', { name: '数据加载' })).toBeVisible();
  await expect(popover).toHaveAttribute('data-request-side', 'below');
  const expanded = await box(panel, '面板');
  const below = await box(popover, '明细');
  expect(below.x, '和面板左对齐').toBeCloseTo(expanded.x, 0);
  expect(below.y, '顶边离面板 8').toBeCloseTo(expanded.y + expanded.height + 8, 0);
  expect(below.width, '和面板同宽').toBeCloseTo(expanded.width, 0);

  // 窗口变矮：面板下面放不下 420，开着的明细换到右边
  await page.setViewportSize({ width: 1600, height: 640 });
  await expect(popover).toHaveAttribute('data-request-side', 'beside');
  const short = await box(panel, '面板');
  const beside = await box(popover, '明细');
  expect(beside.x, '左边离面板右边 8').toBeCloseTo(short.x + short.width + 8, 0);
  expect(beside.width, '和面板同宽').toBeCloseTo(short.width, 0);
  expect(beside.y + beside.height, '底边在状态栏上方 8').toBeCloseTo((await box(chip, '状态按钮')).y - 8, 0);

  await page.setViewportSize({ width: 1600, height: 900 });
  await chip.click();
  await expect(popover).toHaveCount(0);
  await page.getByRole('button', { name: '收起资源图层' }).click();
  await expect(page.getByRole('button', { name: '展开资源图层' })).toBeVisible();
  const strip = await box(panel, '竖条');
  await chip.click();
  await expect(popover).toHaveAttribute('data-request-side', 'below');
  const underStrip = await box(popover, '明细');
  expect(underStrip.x, '和竖条左对齐').toBeCloseTo(strip.x, 0);
  expect(underStrip.y, '顶边离竖条 8').toBeCloseTo(strip.y + strip.height + 8, 0);
  expect(underStrip.width, '和面板展开时同宽').toBeCloseTo(expanded.width, 0);
});
