import type { Page } from 'playwright/test';
import { expect, test } from './fixtures.ts';

// oxlint-disable no-await-in-loop -- 同一页面依次改变视口和查询方式，不能并发操作

const rows = Array.from({ length: 25 }, (_, index) => ({
  guid: index.toString(16).padStart(32, '0'), name: `查询学校 ${index + 1}`, type: '小学', sjnf: 2022,
  geom: JSON.stringify({ type: 'Point', coordinates: [119 + index / 100, 33] })
}));

async function openQuery(page: Page) {
  await page.route('**/backend/api/query/mvt?*', route => route.fulfill({ status: 204 }));
  await page.goto('/space-monitoring-query');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto('/space-monitoring-query');
  await expect(page.getByRole('heading', { name: '数据查询', exact: true })).toBeVisible();
}

test('数据查询的条件快照、分页、导出和四种方式在正式产物中可用', async ({ page }) => {
  const requests: URLSearchParams[] = [];
  let exported: unknown;
  await page.route('**/backend/api/query/attr/page?*', route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const index = Number(params.get('pageNum')) - 1;
    return route.fulfill({ json: { total: rows.length, list: rows.slice(index * 20, (index + 1) * 20) } });
  });
  await page.route('**/backend/api/export/region', route => {
    exported = route.request().postDataJSON();
    return route.fulfill({ body: 'fixed-export', headers: {
      'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="query.xlsx"'
    } });
  });
  await openQuery(page);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-table__body tr')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.el-table__body tr')).toHaveCount(5);
  expect(requests.at(-1)?.get('pageSize')).toBe('20');
  expect(requests.at(-1)?.get('pageNum')).toBe('2');
  await page.getByRole('button', { name: '移除类型条件', exact: true }).click();
  await expect(page.getByText('条件已修改，请重新查询', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出查询结果', exact: true });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('query.xlsx');
  expect(exported).toMatchObject({ conditions: requests[0].get('conditions'), format: 'excel' });
  await expect(dialog).toBeHidden();

  for (const [width, height] of [[1440, 900], [1200, 768], [1200, 600], [390, 768]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '默认视角', exact: true })).toBeInViewport();
    await expect(page.getByRole('cell', { name: '21', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.locator('html').evaluate((element: { scrollWidth: number }) => element.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.screenshot({ path: test.info().outputPath(`query-${width}x${height}.png`) });
    if (width < 1200 || height < 700) {
      await page.getByRole('button', { name: '查询条件', exact: true }).click();
      await expect(page.getByRole('combobox', { name: '查询图层', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: '查询', exact: true })).toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: '收起查询条件', exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText('高级查询', { exact: true }).click();
  await page.getByRole('textbox', { name: '高级查询条件', exact: true }).fill("NAME LIKE '%学校%'");
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-table__body tr')).toHaveCount(20);
  expect(requests.at(-1)?.get('conditions')).toBe("NAME LIKE '%学校%'");
  await page.getByText('自然语言', { exact: true }).click();
  await page.getByRole('textbox', { name: '查询描述', exact: true }).fill('未知的提问');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('当前仅支持');
  await page.getByRole('button', { name: '查询南京市学校点层中类型为小学、高级中学的数据', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-table__body tr')).toHaveCount(20);
  expect(requests.at(-1)?.get('xzqdm')).toBe('320100');
});

test('SHP 原生上传、查询与导出沿用同一文件，查询失败可恢复', async ({ page }) => {
  const received: { path: string; fileName: string; content: string; page: string | null }[] = [];
  let fail = false;
  await page.route('**/backend/api/query/scope/shp**', async route => {
    const request = route.request();
    const incoming = new Request(request.url(), {
      method: 'POST', headers: { 'Content-Type': request.headers()['content-type'] }, body: request.postDataBuffer()!
    });
    // oxlint-disable-next-line typescript/no-deprecated -- 固定测试样本沿用现有 multipart 验收方式
    const form = await incoming.formData();
    const file = form.get('file') as File;
    received.push({ path: new URL(request.url()).pathname, fileName: file.name,
      content: await file.text(), page: form.get('pageNum') as string | null });
    const paginated = request.url().includes('/page');
    await route.fulfill({ json: fail ? { code: 500, msg: '范围解析失败' } : paginated
      ? { total: 1, list: [rows[0]] } : [{ geom: rows[0].geom }] });
  });
  await page.route('**/backend/api/export/shp', async route => {
    const request = route.request();
    const incoming = new Request(request.url(), {
      method: 'POST', headers: { 'Content-Type': request.headers()['content-type'] }, body: request.postDataBuffer()!
    });
    // oxlint-disable-next-line typescript/no-deprecated -- 同上，仅核对测试上传内容
    const form = await incoming.formData();
    const file = form.get('file') as File;
    expect(file.name).toBe('查询范围.zip');
    expect(await file.text()).toBe('fixed-range-content');
    expect(form.get('format')).toBe('excel');
    await route.fulfill({ body: 'fixed-export', contentType: 'application/octet-stream' });
  });
  await openQuery(page);
  await page.getByText('空间查询', { exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请先在地图上绘制');
  await page.getByText('SHP 导入', { exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: '查询范围.zip', mimeType: 'application/zip', buffer: Buffer.from('fixed-range-content')
  });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-table__body tr')).toHaveCount(1);
  expect(received).toHaveLength(2);
  expect(received.every(item => item.fileName === '查询范围.zip' && item.content === 'fixed-range-content')).toBe(true);
  expect(received.find(item => item.path.endsWith('/page'))?.page).toBe('1');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: '导出查询结果', exact: true }).getByRole('button', { name: '导出', exact: true }).click();
  await download;
  fail = true;
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('查询失败，请重试', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重新查询', exact: true }).click();
  await expect(page.locator('.el-table__body tr')).toHaveCount(1);
});
