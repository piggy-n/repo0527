import type { Locator, Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';
import { roomB3dm, roomManifest, roomTileset, splatFiles } from './scene-model.ts';

// 静态底图陆地的颜色（src/shared/map/basemap/static-palette.ts），同 static-basemap.spec.ts；冒烟不导入应用源码
const LAND_COLORS = [[0xf3, 0xf1, 0xe9]];
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

// 生成的高斯泼溅是绿色的（scene-model.ts）：截图里明显偏绿的像素占比
const GREEN_SHARE = `async ({ png }) => {
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
    matched += data[i + 1] > 120 && data[i + 1] > data[i] * 1.6 && data[i + 1] > data[i + 2] * 1.6 ? 1 : 0;
  }
  return matched / (data.length / 4);
}`;

async function greenShare(page: Page, canvas: Locator): Promise<number> {
  const png = (await canvas.screenshot()).toString('base64');
  return page.evaluate<number>(`(${GREEN_SHARE})(${JSON.stringify({ png })})`);
}

// 三维的产物装配（ADR 0065 的范围、ADR 0147）：动态加载的 map-three 分块、预加载、一块画布担任二三维；静态底图、测距、
// 坐标定位的位置点、三维模型在三维里可用；步行进站、进泼溅只为确认导航网格的 Worker 在产物里能加载、构建（瓦片和碰撞网格两条路），
// 抬高后能进出，不测业务细节
test('三维：二维稳定后预加载三维模块，切到三维还是同一块画布，底图、测距、位置点、模型、步行都可用', async ({
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
  // 高斯泼溅的索引和数据块（数据块由库的 Worker 下载）；不支持 Range，整个文件给出，库照样能用
  const splats = splatFiles();
  await context.route(
    url => url.pathname.startsWith('/3dt/') && splats.has(url.pathname.slice('/3dt/'.length)),
    route => {
      const body = splats.get(new URL(route.request().url()).pathname.slice('/3dt/'.length));
      return body ? route.fulfill({ body, contentType: 'application/octet-stream' }) : route.fallback();
    }
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
    // 同一块画布担任三维（ADR 0147 第 2 节）
    await expect(flat).toBeVisible();
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    // 二维样式的图层（这里是静态底图）在三维里照样画出来
    await expect
      .poll(() => landShare(page, flat), { message: '三维画出静态底图的陆地', timeout: 60_000 })
      .toBeGreaterThan(MIN_LAND_SHARE);
    // 三维里照常显示资源图层（ADR 0157）：图例和二维一样，没有"三维里不显示"的说明
    const legend = page.getByRole('button', { name: '图例', exact: true });
    await legend.click();
    const legendPanel = page.locator('[data-panel-group]');
    await expect(legendPanel).toContainText('图例');
    await expect(legendPanel).not.toContainText('三维模式暂不显示资源图层');
    await expect(page.locator('[data-legend-scene-note]')).toHaveCount(0);
    await legend.click();

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

    // 在资源目录里加入生成的屋子（ADR 0157）：展开全部、选中、点"添加"；新加的一行被选中，加载好以后用工具栏定位
    const addModel = async (id: string) => {
      await page.locator('[data-tool="expand-all"]').click();
      await page.locator(`[data-catalog-node="model:${id}"]`).click();
      await page.locator('[data-tool="add"]').click();
    };
    const locate = page.locator('[data-tool="locate"]');
    await addModel('smoke-room');
    const room = page.locator('[data-roam="smoke-room"]');
    await expect(room).toHaveAttribute('aria-disabled', 'false', { timeout: 60_000 });
    await locate.click();
    await expect(page.locator('[data-map-status]')).toHaveCount(0);

    // 当前图层里的"漫游"：有出生点的从步行开始，地下的屋子抬高，黑幕下进站（ADR 0147 第 4 节）；退出时同样回到地面
    await room.click();
    const bar = page.locator('[data-roam-panel]');
    await expect(bar.getByRole('button', { name: '回到起始点', exact: true })).toBeVisible({ timeout: 90_000 });
    expect(wasRequested(/\/assets\/nav-grid\.worker-[\w-]+\.js$/), '导航网格的 Worker 分块').toBe(true);
    // 漫游时没有状态栏和视图控件（ADR 0095、0097）
    await expect(page.locator('[data-map-status-bar]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '二维', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('button', { name: '二维', exact: true })).toBeVisible({ timeout: 30_000 });

    // 高斯泼溅（ADR 0149）：库是单独的分块，加入泼溅以前不下载；加载好以后定位，画出来
    // 分块按入口文件命名：gaussian-splat-lite.module-<hash>.js
    const splatChunk = /\/assets\/gaussian-splat-lite[\w.-]*\.js$/;
    expect(wasRequested(splatChunk), '加入泼溅以前不下载泼溅库').toBe(false);
    await addModel('smoke-splat');
    const splat = page.locator('[data-current-row="model:smoke-splat"]');
    await expect(splat.locator('[data-roam="smoke-splat"]')).toHaveAttribute('aria-disabled', 'false', {
      timeout: 60_000
    });
    // 泼溅里步行（ADR 0156）：碰撞网格在导航网格的 Worker 里建（buildScan），进去以后有小地图，叫法不是"站内"。
    // 退出时相机飞回开始前的位置，下面的定位作废这次飞行，之后的步骤都在退出以后
    await splat.locator('[data-roam="smoke-splat"]').click();
    await expect(bar.getByRole('button', { name: '回到起始点', exact: true })).toBeVisible({ timeout: 90_000 });
    expect(wasRequested(/\/3dt\/.+\/data\/mesh\/0\.ply$/), '碰撞网格经 /3dt/ 下载').toBe(true);
    await expect(page.getByRole('button', { name: '小地图，点击查看完整地图', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    // 退出漫游后面板原样回来，泼溅这一行还选中着
    await expect(splat).toHaveAttribute('aria-selected', 'true');
    await locate.click();
    // 底图里没有这种绿色：占比超过 0.5% 就是画出来了（斜着看，2026-11-10 实测约 1.7%）
    await expect
      .poll(() => greenShare(page, flat), { message: '画出绿色的泼溅', timeout: 60_000 })
      .toBeGreaterThan(0.005);
    expect(wasRequested(splatChunk), '泼溅库的分块').toBe(true);
    expect(wasRequested(/\/3dt\/.+\/data\/3dgs\/0\.ply$/), '数据块经 /3dt/ 下载').toBe(true);
    await splat.locator('button[aria-label^="移除："]').click();
    await expect(splat).toHaveCount(0);

    // 三维的缩放上限 20 级、二维 18 级（JIANGSU_SCENE_ZOOM_RANGE）：三维放大到头，切回二维时收回到 18 级
    const level = page.getByRole('status', { name: /^当前层级/ });
    const zoomIn = page.getByRole('button', { name: '放大', exact: true });
    // 每次重试可用就点一下：连点时目标级别累计，到 20 级按钮就不可用
    await expect(async () => {
      if (await zoomIn.isEnabled()) {
        await zoomIn.click();
      }
      await expect(zoomIn).toBeDisabled({ timeout: 100 });
    }).toPass({ timeout: 30_000 });
    await expect(level).toHaveAttribute('aria-label', '当前层级 20（20.0）', { timeout: 30_000 });

    // 回到二维：还是同一块画布
    await page.getByRole('button', { name: '二维', exact: true }).click({ timeout: 60_000 });
    await expect(level).toHaveAttribute('aria-label', '当前层级 18（18.0）');
    await expect(zoomIn).toBeDisabled();
    await expect(flat).toBeVisible();
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    expect(failed, 'assets/ 的文件都要拿到').toEqual([]);
  } finally {
    await original.dispose();
  }
});

// 三维的设备档位（ADR 0155）：发布目录带 scene-tier.json；上次崩溃的页面留下的标记在打开三维时被发现，降档、提示，能恢复。
// 冒烟的浏览器是软件渲染，auto 本来就是低档：这里只看产物里的检查、Worker、提示和设备上记的降档
test('三维降档：上次崩溃的页面留下标记，打开三维时提示，能恢复原来的画质', async ({ context, page, request }) => {
  test.setTimeout(120_000);
  const file = await request.get('/scene-tier.json');
  expect(await file.json()).toStrictEqual({ tier: 'auto' });
  // 崩溃的页面：标准档开着三维时被杀，标记留下，也没有 Worker 替它回答
  const crashed = JSON.stringify({ tier: 'standard', configured: 'auto', restored: false });
  await context.addInitScript({
    content: `localStorage.setItem('yzt.device.scene-tier:page:crashed', ${JSON.stringify(crashed)});`
  });
  const stored = async (key: string): Promise<unknown> => {
    const raw = await page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(key)})`);
    return raw === null ? null : JSON.parse(raw);
  };

  await page.goto('/login');
  await login(page);
  await expect(page).toHaveURL(/\/current-map$/);
  await measured(page, 'login-to-map:settled', 45_000);
  // 二维时不提示，也不问别的页面：崩溃检查等到真的打开三维
  await expect(page.locator('[data-map-status="scene-tier"]')).toHaveCount(0);
  expect(await stored('yzt.device.scene-tier:page:crashed')).not.toBeNull();

  await page.getByRole('button', { name: '三维', exact: true }).click();
  const notice = page.locator('[data-map-status="scene-tier"]');
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect(notice).toContainText('三维画质已自动降低');
  await expect(notice).toContainText('上次进入三维模式时页面发生崩溃');
  // 崩溃页面的键删掉了；按它的档位降一档，记在这台设备上
  expect(await stored('yzt.device.scene-tier:page:crashed')).toBeNull();
  expect(await stored('yzt.device.scene-tier:record')).toStrictEqual({
    configured: 'auto',
    cap: 'low',
    restorable: true,
    restoredBefore: false
  });

  await notice.getByRole('button', { name: '恢复原来的画质', exact: true }).click();
  await expect(notice).toHaveCount(0);
  expect(await stored('yzt.device.scene-tier:record')).toStrictEqual({
    configured: 'auto',
    cap: null,
    restorable: true,
    restoredBefore: true
  });
});
