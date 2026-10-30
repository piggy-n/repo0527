import type { Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

// 发给后端的 GeoJSON 几何，只读用到的字段
interface QueryGeometry {
  readonly type: string;
  readonly coordinates: number[][][];
}

interface Backend {
  // 查询瓦片的地址参数，按请求顺序
  tiles: URLSearchParams[];
  // 结果表分页的接口和参数
  pages: { readonly endpoint: string; readonly params: URLSearchParams }[];
  // 空间查询命中要素时收到的几何
  geometries: QueryGeometry[];
  // 导出的接口和请求体
  exports: { readonly endpoint: string; readonly body: unknown }[];
}

// 本地接口样本：结构按 2026-10-28 只读核对的真实接口（docs/migration.md），成功时没有信封
const SCHOOLS = [
  { guid: 'a', cc: '08H213', ccn: '中小学', name: '南京市琅琊路小学', type: '小学', iftc: '否' },
  { guid: 'b', cc: '08H213', ccn: '中小学', name: '南京市拉萨路小学', type: '小学', iftc: '-9999' }
];

const resultPage = (list: readonly unknown[]) => ({
  total: list.length, list, pageNum: 1, pageSize: 100, size: list.length, startRow: 1, endRow: list.length, pages: 1
});

const FEATURES = [
  { guid: 'a', geom: '{"type":"Point","coordinates":[118.78,32.06]}' },
  { guid: 'b', geom: '{"type":"Point","coordinates":[118.77,32.05]}' }
];

// 产物测试只使用本地接口样本，不导入源码；没有列出的接口交给公共夹具
const test = base.extend<{ backend: Backend }>({
  backend: [async ({ context }, use) => {
    const backend: Backend = { tiles: [], pages: [], geometries: [], exports: [] };
    await context.route('**/backend/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.slice('/backend'.length);
      if (endpoint === '/api/query/mvt' && request.method() === 'GET') {
        // 空瓦片：只确认地址，地图上没有要素
        backend.tiles.push(url.searchParams);
        await route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
      } else if (endpoint === '/api/query/attr/page' || endpoint === '/api/query/scope/geojson/page') {
        backend.pages.push({ endpoint, params: url.searchParams });
        await route.fulfill({ json: resultPage(SCHOOLS) });
      } else if (endpoint === '/api/query/scope/geojson' && request.method() === 'GET') {
        backend.geometries.push(JSON.parse(url.searchParams.get('geometry') ?? 'null') as QueryGeometry);
        await route.fulfill({ json: FEATURES });
      } else if (endpoint.startsWith('/api/export/') && request.method() === 'POST') {
        backend.exports.push({ endpoint, body: request.postDataJSON() });
        await route.fulfill({
          status: 200,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: Buffer.from('xlsx')
        });
      } else {
        await route.fallback();
      }
    });
    await use(backend);
  }, { auto: true }]
});

async function openQuery(page: Page, path: string) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto(path);
  await expect(page.locator('[data-data-query-page] .maplibregl-canvas')).toBeVisible();
}

// 页签里只有一个图层下拉，在第一行
async function chooseLayer(page: Page, label: string) {
  await page.locator('[data-query-panel] .el-select__wrapper').first().click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

// 顶栏"查询统计"的两级面板：进入数据查询页时默认显示数据查询这一组
async function openTopic(page: Page, label: string) {
  await page.getByRole('button', { name: '查询统计' }).click();
  await page.getByRole('link', { name: label, exact: true }).click();
}

test('属性查询：选图层先请求全省的预览瓦片；查询后结果表、条数和带条件的结果瓦片；导出 Excel 以图层名下载', async ({ page, backend }) => {
  await openQuery(page, '/space-monitoring-query');
  const panel = page.locator('[data-query-panel]');
  await expect(panel).toContainText('城市国土空间监测查询');

  await chooseLayer(page, '学校点层');
  await expect(panel.locator('[data-condition="TYPE"]')).toBeVisible();
  await expect.poll(() => backend.tiles.some(params =>
    params.get('layerCode') === 'csxhjctb_xxp_2022' && params.get('xzqdm') === '320000' && params.get('conditions') === ''
  )).toBe(true);

  await panel.getByRole('button', { name: '查询', exact: true }).click();
  const result = page.locator('[data-query-result]');
  await expect(result).toContainText('学校点层查询结果');
  await expect(result).toContainText('2 条');
  await expect(result.locator('.el-table__body tr')).toHaveCount(2);
  await expect(result.locator('.el-table__body')).toContainText('南京市琅琊路小学');
  const conditions = "TYPE IN ('普通高等学校本科院校','小学','高级中学','托儿所')";
  expect(backend.pages.map(({ endpoint, params }) => [endpoint, params.get('conditions'), params.get('pageSize')]))
    .toEqual([['/api/query/attr/page', conditions, '100']]);
  await expect.poll(() => backend.tiles.some(params => params.get('conditions') === conditions)).toBe(true);

  await result.getByRole('button', { name: '导出' }).click();
  const popover = page.locator('[data-export-popover]');
  await expect(popover.locator('.el-checkbox.is-checked')).toHaveText(['Excel']);
  const downloading = page.waitForEvent('download');
  await popover.getByRole('button', { name: '确定', exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe('学校点层.xlsx');
  expect(backend.exports).toEqual([{
    endpoint: '/api/export/region',
    body: { layerCode: 'csxhjctb_xxp_2022', xzqdm: '320000', relation: '', conditions, format: 'excel', fileName: '学校点层' }
  }]);
});

test('空间查询：已选图层时框选画完直接查询，报命中数，发给后端的是闭合的矩形', async ({ page, backend }) => {
  await openQuery(page, '/space-monitoring-query');
  const panel = page.locator('[data-query-panel]');
  await panel.locator('.el-radio-button', { hasText: '空间查询' }).click();
  await chooseLayer(page, '学校点层');
  await panel.getByRole('button', { name: '框选' }).click();
  await expect(panel.getByRole('button', { name: '框选' })).toHaveAttribute('aria-pressed', 'true');

  // 提示出现说明视图已就绪、工具在用
  const canvas = page.locator('[data-data-query-page] .maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('地图画布没有尺寸');
  }
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await expect(page.locator('[data-pointer-hint]')).toContainText('按下鼠标左键并拖动');
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 5 });
  await page.mouse.move(x + 200, y + 140, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('.el-message').filter({ hasText: '空间查询成功，已绘制 2 个结果' })).toBeVisible();
  await expect(panel).toContainText('已绘制矩形范围');
  await expect(panel.getByRole('button', { name: '框选' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-query-result]')).toContainText('2 条');
  expect(backend.pages.map(({ endpoint, params }) => [endpoint, params.get('layerCode')]))
    .toEqual([['/api/query/scope/geojson/page', 'csxhjctb_xxp_2022']]);
  expect(backend.geometries).toHaveLength(1);
  const [geometry] = backend.geometries;
  expect(geometry?.type).toBe('Polygon');
  const ring = geometry?.coordinates[0] ?? [];
  expect(ring).toHaveLength(5);
  expect(ring.at(-1)).toEqual(ring[0]);
});

test('从顶栏切到别的专题时整页重建，条件、结果和地图都不带过去；建设中的专题只有说明', async ({ page }) => {
  await openQuery(page, '/space-monitoring-query');
  const panel = page.locator('[data-query-panel]');
  await chooseLayer(page, '学校点层');
  await panel.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('[data-query-result]')).toContainText('2 条');
  const canvas = await page.locator('[data-data-query-page] .maplibregl-canvas').elementHandle();

  await openTopic(page, '国土变更调查');
  await expect(page).toHaveURL(/\/land-change-query$/);
  await expect(page.locator('[data-data-query-page="land-change"]')).toBeVisible();
  await expect(panel).toContainText('国土变更调查查询');
  await expect(panel).toContainText('请选择图层');
  await expect(panel).toContainText('请先选择图层');
  await expect(page.locator('[data-query-result]')).toHaveCount(0);
  expect(await canvas.evaluate((element: { isConnected: boolean }) => element.isConnected)).toBe(false);
  await expect(page.locator('[data-data-query-page] .maplibregl-canvas')).toBeVisible();

  await openTopic(page, '森林草原湿地荒漠调查监测');
  await expect(page).toHaveURL(/\/forest-grass-wetland-desert-query$/);
  await expect(panel).toContainText('森林草原湿地荒漠调查监测');
  await expect(panel).toContainText('建设中');
  await expect(panel.getByRole('radiogroup')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '查询', exact: true })).toHaveCount(0);
});
