import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright/test';
import { loadEnv } from 'vite';
import { CURRENT_MAP_URL, expect, test } from './fixtures.ts';

// 静态底图陆地的颜色（src/shared/map/basemap/static-palette.ts）；冒烟不导入应用源码，这里按值比较
const LAND = [0xf3, 0xf1, 0xe9];
const TOLERANCE = 3;
// 默认视角下全省占画面的比例远大于它
const MIN_LAND_SHARE = 0.05;
// 图例在右侧一栏时一列的宽度（src/shared/map/print/print-legend.ts）
const LEGEND_COLUMN = 232;
// 标题在顶部一栏时这一栏的高度（src/shared/map/print/print-image.ts 的 TITLE_METRICS）
const TITLE_BAR = 56;
// 默认标题是系统名：和内网构建读同一份配置（用户 2026-11-25）
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const SYSTEM_TITLE = loadEnv('intranet', appRoot, 'VITE_').VITE_APP_TITLE;

/** 通过真实登录表单提交，只替换接口响应 */
async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

// PNG 的宽高在 IHDR 里：第 16～23 字节，大端
function pngSize(bytes: Buffer): readonly [number, number] {
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

// 在页面里解码图片：统计顶部 top 像素以下、左边 width 像素里陆地颜色的占比，和顶部这一栏里深色（字）的像素有多少。
// 工具的类型环境没有 DOM，这段写成字符串交给浏览器执行
const LAND_SHARE = `async ({ png, width, top, color, tolerance }) => {
  const image = new Image();
  image.src = 'data:image/png;base64,' + png;
  await image.decode();
  const buffer = document.createElement('canvas');
  buffer.width = image.width;
  buffer.height = image.height;
  const context = buffer.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, top, width, buffer.height - top);
  let matched = 0;
  for (let i = 0; i < data.length; i += 4) {
    matched += color.every((value, channel) => Math.abs(data[i + channel] - value) <= tolerance) ? 1 : 0;
  }
  const header = context.getImageData(0, 0, buffer.width, top).data;
  let dark = 0;
  for (let i = 0; i < header.length; i += 4) {
    dark += header[i] < 120 && header[i + 1] < 120 && header[i + 2] < 120 ? 1 : 0;
  }
  return { land: matched / (data.length / 4), dark };
}`;

// 地图打印（ADR 0174）：产物里的真实引擎截图、合成、下载；默认视角下只有静态底图和省界，图例在右侧一栏
test('地图打印：浮层里有预览，点开看大图；导出的 PNG 是顶部一栏的标题、地图加右侧一栏的图例，文件名带时间', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(CURRENT_MAP_URL);
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName('login-to-map:settled', 'measure').length > 0), {
      message: '等到地图第一次稳定',
      timeout: 45_000
    })
    .toBe(true);
  const canvas = page.locator('.maplibregl-canvas');
  const mapBox = await canvas.boundingBox();
  if (mapBox === null) {
    throw new Error('量不到地图画布');
  }

  const entry = page.getByRole('button', { name: '地图打印', exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  const panel = page.locator('[data-map-print]');
  const pixels = `${Math.round(mapBox.width + LEGEND_COLUMN)} × ${Math.round(mapBox.height + TITLE_BAR)} 像素`;
  await expect(panel.getByRole('textbox', { name: '标题' }), '默认标题是系统名').toHaveValue(SYSTEM_TITLE ?? '');
  await expect(panel.locator('[data-print-size]')).toHaveText(pixels);

  // 大图是导出的那张图；在大图里点按钮、按 Esc 只关大图，浮层还开着，焦点回到预览。先用 Tab 在大图里走一步：
  // 键盘操作过，大图的 FocusTrap 卸载时会把焦点放回打开前的元素（Chromium 清掉了生成时不能点的预览的焦点，是 body）
  const preview = panel.getByRole('button', { name: '查看打印预览的大图' });
  await preview.click();
  const viewer = page.locator('.el-image-viewer__wrapper');
  await expect(viewer.locator('[data-print-viewer-info]')).toHaveText(`打印预览：${pixels}`);
  await viewer.getByRole('button', { name: '放大' }).click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(panel, '关掉大图后浮层还开着').toBeVisible();
  await expect(preview, '关掉大图后焦点回到预览').toBeFocused();

  // 在大图里用键盘导出：存的就是这张图，浮层关掉，焦点回到入口
  await preview.click();
  const viewerSaved = page.waitForEvent('download');
  await viewer.getByRole('button', { name: '导出' }).focus();
  await page.keyboard.press('Enter');
  expect((await viewerSaved).suggestedFilename()).toMatch(/^现状底图-\d{8}-\d{6}\.png$/);
  await expect(panel, '大图里导出完关掉浮层').toHaveCount(0);
  await expect(entry, '导出后焦点回到入口').toBeFocused();

  await entry.click();
  await expect(panel.locator('[data-print-size]')).toHaveText(pixels);
  const waiting = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出', exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/^现状底图-\d{8}-\d{6}\.png$/);
  const path = await download.path();
  const bytes = await readFile(path);
  expect(pngSize(bytes)).toEqual([Math.round(mapBox.width + LEGEND_COLUMN), Math.round(mapBox.height + TITLE_BAR)]);

  const input = JSON.stringify({
    png: bytes.toString('base64'),
    width: Math.round(mapBox.width),
    top: TITLE_BAR,
    color: LAND,
    tolerance: TOLERANCE
  });
  const { land, dark } = await page.evaluate<{ land: number; dark: number }>(`(${LAND_SHARE})(${input})`);
  expect(land, '地图部分是静态底图的陆地').toBeGreaterThan(MIN_LAND_SHARE);
  expect(dark, '顶部一栏里写着标题').toBeGreaterThan(100);
  await expect(panel, '导出完关掉浮层').toHaveCount(0);
  // 登录成功的提示可能还在，按文字找；大图里导出的那一条可能也还在，看最后一条
  await expect(page.locator('.el-message', { hasText: '已导出 现状底图-' }).last()).toBeVisible();
});
