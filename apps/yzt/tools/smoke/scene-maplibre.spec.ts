import { fileURLToPath } from 'node:url';
import type { Locator, Page } from 'playwright/test';
import { loadEnv } from 'vite';
import { expect, test } from './fixtures.ts';
import { roomB3dm, roomManifest, roomTileset } from './scene-model.ts';

// MapLibre 引擎的三维（ADR 0147 3C.2、3C.3）：只在 VITE_MAP_3D_ENGINE=maplibre 构建的产物上运行，CI 在那次构建之后单独跑这个文件
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const engine = loadEnv('intranet', appRoot, 'VITE_').VITE_MAP_3D_ENGINE;

// 静态底图陆地的颜色（src/shared/map/basemap/static-palette.ts），同 static-basemap.spec.ts；冒烟不导入应用源码
const LAND_COLORS = [
  [0xf3, 0xf1, 0xe9],
  [0xee, 0xf1, 0xe7],
  [0xf2, 0xed, 0xe6],
  [0xeb, 0xf0, 0xeb]
];
const TOLERANCE = 3;
const MIN_LAND_SHARE = 0.05;

/** 通过真实登录表单提交，只替换接口响应 */
async function login(page: Page): Promise<void> {
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

/** 等一轮加载标记的某个步骤（docs/modules/perf.md）；等不到时以断言失败，说明是哪一步 */
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

/** 画布的截图里静态底图陆地的像素占比：二维样式的图层在三维里实际画出来了 */
async function landShare(page: Page, canvas: Locator): Promise<number> {
  const png = (await canvas.screenshot()).toString('base64');
  const input = JSON.stringify({ png, colors: LAND_COLORS, tolerance: TOLERANCE });
  return page.evaluate<number>(`(${SHARE_OF_COLORS})(${input})`);
}

test.skip(engine !== 'maplibre', '只在 VITE_MAP_3D_ENGINE=maplibre 构建的产物上运行');

// 产物装配：动态加载的 map-three 分块、预加载、一块画布担任二三维；静态底图、测距、坐标定位的位置点、三维模型在三维里可用；
// 步行进站只为确认导航网格的 Worker 在产物里能加载、构建，抬高后能进出，不测业务细节
test('MapLibre 引擎的三维：二维稳定后预加载三维模块，切到三维还是同一块画布，底图、测距、位置点、模型、步行都可用', async ({
  context,
  page
}) => {
  // 软件渲染下三维的瓦片和模型都慢
  test.setTimeout(180_000);
  // 清单换成生成的屋子：模型数据不入库，CI 里也没有
  await context.route('**/3dt/manifest.json', route => route.fulfill({ json: roomManifest() }));
  await context.route('**/3dt/smoke-room/tileset.json', route => route.fulfill({ json: roomTileset() }));
  await context.route('**/3dt/smoke-room/room.b3dm', route =>
    route.fulfill({ body: roomB3dm(), contentType: 'application/octet-stream' })
  );
  const requested = new Set<string>();
  const failed: string[] = [];
  page.on('request', request => requested.add(new URL(request.url()).pathname));
  page.on('response', response => {
    const { pathname } = new URL(response.url());
    if (response.status() >= 400 && pathname.startsWith('/assets/')) {
      failed.push(`${response.status()} ${pathname}`);
    }
  });
  const wasRequested = (pattern: RegExp) => [...requested].some(path => pattern.test(path));

  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/current-map$/);
  await measured(page, 'login-to-map:settled', 45_000);
  // 二维第一次画面稳定以后，浏览器空闲时预加载三维模块（ADR 0091 的做法）：点"三维"之前就请求了 map-three 的分块
  await expect.poll(() => wasRequested(/\/assets\/map-three-[\w-]+\.js$/), { message: '预加载 map-three' }).toBe(true);
  const flat = page.locator('.maplibregl-canvas');
  const original = await flat.elementHandle();
  if (!original) {
    throw new Error('没有 MapLibre 的画布');
  }

  try {
    await page.getByRole('button', { name: '三维', exact: true }).click();
    await measured(page, 'switch-to-3d:settled', 60_000);
    await expect(page.locator('[data-map-status]')).toHaveCount(0);
    // 同一块画布担任三维，没有 Cesium（ADR 0147 第 2 节）
    await expect(page.locator('.cesium-widget')).toHaveCount(0);
    await expect(flat).toBeVisible();
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    // 二维样式的图层（这里是静态底图）在三维里照样画出来
    await expect
      .poll(() => landShare(page, flat), { message: '三维画出静态底图的陆地', timeout: 60_000 })
      .toBeGreaterThan(MIN_LAND_SHARE);

    // 测距：在画布中间点两下、双击结束，得到一条可以删除的测量
    await page.getByRole('button', { name: '测距', exact: true }).click();
    const box = await flat.boundingBox();
    if (!box) {
      throw new Error('量不到画布');
    }
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(middle.x - 120, middle.y);
    await page.mouse.click(middle.x + 120, middle.y);
    await page.mouse.dblclick(middle.x + 120, middle.y + 80);
    await expect(page.locator('[data-measure-overlay]').getByRole('button', { name: '删除这条测量' })).toHaveCount(1);
    await page.getByRole('button', { name: '移动', exact: true }).click();

    // 坐标定位：位置点的卡片按三维的投影摆在地图上
    await page.getByRole('button', { name: '坐标定位', exact: true }).click();
    await page.getByRole('textbox', { name: '经度' }).fill('1203936');
    await page.getByRole('textbox', { name: '纬度' }).fill('311836');
    await page.getByRole('button', { name: '定位', exact: true }).click();
    // 图钉本身是 0×0 的锚点，尖端在位置点上：按三维的投影摆在画布里，点它的图标打开位置信息的卡片
    const pin = page.getByRole('button', { name: '坐标定位点', exact: true });
    await expect(pin).toHaveCount(1, { timeout: 30_000 });
    const tip = await pin.boundingBox();
    if (!tip) {
      throw new Error('量不到图钉');
    }
    expect(tip.x).toBeGreaterThan(box.x);
    expect(tip.x).toBeLessThan(box.x + box.width);
    expect(tip.y).toBeGreaterThan(box.y);
    expect(tip.y).toBeLessThan(box.y + box.height);
    await pin.locator('svg').last().click();
    await expect(page.locator('[data-location-info]')).toBeVisible();

    // 勾选生成的屋子，加载好以后定位
    await page.locator('[data-model="smoke-room"] .el-checkbox').click();
    const loaded = page.locator('[data-loaded="smoke-room"]');
    const locate = loaded.getByRole('button', { name: '定位', exact: true });
    await expect(locate).toBeEnabled({ timeout: 60_000 });
    await locate.click();
    await expect(page.locator('[data-map-status]')).toHaveCount(0);

    // 已加载里的"漫游"：有出生点的从步行开始，地下的屋子抬高，黑幕下进站（ADR 0147 第 4 节）；退出时同样回到地面
    await loaded.getByRole('button', { name: '漫游', exact: true }).click();
    const bar = page.locator('[data-roam-panel]');
    await expect(bar.getByRole('button', { name: '回到起始点', exact: true })).toBeVisible({ timeout: 90_000 });
    expect(wasRequested(/\/assets\/nav-grid\.worker-[\w-]+\.js$/), '导航网格的 Worker 分块').toBe(true);
    await expect(page.locator('[data-map-status-bar]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('button', { name: '二维', exact: true })).toBeVisible({ timeout: 30_000 });

    // 回到二维：还是同一块画布
    await page.getByRole('button', { name: '二维', exact: true }).click({ timeout: 60_000 });
    await expect(flat).toBeVisible();
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    expect(wasRequested(/^\/cesium\//), '不请求 Cesium 的运行时文件').toBe(false);
    expect(wasRequested(/\/assets\/map-cesium-[\w-]+\.js$/), '不请求 map-cesium 的分块').toBe(false);
    expect(failed, 'assets/ 的文件都要拿到').toEqual([]);
  } finally {
    await original.dispose();
  }
});
