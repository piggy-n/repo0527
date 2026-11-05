import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright/test';
import { loadEnv } from 'vite';
import { expect, test } from './fixtures.ts';

// 开关在构建时写进产物，这里和内网构建读同一份配置，验证产物实际的行为（ADR 0132）
const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const limited = loadEnv('intranet', appRoot, 'VITE_').VITE_RESOURCE_MIN_ZOOM_ENABLED === 'true';

// 内置层级是 9，默认视角到不了
const LIMITED = 'csxhjctb_lrdl';
// 内置层级里没有它：它的瓦片请求到了，才说明这一轮该发的请求都发了，另一个没发不是因为还没轮到
const FREE = 'csxhjctb_hydl';
const CONFIG_FILE = '**/resource-min-zooms.json*';

const TREE = [
  {
    code: null,
    name: '冒烟',
    children: [
      { code: LIMITED, name: '公路', geoType: 'Line', yearList: [2026] },
      { code: FREE, name: '水域', geoType: 'Line', yearList: [2026] }
    ]
  }
];

/** 登录到现状底图并勾选两个资源，返回不断累积的瓦片请求路径；瓦片和目录在浏览器中拦截 */
async function openResources(context: BrowserContext, page: Page): Promise<readonly string[]> {
  const tiles: string[] = [];
  await context.route('**/backend/resource-map/base/tree', route => route.fulfill({ json: { code: 200, data: TREE } }));
  await context.route('**/backend/api/tiles/**', route => {
    tiles.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });

  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await expect(page.locator('[data-map-view-state]')).toHaveAttribute('data-map-view-state', 'ready');

  await page.locator(`[data-resource="${LIMITED}"] label`).click();
  await page.locator(`[data-resource="${FREE}"] label`).click();
  await page.getByRole('button', { name: '展开已选择图层' }).click();
  await expect(page.locator(`[data-layer="${LIMITED}"]`)).toBeVisible();
  return tiles;
}

function hintOf(page: Page) {
  return page.locator(`[data-layer="${LIMITED}"] [data-status="minzoom"]`);
}

async function tilesRequested(tiles: readonly string[], code: string): Promise<void> {
  await expect.poll(() => tiles.some(path => path.includes(code)), { message: `请求 ${code} 的瓦片` }).toBe(true);
}

// 不靠页面判断：文件没进产物时 vite preview 和 nginx 都回退到 index.html，页面用内置的层级，看起来一样
test('发布目录里有层级文件', async ({ request }) => {
  const response = await request.get('/resource-min-zooms.json');

  expect(response.headers()['content-type']).toContain('json');
  const config: unknown = await response.json();
  expect(config).toMatchObject({ [LIMITED]: 9 });
});

test.describe('开关打开：按发布目录的文件限制（ADR 0137）', () => {
  test.skip(!limited, '这次构建关闭了最小显示级别');

  test('用发布目录的层级：提示放大，没到层级不请求瓦片', async ({ context, page }) => {
    const tiles = await openResources(context, page);

    await expect(hintOf(page)).toHaveAttribute('aria-label', '放大至第 9 级显示');
    await tilesRequested(tiles, FREE);
    expect(tiles.filter(path => path.includes(LIMITED))).toEqual([]);
  });

  test('换了部署的文件，不用重新构建就按新的层级', async ({ context, page }) => {
    await context.route(CONFIG_FILE, route => route.fulfill({ json: { [LIMITED]: 12 } }));

    await openResources(context, page);

    await expect(hintOf(page)).toHaveAttribute('aria-label', '放大至第 12 级显示');
  });

  test('部署的文件是空对象：不限制', async ({ context, page }) => {
    await context.route(CONFIG_FILE, route => route.fulfill({ json: {} }));

    const tiles = await openResources(context, page);

    await tilesRequested(tiles, LIMITED);
    await expect(hintOf(page)).toHaveCount(0);
  });

  // nginx 找不到文件时回退到 index.html，返回的是 200 的网页
  test('读到的不是配置：用构建带上的层级，地图照常', async ({ context, page }) => {
    await context.route(CONFIG_FILE, route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>index</title>' })
    );

    await openResources(context, page);

    await expect(hintOf(page)).toHaveAttribute('aria-label', '放大至第 9 级显示');
  });
});

test.describe('开关关闭：不限制（ADR 0132）', () => {
  test.skip(limited, '这次构建打开了最小显示级别');

  test('不读部署的文件，没有提示，各级都请求瓦片', async ({ context, page }) => {
    const requested: string[] = [];
    page.on('request', request => requested.push(new URL(request.url()).pathname));

    const tiles = await openResources(context, page);

    await tilesRequested(tiles, LIMITED);
    await expect(hintOf(page)).toHaveCount(0);
    expect(requested.filter(path => path.endsWith('/resource-min-zooms.json'))).toEqual([]);
  });
});
