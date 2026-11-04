import type { Locator, Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';

// 静态底图各市的颜色（src/shared/map/basemap/static-palette.ts）；冒烟不导入应用源码，这里按值比较
const LAND_COLORS = [
  [0xf7, 0xf3, 0xe6],
  [0xf0, 0xf3, 0xe4],
  [0xf6, 0xee, 0xe3],
  [0xec, 0xf2, 0xe9]
];
// 三维贴地的面经过混合，比较时留一点余量
const TOLERANCE = 3;
// 默认视角下全省占画面的比例远大于它；没有画面时是 0
const MIN_LAND_SHARE = 0.05;

/** 通过真实登录表单提交，只替换接口响应 */
async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

async function measured(page: Page, name: string, timeout: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(entry => performance.getEntriesByName(entry, 'measure').length > 0, name), {
      message: `等到 ${name}`,
      timeout
    })
    .toBe(true);
}

// 在页面里解码截图并统计像素：工具的类型环境没有 DOM，这段写成字符串交给浏览器执行
const SHARE_OF_COLORS = `async ({ png, colors, tolerance }) => {
  const image = new Image();
  image.src = 'data:image/png;base64,' + png;
  await image.decode();
  const buffer = document.createElement('canvas');
  buffer.width = image.width;
  buffer.height = image.height;
  const context = buffer.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, buffer.width, buffer.height);
  let matched = 0;
  for (let i = 0; i < data.length; i += 4) {
    const near = colors.some(
      ([r, g, b]) =>
        Math.abs(data[i] - r) <= tolerance &&
        Math.abs(data[i + 1] - g) <= tolerance &&
        Math.abs(data[i + 2] - b) <= tolerance
    );
    matched += near ? 1 : 0;
  }
  return matched / (data.length / 4);
}`;

/** 画布的截图里静态底图配色的像素占比：真实引擎在产物里实际画出来的结果 */
async function landShare(page: Page, canvas: Locator): Promise<number> {
  const png = (await canvas.screenshot()).toString('base64');
  const input = JSON.stringify({ png, colors: LAND_COLORS, tolerance: TOLERANCE });
  return page.evaluate<number>(`(${SHARE_OF_COLORS})(${input})`);
}

// 内网默认的静态底图（ADR 0133）：全部来自产物，不请求字形和公网（公网由 fixtures 拦下并判失败）
test('静态底图：内网默认选中，二三维都画得出来，能一键切到无底图再切回', async ({ page }) => {
  // 软件渲染下 Cesium 的启动慢
  test.setTimeout(180_000);
  const requested: string[] = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname));

  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/current-map$/);
  await measured(page, 'login-to-map:settled', 45_000);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);

  const flat = page.locator('.maplibregl-canvas');
  const card = page.locator('button[aria-label^="底图："]');
  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');
  await expect.poll(() => landShare(page, flat), { message: '二维画出各市的面' }).toBeGreaterThan(MIN_LAND_SHARE);

  await card.click();
  const staticOption = page.getByRole('button', { name: '静态底图', exact: true });
  const noneOption = page.getByRole('button', { name: '无底图', exact: true });
  await expect(staticOption).toHaveAttribute('aria-pressed', 'true');
  await noneOption.click();
  await expect(card).toHaveAttribute('aria-label', '底图：无底图');
  await expect.poll(() => landShare(page, flat), { message: '无底图时没有各市的面' }).toBe(0);
  await staticOption.click();
  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');
  await expect.poll(() => landShare(page, flat), { message: '切回后又画出来' }).toBeGreaterThan(MIN_LAND_SHARE);
  await card.click();

  await page.getByRole('button', { name: '三维', exact: true }).click();
  await measured(page, 'switch-to-3d:settled', 60_000);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');
  const globe = page.locator('.cesium-widget canvas').first();
  await expect
    .poll(() => landShare(page, globe), { message: '三维画出各市的面', timeout: 60_000 })
    .toBeGreaterThan(MIN_LAND_SHARE);
  await page.getByRole('button', { name: '二维', exact: true }).click();
  await expect(flat).toBeVisible();

  expect(requested.filter(path => path.includes('/glyphs/')), '地名只有汉字，不请求字形').toEqual([]);
  expect(requested.some(path => /\/assets\/jiangsu-labels-[\w-]+\.json$/.test(path)), '地名点随产物发布').toBe(true);
});
