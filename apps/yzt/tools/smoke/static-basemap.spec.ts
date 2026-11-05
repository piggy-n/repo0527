import type { Locator, Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';

// 静态底图陆地的颜色（src/shared/map/basemap/static-palette.ts）；冒烟不导入应用源码，这里按值比较。
// 四种都算上，分色开关打开时不用改这里
const LAND_COLORS = [
  [0xf3, 0xf1, 0xe9],
  [0xee, 0xf1, 0xe7],
  [0xf2, 0xed, 0xe6],
  [0xeb, 0xf0, 0xeb]
];
// 三维贴地的面经过混合，比较时留一点余量
const TOLERANCE = 3;
// 默认视角下全省占画面的比例远大于它；没有陆地时只有面板文字的边缘偶尔碰上，远小于它
const MIN_LAND_SHARE = 0.05;
// 市名的颜色（src/shared/map/basemap/static-basemap.ts）。笔画细，抗锯齿后很少有像素正好是这个颜色，所以容差放大到"深色文字"；
// 画布上还浮着面板的文字，不能和 0 比，比较地名出现前后的差值。十几个市名占的比例大于它
const CITY_LABEL_COLOR = [[0x37, 0x41, 0x51]];
const LABEL_TOLERANCE = 60;
const MIN_LABEL_SHARE = 0.0002;

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
async function colorShare(
  page: Page,
  canvas: Locator,
  colors: readonly (readonly number[])[],
  tolerance: number
): Promise<number> {
  const png = (await canvas.screenshot()).toString('base64');
  const input = JSON.stringify({ png, colors, tolerance });
  return page.evaluate<number>(`(${SHARE_OF_COLORS})(${input})`);
}

const landShare = (page: Page, canvas: Locator) => colorShare(page, canvas, LAND_COLORS, TOLERANCE);
const textShare = (page: Page, canvas: Locator) => colorShare(page, canvas, CITY_LABEL_COLOR, LABEL_TOLERANCE);

// 内网默认的静态底图（ADR 0133、0134）：全部来自产物，不请求字形和公网（公网由 fixtures 拦下并判失败）
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
  await expect.poll(() => landShare(page, flat), { message: '二维画出陆地的面' }).toBeGreaterThan(MIN_LAND_SHARE);

  await card.click();
  const staticOption = page.getByRole('button', { name: '静态底图', exact: true });
  const noneOption = page.getByRole('button', { name: '无底图', exact: true });
  await expect(staticOption).toHaveAttribute('aria-pressed', 'true');
  await noneOption.click();
  await expect(card).toHaveAttribute('aria-label', '底图：无底图');
  await expect(noneOption, '选了底图就关闭').toHaveCount(0);
  await expect.poll(() => landShare(page, flat), { message: '无底图时没有陆地的面' }).toBeLessThan(MIN_LAND_SHARE);
  await card.click();
  await staticOption.click();
  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');
  await expect.poll(() => landShare(page, flat), { message: '切回后又画出来' }).toBeGreaterThan(MIN_LAND_SHARE);

  await page.getByRole('button', { name: '三维', exact: true }).click();
  await measured(page, 'switch-to-3d:settled', 60_000);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);
  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');
  const globe = page.locator('.cesium-widget canvas').first();
  await expect
    .poll(() => landShare(page, globe), { message: '三维画出陆地的面', timeout: 60_000 })
    .toBeGreaterThan(MIN_LAND_SHARE);
  await page.getByRole('button', { name: '二维', exact: true }).click();
  await expect(flat).toBeVisible();

  expect(requested.filter(path => path.includes('/glyphs/')), '不请求字形').toEqual([]);
});

// 地名默认关闭，在页面上打开（ADR 0146）；二维 MapLibre 用本地字体画，三维 Cesium 用画布写字
test('静态底图的标注：默认关闭、不下载，打开后二三维都画出地名，不请求字形', async ({ page }) => {
  test.setTimeout(180_000);
  const requested: string[] = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  const labelsRequested = () => requested.some(path => path.includes('jiangsu-labels'));

  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/current-map$/);
  await measured(page, 'login-to-map:settled', 45_000);
  const flat = page.locator('.maplibregl-canvas');
  const card = page.locator('button[aria-label^="底图："]');
  expect(labelsRequested(), '关着时不下载地名').toBe(false);
  const withoutLabels = await textShare(page, flat);

  await card.click();
  await page.getByRole('button', { name: '调整标注和透明度' }).click();
  const labels = page.getByRole('switch', { name: '底图标注' });
  await expect(labels).toHaveAttribute('aria-checked', 'false');
  await labels.locator('..').click();
  await expect.poll(() => labelsRequested(), { message: '打开后下载地名' }).toBe(true);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(labels, 'Esc 关闭面板').toHaveCount(0);
  await expect
    .poll(async () => (await textShare(page, flat)) - withoutLabels, { message: '二维画出地名' })
    .toBeGreaterThan(MIN_LABEL_SHARE);

  await page.getByRole('button', { name: '三维', exact: true }).click();
  await measured(page, 'switch-to-3d:settled', 60_000);
  await expect(page.locator('[data-map-status]')).toHaveCount(0);
  const globe = page.locator('.cesium-widget canvas').first();
  // 先等三维画稳：记下有地名时的比例，关掉后比较差值
  await expect(globe).toBeVisible();
  await expect.poll(() => landShare(page, globe), { timeout: 60_000 }).toBeGreaterThan(MIN_LAND_SHARE);
  await page.waitForTimeout(5000);
  const withLabels = await textShare(page, globe);

  await card.click();
  await page.getByRole('button', { name: '调整标注和透明度' }).click();
  await labels.locator('..').click();
  await page.keyboard.press('Escape');
  await expect(labels).toHaveCount(0);
  await expect
    .poll(async () => withLabels - (await textShare(page, globe)), { message: '三维画过地名，关掉后没有了', timeout: 60_000 })
    .toBeGreaterThan(MIN_LABEL_SHARE);

  expect(requested.filter(path => path.includes('/glyphs/')), '不请求字形').toEqual([]);
});
