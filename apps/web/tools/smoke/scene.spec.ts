import type { Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';
import { roomB3dm, roomManifest, roomTileset } from './scene-model.ts';

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

// 三维的产物装配（3D.5c，ADR 0065 的范围）：动态加载的 map-cesium 分块、复制到 cesium/ 的 Worker 和资源、
// 3D Tiles 的加载、导航网格的 Worker 分块；步行只为确认 Worker 能在产物里加载和构建，不测业务细节
test('三维：二维稳定后预加载运行时，切到三维、加载模型、步行进站，回到二维复用画布', async ({ context, page }) => {
  // 软件渲染下 Cesium 的启动和进站飞行都慢
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
    if (response.status() >= 400 && /^\/(cesium|assets)\//.test(pathname)) {
      failed.push(`${response.status()} ${pathname}`);
    }
  });
  const wasRequested = (pattern: RegExp) => [...requested].some(path => pattern.test(path));

  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/current-map$/);
  await measured(page, 'login-to-map:settled', 45_000);
  // 二维第一次画面稳定以后，浏览器空闲时预加载三维运行时（ADR 0091）：点"三维"之前就请求了 map-cesium 的分块
  await expect.poll(() => wasRequested(/\/assets\/map-cesium-[\w-]+\.js$/)).toBe(true);
  const flatCanvas = page.locator('.maplibregl-canvas');
  const original = await flatCanvas.elementHandle();
  if (!original) {
    throw new Error('没有二维画布');
  }

  try {
    await page.getByRole('button', { name: '三维', exact: true }).click();
    await measured(page, 'switch-to-3d:settled', 60_000);
    await expect(page.locator('.cesium-widget canvas')).toBeVisible();
    await expect(page.locator('[data-map-status]')).toHaveCount(0);

    // 勾选生成的屋子，加载好以后定位：地下的模型进入钻地
    await page.locator('[data-model="smoke-room"] .el-checkbox').click();
    const loaded = page.locator('[data-loaded="smoke-room"]');
    const locate = loaded.getByRole('button', { name: '定位', exact: true });
    await expect(locate).toBeEnabled({ timeout: 60_000 });
    await locate.click();
    await expect(page.locator('[data-underground-bar]')).toBeVisible();

    // 步行：导航网格在 Worker 里构建（产物里单独的分块），建好后飞进屋子
    await loaded.getByRole('button', { name: '步行漫游', exact: true }).click();
    const bar = page.locator('[data-roam-bar]');
    await expect(bar.getByRole('button', { name: '回到起始点', exact: true })).toBeVisible({ timeout: 90_000 });
    expect(wasRequested(/\/assets\/nav-grid\.worker-[\w-]+\.js$/), '导航网格的 Worker 分块').toBe(true);
    await expect(page.locator('[data-map-status-bar]')).toContainText('第一视角');
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);

    // 回到二维：复用原来的画布
    await page.getByRole('button', { name: '二维', exact: true }).click();
    await expect(flatCanvas).toBeVisible();
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    expect(wasRequested(/^\/cesium\/Workers\//), 'Cesium 的 Worker 脚本').toBe(true);
    expect(failed, 'cesium/、assets/ 的文件都要拿到').toEqual([]);
  } finally {
    await original.dispose();
  }
});
