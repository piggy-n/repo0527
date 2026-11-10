import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from 'playwright/test';
import { loadEnv } from 'vite';
import { expect, test } from './fixtures.ts';

// 开关在构建时写进产物，这里和内网构建读同一份配置，验证产物实际的行为（ADR 0114、0140）
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const env = loadEnv('intranet', appRoot, 'VITE_');
const pageStateReset = env.VITE_PAGE_STATE_RESET === 'true';
const basemapPreference = env.VITE_PREFERENCES_ENABLED === 'true' && env.VITE_PREFERENCE_BASEMAP === 'true';
const labelsPreference = env.VITE_PREFERENCES_ENABLED === 'true' && env.VITE_PREFERENCE_BASEMAP_LABELS === 'true';

// 存着无底图（内网默认是静态底图）、和默认不同的透明度：恢复过、写入过都看得出来
const STORED_BASEMAP = { version: 2, value: { selected: 'none', opacity: { vector: 1, imagery: 1, static: 0.5 } } };

// 偏好的库名和仓库名（src/shared/storage/idb-store.ts）；冒烟不导入应用源码，工具的类型环境没有 DOM，这段写成字符串交给浏览器执行
const IN_PREFERENCE_STORE = `(mode, access) => new Promise((resolve, reject) => {
  const opening = indexedDB.open('yzt-preferences');
  opening.onupgradeneeded = () => opening.result.createObjectStore('preferences');
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const database = opening.result;
    const request = access(database.transaction('preferences', mode).objectStore('preferences'));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      database.close();
      resolve(request.result);
    };
  };
})`;

const readStoredBasemap = (page: Page) =>
  page.evaluate<unknown>(`(${IN_PREFERENCE_STORE})('readonly', store => store.get('smoke/basemap'))`);

const readStoredLabels = (page: Page) =>
  page.evaluate<unknown>(`(${IN_PREFERENCE_STORE})('readonly', store => store.get('smoke/basemap-labels'))`);

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
  // 名称后面只能是 8 位哈希（可能含 -）：map-runtime 不能匹配到 map-runtime-3d、map-runtime-provider
  const pattern = new RegExp(`^${prefix}-[\\w-]{8}\\.js$`);
  const matches = files.filter(name => pattern.test(name));
  expect(matches, `应有唯一的 ${prefix} 生产分块`).toHaveLength(1);
  return matches[0];
}

/** 登录到地图，打开区划定位并放大一级，返回切页后要比较的内容 */
async function openMapAndChangeState(page: Page) {
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
  const initialLevel = await level.getAttribute('aria-label');
  const precise = Number(initialLevel?.match(/（([\d.]+)）/)?.[1]);
  expect(Number.isFinite(precise)).toBe(true);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(level).toHaveAttribute('aria-label', new RegExp(`（${(precise + 1).toFixed(1).replace('.', '\\.')}）$`));
  const savedLevel = await level.getAttribute('aria-label');
  if (initialLevel === null || savedLevel === null) {
    throw new Error('当前层级没有无障碍名称');
  }
  const canvas = page.locator('.maplibregl-canvas');
  const original = await canvas.elementHandle();
  expect(original).not.toBeNull();
  return { search, level, initialLevel, savedLevel, canvas, original };
}

/** 切到文件管理页，等页面出现 */
async function leaveForFileManagement(page: Page): Promise<void> {
  await page.getByRole('link', { name: '文件管理', exact: true }).click();
  await expect(page).toHaveURL(/\/file-management$/);
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeVisible();
}

test('登录到地图，切页后返回是新的画布，回到初始状态（ADR 0114）', async ({ page }) => {
  test.skip(!pageStateReset, '这次构建关闭了离开页面后重置');
  const { search, level, initialLevel, original } = await openMapAndChangeState(page);
  try {
    await leaveForFileManagement(page);
    await page.getByRole('link', { name: '现状底图', exact: true }).click();
    await readyMap(page);
    // 旧画布不再回到文档；面板没有打开，层级回到进入时的默认视角
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(false);
    await expect(search).toHaveCount(0);
    await expect(level).toHaveAttribute('aria-label', initialLevel);
  } finally {
    await original?.dispose();
  }
});

test('登录到地图，切页期间改变尺寸，返回后复用画布并保留状态', async ({ page }) => {
  test.skip(pageStateReset, '这次构建打开了离开页面后重置，页面不缓存');
  const { search, level, savedLevel, canvas, original } = await openMapAndChangeState(page);
  try {
    await leaveForFileManagement(page);
    // KeepAlive 将旧画布移出文档；只检查新画布存在不足以发现意外重建
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(false);
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.getByRole('link', { name: '现状底图', exact: true }).click();
    await readyMap(page);
    expect(await original.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(true);
    await expect(search).toHaveValue('南京');
    await expect(level).toHaveAttribute('aria-label', savedLevel);
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

/** 登录前存好底图偏好，登录到地图、等画面稳定（这时读取早已结束），返回底图卡片 */
async function openMapWithStoredBasemap(page: Page) {
  await page.goto('/login');
  await page.evaluate(
    `(${IN_PREFERENCE_STORE})('readwrite', store => store.put(${JSON.stringify(STORED_BASEMAP)}, 'smoke/basemap'))`
  );
  await login(page);
  await readyMap(page);
  await page.waitForFunction(() => performance.getEntriesByName('login-to-map:settled', 'measure').length > 0);
  return page.locator('button[aria-label^="底图："]');
}

async function chooseBasemap(page: Page, card: Locator, name: string): Promise<void> {
  await card.click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(card).toHaveAttribute('aria-label', `底图：${name}`);
}

test('底图偏好关闭：存下的不读，换了也不写，旧数据保留（ADR 0140）', async ({ page }) => {
  test.skip(basemapPreference, '这次构建打开了底图偏好');
  const card = await openMapWithStoredBasemap(page);
  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');

  await chooseBasemap(page, card, '无底图');
  // 离开时立即写入还没写的那一次；页面缓存时没有卸载，由刷新的 pagehide 提交
  await leaveForFileManagement(page);
  await page.goto('/current-map');
  await readyMap(page);

  await expect(card).toHaveAttribute('aria-label', '底图：静态底图');
  expect(await readStoredBasemap(page)).toEqual(STORED_BASEMAP);
});

test('底图偏好打开：恢复存下的，换了写入（ADR 0140）', async ({ page }) => {
  test.skip(!basemapPreference, '这次构建关闭了底图偏好');
  const card = await openMapWithStoredBasemap(page);
  await expect(card).toHaveAttribute('aria-label', '底图：无底图');

  await chooseBasemap(page, card, '静态底图');

  await expect.poll(() => readStoredBasemap(page)).toEqual({
    version: 2,
    value: { ...STORED_BASEMAP.value, selected: 'static' }
  });
});

test('标注的偏好：和底图偏好无关，打开后写入，重新进入时恢复（ADR 0146）', async ({ page }) => {
  test.skip(!labelsPreference, '这次构建关闭了标注偏好');
  await page.goto('/login');
  await login(page);
  await readyMap(page);
  const card = page.locator('button[aria-label^="底图："]');
  const labels = page.getByRole('switch', { name: '底图标注' });
  const adjust = page.getByRole('button', { name: '调整标注和透明度' });
  const showLabels = async () => {
    await card.click();
    // 入口平时隐藏、不接收点击，悬停在当前缩略图上才出现（ADR 0146）
    await adjust.locator('..').hover();
    await adjust.click();
  };

  await showLabels();
  await expect(labels).toHaveAttribute('aria-checked', 'false');
  await labels.locator('..').click();
  await expect.poll(() => readStoredLabels(page)).toEqual({ version: 1, value: true });

  await leaveForFileManagement(page);
  await page.goto('/current-map');
  await readyMap(page);

  await showLabels();
  await expect(labels).toHaveAttribute('aria-checked', 'true');
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
