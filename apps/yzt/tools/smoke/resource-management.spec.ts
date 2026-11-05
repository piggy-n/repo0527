import type { Page } from 'playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { expect, test as base } from './fixtures.ts';

// 测试登录令牌的编码，不包含真实凭据
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

interface Directory {
  id: string;
  name: string;
  icon?: string;
  code?: string;
  children?: Directory[] | null;
}

interface Backend {
  role: 'admin' | 'user';
  failWrite: boolean;
  failTree: boolean;
  failYears: boolean;
  failPage: boolean;
  failDetail: boolean;
  emptyAttributes: boolean;
  holdDetail?: Promise<void>;
  holdSave?: Promise<void>;
  holdStatus: Map<string, Promise<void>>;
  statuses: { id: string; status: string | null }[];
  saves: { id: string | null; resourceName: string | null; attributes: Attribute[] }[];
  holdPage?: Promise<void>;
  holdDirectoryWrite?: Promise<void>;
  holdImport?: Promise<void>;
  detailYear: number | null;
  imported: boolean;
  imports: { fields: { key: string; name: string | null; value: string | number[] }[]; query: string; contentType: string; token: string | undefined }[];
  writes: string[];
  reads: string[];
  pages: { resource: string; pageNum: number; pageSize: number; layerName?: string; year?: string }[];
}

interface Attribute {
  attrId: string | null;
  name: string | null;
  code: string;
  fieldType: string;
  fieldLength: string;
  year: number;
  remark: string | null;
}

// 产物测试只使用本地接口样本，不导入源码，也不读写真实业务数据
const test = base.extend<{ resourceBackend: Backend }>({
  resourceBackend: [async ({ context }, use) => {
    const backend: Backend = { role: 'admin', failWrite: false, failTree: false, failYears: false,
      failPage: false, failDetail: false, emptyAttributes: false, saves: [], holdStatus: new Map(), statuses: [],
      writes: [], reads: [], pages: [], imports: [], detailYear: 2025, imported: false };
    const saved = new Map<string, { resourceName: string; attributes: Attribute[] }>();
    const enabled = new Map<string, string>();
    const groups: Directory[] = [
      { id: 'base', name: '基础库', children: ['土地资源', '地质/矿产资源', '海洋资源', '水资源', '森林资源',
        '草原资源', '湿地资源', '荒漠', '国家公园'].map((name, index) => ({ id: `base-${index}`, name,
        code: name === '国家公园' ? 'gjgyzy' : name === '湿地资源' ? 'sdzy' : undefined,
        icon: (name === '国家公园' ? '湿地资源' : name.replace('/', '_')) + '@1x.png' })) },
      { id: 'public', name: '公共库', children: ['气象', '水利', '生态'].map((name, index) => ({ id: `public-${index}`, name })) },
      { id: 'topic', name: '主题库', children: ['生态保护区', '耕地保护区', '联合审批'].map((name, index) => ({ id: `topic-${index}`, name })) },
      { id: 'three', name: '三区三线', children: null }
    ];
    await context.route('**/backend/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.slice('/backend'.length);
      let data: unknown;
      let fail = false;
      if (endpoint.startsWith('/resource-center/') || endpoint === '/resource-management/layer/page' ||
        endpoint === '/resource-management/layer/struct') {
        backend.reads.push(endpoint);
      }
      if (endpoint === '/user/login') {
        const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'resource-test', exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
        data = { token, loginName: 'resource-test', realName: '资源测试', roleCode: backend.role };
      } else if (endpoint === '/resource-center/tree') {
        data = groups;
        fail = backend.failTree;
      } else if (endpoint === '/resource-center/year/list') {
        data = ['2025', '2024', '2022'].map(year => ({ label: year, value: year }));
        fail = backend.failYears;
      } else if (endpoint === '/resource-management/layer/page') {
        const params = request.postDataJSON() as Backend['pages'][number];
        backend.pages.push(params);
        await backend.holdPage;
        fail = backend.failPage;
        const rows = Array.from({ length: 23 }, (_, index) => ({
          id: `row-${index}`, layer_name: index === 0 ? '资源名称很长时应省略并且保留完整的悬浮提示文本' : `${params.resource}记录${index}`,
          year: index % 2 === 0 ? 2025 : 2024, dataset_name: '年度调查数据集', resource_name: params.resource,
          layer_code: `LAYER_${index}`, dataset_code: 'DATASET', slice: index % 2 === 0,
          enable: enabled.get(`row-${index}`) ?? (index % 3 === 0 ? 'false' : 'true')
        })).filter(row => (!saved.has(row.id) || saved.get(row.id)?.resourceName === params.resource) &&
          (!params.layerName || row.layer_name.includes(params.layerName)) &&
          (!params.year || String(row.year) === params.year));
        const pages = Math.ceil(rows.length / params.pageSize);
        const pageNum = Math.min(params.pageNum, Math.max(pages, 1));
        data = { list: rows.slice((pageNum - 1) * params.pageSize, pageNum * params.pageSize),
          total: rows.length, pages, pageNum, pageSize: params.pageSize };
      } else if (endpoint === '/resource-management/layer/status' && request.method() === 'POST') {
        const id = url.searchParams.get('id')!;
        const status = url.searchParams.get('status');
        backend.statuses.push({ id, status });
        await backend.holdStatus.get(id);
        fail = backend.failWrite;
        if (!fail && status !== null) { enabled.set(id, status); }
        data = null;
      } else if (endpoint === '/resource-management/layer/struct') {
        await backend.holdDetail;
        fail = backend.failDetail;
        const id = url.searchParams.get('id')!;
        data = { id, resourceName: saved.get(id)?.resourceName ?? '土地资源', datasetName: '年度调查数据集',
          datasetCode: 'DATASET', datasets: 'CCWJQ, CJDCQ, CJDCQJX, CZCDYD, CZKFBJ, DLTB, FJMSQ, GDDB, GFBQ',
          year: backend.detailYear, submit_unit: '江苏省基础地理信息中心', layerName: 'DLTB', layerCode: 'LAYER',
          elementType: '其他', layerRecord: 29307, coordinate: 'Geodetic Coordinate System 2000 (EPSG:4490)',
          attributes: backend.emptyAttributes ? [] : saved.get(id)?.attributes ?? Array.from({ length: 33 }, (_, index) => ({
            attrId: index === 0 ? null : `attribute-${index}`, name: index === 0 ? (backend.imported ? '导入后的字段' : null) : `属性名称${index}`,
            code: `FIELD_${index}`, fieldType: index === 0 ? 'Long' : 'String', fieldLength: '100', year: 2025,
            remark: index === 0 ? '必须保留的备注' : null
          })) };
      } else if (endpoint === '/resource-management/layer/create-attribute-by-excel' && request.method() === 'POST') {
        const contentType = request.headers()['content-type'];
        const incoming = new Request(request.url(), {
          method: 'POST', headers: { 'Content-Type': contentType }, body: request.postDataBuffer()!
        });
        // oxlint-disable-next-line typescript/no-deprecated -- 仅解析固定测试样本，不为测试引入 multipart 服务端依赖
        const form = await incoming.formData();
        const fields = await Promise.all(Array.from(form, async ([key, value]) => ({ key,
          name: typeof value === 'string' ? null : value.name,
          value: typeof value === 'string' ? value : [...new Uint8Array(await value.arrayBuffer())]
        })));
        backend.imports.push({ fields, query: url.search, contentType, token: request.headers().token });
        await backend.holdImport;
        fail = backend.failWrite;
        backend.imported = !fail;
        data = { unknown: '测试响应，不解释数量或部分成功' };
      } else if (endpoint === '/resource-management/layer/edit-struct' && request.method() === 'PUT') {
        const attributes = request.postDataJSON() as Attribute[];
        const id = url.searchParams.get('id');
        const resourceName = url.searchParams.get('resourceName');
        backend.saves.push({ id, resourceName, attributes });
        await backend.holdSave;
        fail = backend.failWrite;
        if (!fail && id && resourceName) { saved.set(id, { resourceName, attributes }); }
        data = null;
      } else if (endpoint.startsWith('/resource-management/menu/')) {
        backend.writes.push(endpoint);
        await backend.holdDirectoryWrite;
        fail = backend.failWrite;
        if (!fail) {
          if (endpoint.endsWith('/delete')) {
            for (const group of groups) { group.children = group.children?.filter(node => node.id !== url.searchParams.get('id')); }
          } else {
            const body = request.postDataJSON() as { id?: string; name: string; parentId?: string };
            if (endpoint.endsWith('/add')) {
              const group = groups.find(node => node.id === body.parentId);
              if (group) { group.children = [...(group.children ?? []), { id: `new-${backend.writes.length}`, name: body.name }]; }
            } else {
              const node = groups.flatMap(group => group.children ?? []).find(child => child.id === body.id);
              if (node) { node.name = body.name; }
            }
          }
        }
        data = null;
      } else {
        await route.fallback();
        return;
      }
      await route.fulfill({ json: fail ? { code: 500, msg: '模拟接口失败' } : { code: 200, data } });
    });
    await use(backend);
  }, { auto: true }]
});

/** 登录经过真实表单和管理员守卫，只替换后端响应 */
async function enter(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('resource-test');
  await page.getByPlaceholder('请输入密码').fill('resource-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto('/resource-management');
}

/** 截图等待真实过渡完成，避免把抽屉和弹窗动画中间帧当成最终布局 */
async function settleAnimations(page: Page) {
  await page.evaluate('Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getTiming().iterations)).map(a => a.finished.catch(() => {})))');
}

test('目录整行悬浮、移出和鼠标关闭后隐藏；键盘与业务图标保持可用', async ({ page }, testInfo) => {
  await enter(page);
  const rename = page.getByRole('button', { name: '重命名土地资源', exact: true });
  const row = rename.locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]');
  const actions = row.locator('[class*="_treeActions_"]');
  const label = row.locator('[class*="_treeName_"]');
  await page.mouse.move(700, 130);
  await expect(actions).toHaveCSS('opacity', '0');
  const before = await label.boundingBox();
  for (let index = 0; index < 3; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 连续移入移出检验整行而非仅文字的悬浮区域
    await row.hover({ position: { x: 2, y: 18 } });
    // oxlint-disable-next-line no-await-in-loop -- 必须在移出前检查显示状态
    await expect(actions).toHaveCSS('opacity', '1');
    // oxlint-disable-next-line no-await-in-loop -- 保留真实鼠标序列
    await page.mouse.move(700, 130);
    // oxlint-disable-next-line no-await-in-loop -- 必须在下一轮移入前检查隐藏状态
    await expect(actions).toHaveCSS('opacity', '0');
  }
  expect(await label.boundingBox()).toEqual(before);
  await row.hover();
  await rename.click();
  const dialog = page.getByRole('dialog', { name: '重命名目录', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.mouse.move(700, 130);
  await expect(actions).toHaveCSS('opacity', '0');
  await rename.press('Tab');
  await expect(page.getByRole('button', { name: '删除土地资源', exact: true })).toBeFocused();
  await expect(actions).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '删除目录', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '删除目录', exact: true })).not.toBeVisible();
  await expect(actions).toHaveCSS('opacity', '1');
  const wetland = page.getByRole('button', { name: '重命名湿地资源', exact: true }).locator('xpath=../..').locator('svg').first();
  const park = page.getByRole('button', { name: '重命名国家公园', exact: true }).locator('xpath=../..').locator('svg').first();
  expect(await wetland.innerHTML()).not.toEqual(await park.innerHTML());
  const dataRow = page.locator('.el-table__row').first();
  const height = (await dataRow.boundingBox())!.height;
  expect(height).toBeGreaterThanOrEqual(48);
  expect(height).toBeLessThanOrEqual(50);
  await expect(dataRow.locator('td').first()).toHaveCSS('padding', '12px 0px');
  await expect(dataRow.locator('.cell').first()).toHaveCSS('padding', '0px 12px');
  await settleAnimations(page);
  await page.screenshot({ path: testInfo.outputPath('directory-keyboard-and-table.png') });
});

test.describe('触屏目录操作', () => {
  test.use({ hasTouch: true });
  test('无需悬浮即可打开和关闭目录弹窗', async ({ page }) => {
    await enter(page);
    const rename = page.getByRole('button', { name: '重命名土地资源', exact: true });
    await expect(rename.locator('..')).toHaveCSS('opacity', '1');
    await rename.tap();
    await expect(page.getByRole('dialog', { name: '重命名目录', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: '重命名目录', exact: true })).not.toBeVisible();
    await expect(rename.locator('..')).toHaveCSS('opacity', '1');
  });
});

test('目录维护、列表联动、失败保留草稿和重试；正式页面没有刷新按钮', async ({ page, resourceBackend }) => {
  await enter(page);
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
  await expect(page.locator('.el-tree [class*="_treeIcon_"]')).toHaveCount(19);
  await page.getByRole('button', { name: '在三区三线新增目录', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '在三区三线新增目录', exact: true }).click();
  const add = page.getByRole('dialog', { name: '新增二级目录', exact: true });
  await expect(add.getByText('所属分组')).toHaveCount(0);
  await expect(add.locator('.el-dialog__header')).toHaveCSS('background-color', 'rgb(241, 244, 248)');
  await expect(add.locator('.el-dialog__header')).toHaveCSS('min-height', '48px');
  await expect(add.getByRole('heading', { name: '新增二级目录' })).toHaveCSS('font-size', '16px');
  await add.getByRole('button', { name: '保存目录', exact: true }).click();
  await expect(add.getByText('请输入目录名称', { exact: true })).toBeVisible();
  await add.getByPlaceholder('请输入目录名称').fill(' 新目录 ');
  resourceBackend.failWrite = true;
  await add.getByRole('button', { name: '保存目录', exact: true }).click();
  await expect(add.getByText('模拟接口失败')).toBeVisible();
  await expect(add.getByPlaceholder('请输入目录名称')).toHaveValue(' 新目录 ');
  resourceBackend.failWrite = false;
  await add.getByRole('button', { name: '保存目录', exact: true }).click();
  await expect(add).not.toBeVisible();
  await expect(page.locator('.el-tree').getByText('新目录', { exact: true })).toBeVisible();
  await page.getByPlaceholder('请输入资源名称').fill('旧草稿');
  await page.getByRole('button', { name: '重命名土地资源', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '重命名土地资源', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名目录', exact: true });
  await expect(rename.getByText('所属分组')).toHaveCount(0);
  await expect(rename.locator('.el-dialog__header')).toHaveCSS('background-color', 'rgb(241, 244, 248)');
  await rename.getByPlaceholder('请输入目录名称').fill('土地调查');
  await rename.getByPlaceholder('请输入目录名称').press('Enter');
  await expect(rename).not.toBeVisible();
  await expect(page.locator('h2').filter({ hasText: '土地调查' })).toBeVisible();
  await expect(page.getByPlaceholder('请输入资源名称')).toHaveValue('');
  await page.getByRole('button', { name: '删除土地调查', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '删除土地调查', exact: true }).click();
  const remove = page.getByRole('dialog', { name: '删除目录', exact: true });
  await remove.getByRole('button', { name: '取消', exact: true }).click();
  await expect(remove).not.toBeVisible();
  expect(resourceBackend.writes).toHaveLength(3);
  await page.getByRole('button', { name: '删除土地调查', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '删除土地调查', exact: true }).click();
  resourceBackend.failWrite = true;
  await remove.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('模拟接口失败', { exact: true })).toBeVisible();
  await expect(page.locator('h2').filter({ hasText: '土地调查' })).toBeVisible();
  resourceBackend.failWrite = false;
  await page.getByRole('button', { name: '删除土地调查', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '删除土地调查', exact: true }).click();
  let release!: () => void;
  resourceBackend.holdDirectoryWrite = new Promise<void>(resolve => { release = resolve; });
  await remove.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除土地调查', exact: true })).toBeDisabled();
  release();
  await expect(remove).not.toBeVisible();
  await expect(page.locator('h2').filter({ hasText: '地质/矿产资源' })).toBeVisible();
});

test('图层启停按行等待、并发与失败重试；查看只保留文字', async ({ page, resourceBackend }, testInfo) => {
  await enter(page);
  const rows = page.locator('.el-table__row');
  await expect(rows).toHaveCount(20);
  await expect(page.getByRole('button', { name: '查看', exact: true }).first().locator('svg')).toHaveCount(0);
  const first = rows.nth(0).getByRole('switch');
  const second = rows.nth(1).getByRole('switch');
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  resourceBackend.holdStatus.set('row-0', new Promise<void>(resolve => { releaseFirst = resolve; }));
  resourceBackend.holdStatus.set('row-1', new Promise<void>(resolve => { releaseSecond = resolve; }));
  await rows.nth(0).locator('.el-switch').click();
  await expect(first).toBeDisabled();
  await expect(first).not.toBeChecked();
  await rows.nth(1).locator('.el-switch').click();
  await expect(second).toBeDisabled();
  await expect(second).toBeChecked();
  await expect.poll(() => resourceBackend.statuses).toEqual([
    { id: 'row-0', status: 'true' }, { id: 'row-1', status: 'false' }
  ]);
  releaseSecond();
  await expect(second).toBeEnabled();
  await expect(second).not.toBeChecked();
  await expect(first).toBeDisabled();
  await expect(first).not.toBeChecked();
  releaseFirst();
  await expect(first).toBeEnabled();
  await expect(first).toBeChecked();
  resourceBackend.failWrite = true;
  await rows.nth(0).locator('.el-switch').click();
  await expect(page.locator('.el-message').filter({ hasText: '模拟接口失败' })).toBeVisible();
  await expect(first).toBeEnabled();
  await expect(first).toBeChecked();
  resourceBackend.failWrite = false;
  await rows.nth(0).locator('.el-switch').click();
  await expect(first).not.toBeChecked();
  await expect(first).toBeEnabled();
  await settleAnimations(page);
  await page.screenshot({ path: testInfo.outputPath('resource-status.png') });
});

test('启停成功但列表刷新失败时保留旧状态并禁止重复写，读取重试恢复真实状态', async ({ page, resourceBackend }) => {
  await enter(page);
  const first = page.locator('.el-table__row').first().getByRole('switch');
  await expect(first).not.toBeChecked();
  resourceBackend.failPage = true;
  await page.locator('.el-table__row').first().locator('.el-switch').click();
  await expect(page.getByText('刷新失败，以下为上次结果。', { exact: false })).toBeVisible();
  await expect(first).not.toBeChecked();
  await expect(first).toBeDisabled();
  resourceBackend.failPage = false;
  await page.getByRole('button', { name: '重试列表', exact: true }).click();
  await expect(first).toBeChecked();
  await expect(first).toBeEnabled();
  expect(resourceBackend.statuses).toEqual([{ id: 'row-0', status: 'true' }]);
});

test('筛选、分页、空结果与页面错误区重试', async ({ page, resourceBackend }) => {
  resourceBackend.failTree = true;
  resourceBackend.failYears = true;
  await enter(page);
  await expect(page.getByText('目录加载失败', { exact: false })).toBeVisible();
  resourceBackend.failTree = false;
  resourceBackend.failPage = true;
  await page.getByRole('button', { name: '重试目录', exact: true }).click();
  await expect(page.getByText('资源列表加载失败', { exact: false })).toBeVisible();
  resourceBackend.failPage = false;
  await page.getByRole('button', { name: '重试列表', exact: true }).click();
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  resourceBackend.failYears = false;
  await page.getByRole('button', { name: '重试年份', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试年份', exact: true })).toHaveCount(0);
  await page.locator('.el-pager').getByText('2', { exact: true }).click();
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录20');
  await page.locator('.el-pagination__sizes .el-select__wrapper').click();
  await page.getByRole('option', { name: '10条/页', exact: true }).click();
  await expect(page.locator('.el-pager .is-active')).toHaveText('1');
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  await page.locator('.el-pagination__sizes .el-select__wrapper').click();
  await page.getByRole('option', { name: '20条/页', exact: true }).click();
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  await page.getByPlaceholder('请输入资源名称').fill('记录');
  await page.locator('.el-form-item').filter({ hasText: '年份' }).locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '2024', exact: true }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录1');
  await expect.poll(() => resourceBackend.pages.at(-1)).toMatchObject({ layerName: '记录', year: '2024', pageNum: 1 });
  await page.getByPlaceholder('请输入资源名称').fill('不存在的名称');
  await page.getByPlaceholder('请输入资源名称').press('Enter');
  await expect(page.getByText('暂无资源，可调整筛选条件后查询')).toBeVisible();
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  resourceBackend.failPage = true;
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('刷新失败，以下为上次结果。', { exact: false })).toBeVisible();
  await expect(page.locator('.el-table__row')).toHaveCount(20);
});

test('多尺寸布局、长名称、目录抽屉及窄屏弹窗', async ({ page }, testInfo) => {
  await enter(page);
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  await page.evaluate('document.fonts.ready');
  const checkSize = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('html').evaluate(
      (element: { scrollWidth: number }, viewportWidth) => element.scrollWidth <= viewportWidth, width
    )).toBe(true);
    await expect(page.locator('.el-pagination')).toBeVisible();
    const pager = await page.locator('.el-pagination').boundingBox();
    expect(pager!.x).toBeGreaterThanOrEqual(0);
    expect(pager!.x + pager!.width).toBeLessThanOrEqual(width);
    expect(pager!.y + pager!.height).toBeLessThanOrEqual(height);
    // 翻页按钮必须和页码同行，不能在窄屏换行到条数选择旁
    const previous = await page.getByRole('button', { name: '上一页', exact: true }).boundingBox();
    const next = await page.getByRole('button', { name: '下一页', exact: true }).boundingBox();
    expect(previous!.y).toBe(next!.y);
    expect((await page.locator('.el-pager').boundingBox())!.y).toBe(previous!.y);
    if (width < 1200) {
      await page.getByRole('button', { name: '资源目录', exact: true }).click();
      await expect(page.getByRole('button', { name: '关闭资源目录', exact: true })).toBeVisible();
      await page.locator('.el-drawer').getByText('水资源', { exact: true }).click();
      await expect(page.locator('.el-drawer')).not.toBeVisible();
    }
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`resource-${width}-${height}.png`) });
  };
  for (const [width, height] of [[1440, 900], [1200, 800], [1199, 800], [760, 640], [390, 844], [1440, 600]]) {
    // oxlint-disable-next-line no-await-in-loop -- 同一页面逐个改变尺寸，等待布局和抽屉稳定后再检查下一尺寸
    await checkSize(width, height);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '资源目录', exact: true }).click();
  await page.getByRole('button', { name: '在基础库新增目录', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '在基础库新增目录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增二级目录', exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.locator('.el-dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.getByPlaceholder('请输入目录名称').fill('窄屏目录');
  await settleAnimations(page);
  await page.screenshot({ path: testInfo.outputPath('resource-dialog-390.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('普通用户不能进入管理员页面，不发目录或列表请求', async ({ page, resourceBackend }) => {
  resourceBackend.role = 'user';
  await enter(page);
  await expect(page).toHaveURL(/\/current-map$/);
  await expect(page.getByPlaceholder('请输入资源名称')).toHaveCount(0);
  expect(resourceBackend.pages).toEqual([]);
  expect(resourceBackend.reads).toEqual([]);
});

test('首次加载用骨架，查询期间保留行并显示遮罩，切页卸载关闭目录弹窗', async ({ page, resourceBackend }) => {
  let release: (() => void) | undefined;
  resourceBackend.holdPage = new Promise<void>(resolve => { release = resolve; });
  await enter(page);
  await expect(page.locator('.table-skeleton')).toBeVisible();
  await expect(page.getByText('暂无资源，可调整筛选条件后查询')).toHaveCount(0);
  release?.();
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  resourceBackend.holdPage = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-loading-mask')).toBeVisible();
  await expect(page.locator('.el-table__row')).toHaveCount(20);
  release?.();
  await expect(page.locator('.el-loading-mask')).not.toBeVisible();
  await page.getByRole('button', { name: '删除土地资源', exact: true }).locator('xpath=ancestor::div[contains(@class, "el-tree-node__content")]').hover();
  await page.getByRole('button', { name: '删除土地资源', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除目录', exact: true })).toBeVisible();
  await page.goto('/file-management');
  await expect(page.getByRole('dialog', { name: '删除目录', exact: true })).toHaveCount(0);
  expect(resourceBackend.writes).toEqual([]);
});

test('详情头部修改、属性保存失败保留草稿、保存后刷新列表并保留分页筛选', async ({ page, resourceBackend }) => {
  await enter(page);
  await page.getByPlaceholder('请输入资源名称').fill('记录');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.locator('.el-pager').getByText('2', { exact: true }).click();
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录21');
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  const detail = page.locator('[data-resource-detail]');
  await expect(detail.getByText('数据集元数据', { exact: true })).toBeVisible();
  await expect(detail.locator('header').getByRole('button', { name: '修改', exact: true })).toBeVisible();
  await expect(detail.locator('footer')).toHaveCount(0);
  await detail.getByRole('button', { name: '修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true }).fill(' 标识码 ');
  await page.getByRole('textbox', { name: 'FIELD_1字段名称', exact: true }).fill('   ');
  await detail.locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '基础库 / 水资源', exact: true }).click();
  resourceBackend.failWrite = true;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(detail.getByText('模拟接口失败')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true })).toHaveValue(' 标识码 ');
  resourceBackend.failWrite = false;
  let release!: () => void;
  resourceBackend.holdSave = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true })).toBeDisabled();
  release();
  await expect(detail.getByRole('button', { name: '修改', exact: true })).toBeVisible();
  expect(resourceBackend.saves).toHaveLength(2);
  expect(resourceBackend.saves[1]).toMatchObject({ id: 'row-21', resourceName: '水资源' });
  expect(resourceBackend.saves[1].attributes[0]).toEqual({ attrId: null, name: '标识码', code: 'FIELD_0',
    fieldType: 'Long', fieldLength: '100', year: 2025, remark: '必须保留的备注' });
  expect(resourceBackend.saves[1].attributes[1].name).toBeNull();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByPlaceholder('请输入资源名称')).toHaveValue('记录');
  await expect(page.locator('.el-pager .is-active')).toHaveText('2');
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录22');
});

test('未保存返回、切目录、取消编辑和路由离开都确认；拒绝不改目录高亮', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true }).fill('未保存');
  const dialog = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('.el-tree').getByText('水资源', { exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.el-tree-node.is-current > .el-tree-node__content')).toContainText('土地资源');
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true })).toHaveValue('未保存');
  await expect(page.getByRole('button', { name: '重命名土地资源', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: '文件管理', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page).toHaveURL(/\/resource-management$/);
  await page.locator('.el-tree').getByText('水资源', { exact: true }).click();
  await dialog.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('h2').filter({ hasText: '水资源' })).toBeVisible();
  await expect(page.locator('[data-resource-detail]')).toHaveCount(0);
});

test('详情加载、错误重试、空属性结构及保存后刷新失败', async ({ page, resourceBackend }) => {
  await enter(page);
  let release!: () => void;
  resourceBackend.holdDetail = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  await expect(page.locator('.el-skeleton')).toBeVisible();
  await expect(page.getByRole('button', { name: '修改', exact: true })).toBeDisabled();
  resourceBackend.failDetail = true;
  release();
  await expect(page.getByText('资源详情加载失败', { exact: false })).toBeVisible();
  resourceBackend.failDetail = false;
  resourceBackend.emptyAttributes = true;
  await page.getByRole('button', { name: '重试详情', exact: true }).click();
  await expect(page.getByText('暂无属性结构', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await page.locator('[data-resource-detail] .el-select__wrapper').click();
  await page.getByRole('option', { name: '基础库 / 水资源', exact: true }).click();
  resourceBackend.failDetail = true;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('资源详情加载失败，当前显示上次结果', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '修改', exact: true })).toBeDisabled();
  resourceBackend.failDetail = false;
  await page.getByRole('button', { name: '重试详情', exact: true }).click();
  await expect(page.locator('[data-resource-detail]').getByText('水资源', { exact: true })).toBeVisible();
  expect(resourceBackend.saves).toHaveLength(1);
});

test('Excel 直接选择上传：校验、原生 multipart、鉴权、互斥和成功刷新', async ({ page, resourceBackend }, testInfo) => {
  await enter(page);
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  const upload = page.getByRole('button', { name: '导入', exact: true });
  const input = page.locator('input[type="file"]');
  await expect(upload).toBeVisible();
  await expect(page.getByText('（支持 .xlsx、.xls）', { exact: true })).toBeVisible();
  await input.setInputFiles({ name: '错误.txt', mimeType: 'text/plain', buffer: Buffer.from('错误格式') });
  await expect(page.getByRole('alert')).toContainText('请选择 .xlsx 或 .xls 文件');
  await input.setInputFiles({ name: '空.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('文件为空');
  expect(resourceBackend.imports).toHaveLength(0);
  let release!: () => void;
  resourceBackend.holdImport = new Promise<void>(resolve => { release = resolve; });
  const chosen = page.waitForEvent('filechooser');
  await upload.click();
  const chooser = await chosen;
  expect(chooser.isMultiple()).toBe(false);
  expect(await page.getByRole('dialog').count()).toBe(0);
  const bytes = [80, 75, 0, 255, 128, 9];
  await chooser.setFiles({ name: '属性规范.XLSX', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  try {
    await expect.poll(() => resourceBackend.imports.length).toBe(1);
    expect(resourceBackend.imports[0]).toMatchObject({ query: '', fields: [
      { key: 'file', name: '属性规范.XLSX', value: bytes }, { key: 'year', name: null, value: '2025' }
    ] });
    expect(resourceBackend.imports[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(resourceBackend.imports[0].token).toBeTruthy();
    await expect(upload).toBeDisabled();
    await expect(page.getByRole('button', { name: '修改', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeDisabled();
    await page.getByRole('link', { name: '文件管理', exact: true }).click();
    await expect(page).toHaveURL(/\/resource-management$/);
    await expect(page.getByRole('status')).not.toContainText('导入成功');
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath('excel-pending.png') });
  } finally { release(); }
  await expect(page.getByRole('status')).toHaveText('导入成功');
  await expect(page.getByText('导入后的字段', { exact: true })).toBeVisible();
  expect(resourceBackend.reads.filter(path => path === '/resource-management/layer/struct')).toHaveLength(2);
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await expect(upload).toBeDisabled();
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(upload).toBeEnabled();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect.poll(() => resourceBackend.pages.length).toBe(2);
});

test('Excel 原生发送到 100% 后仍等待服务端，处理状态覆盖六尺寸', async ({ page }, testInfo) => {
  let response: ServerResponse | undefined;
  // 此用例让 XHR 实际发送到临时本机接口，避免 route.fulfill 抑制上传进度事件
  const receiver = createServer((request, reply) => {
    request.on('end', () => {
      reply.setHeader('Access-Control-Allow-Origin', '*');
      reply.setHeader('Content-Type', 'application/json');
      response = reply;
    });
    request.resume();
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const address = receiver.address();
  if (!address || typeof address === 'string') { throw new Error('测试接口未绑定端口'); }
  const localUrl = `http://127.0.0.1:${address.port}/import`;
  await page.route('**/backend/resource-management/layer/create-attribute-by-excel', route =>
    route.continue({ url: localUrl }));
  try {
    await enter(page);
    await page.getByRole('button', { name: '查看', exact: true }).first().click();
    await page.locator('input[type="file"]').setInputFiles({
      name: '进度测试.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(64 * 1024, 1)
    });
    await expect(page.getByRole('status')).toHaveText('文件已发送，正在处理…');
    expect(response).toBeDefined();
    for (const [width, height] of [[1440, 900], [1200, 800], [1199, 800], [760, 640], [390, 844], [1440, 600]]) {
      // oxlint-disable-next-line no-await-in-loop -- 同一未完成上传逐个检查断点，不能并发改变尺寸
      await page.setViewportSize({ width, height });
      // oxlint-disable-next-line no-await-in-loop -- 等待同一尺寸的真实布局
      await settleAnimations(page);
      // oxlint-disable-next-line no-await-in-loop -- 每个尺寸独立记录实际布局
      const layout = await page.locator('[data-resource-detail]').evaluate((element: {
        clientHeight: number; scrollHeight: number; ownerDocument: { documentElement: { scrollWidth: number } };
      }) => ({ client: element.clientHeight, scroll: element.scrollHeight,
        documentWidth: element.ownerDocument.documentElement.scrollWidth }));
      expect(layout.scroll).toBe(layout.client);
      expect(layout.documentWidth).toBeLessThanOrEqual(width);
      // oxlint-disable-next-line no-await-in-loop -- 按尺寸保存生产产物状态证据
      await page.screenshot({ path: testInfo.outputPath(`excel-processing-${width}-${height}.png`) });
    }
    response!.end(JSON.stringify({ code: 200 }));
    await expect(page.getByRole('status')).toHaveText('导入成功');
  } finally {
    response?.end(JSON.stringify({ code: 200 }));
    receiver.closeAllConnections();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
  }
});

test('Excel 失败后可重选同一文件，缺年份不补造参数，成功后读取失败可独立重试', async ({ page, resourceBackend }) => {
  resourceBackend.detailYear = null;
  resourceBackend.failWrite = true;
  await enter(page);
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  const input = page.locator('input[type="file"]');
  const file = { name: '规范.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('固定样本') };
  await input.setInputFiles(file);
  await expect(page.getByRole('alert')).toContainText('模拟接口失败');
  expect(resourceBackend.imports[0].fields.map(field => field.key)).toEqual(['file']);
  resourceBackend.failWrite = false;
  resourceBackend.failDetail = true;
  await input.setInputFiles(file);
  await expect(page.getByRole('status')).toHaveText('导入成功');
  await expect(page.getByRole('button', { name: '重试详情', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入', exact: true })).toBeDisabled();
  resourceBackend.failDetail = false;
  await page.getByRole('button', { name: '重试详情', exact: true }).click();
  await expect(page.getByText('导入后的字段', { exact: true })).toBeVisible();
  expect(resourceBackend.imports).toHaveLength(2);
});

test('详情与编辑多尺寸布局：长标题、属性表滚动、固定头尾和未保存弹窗', async ({ page }, testInfo) => {
  await enter(page);
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  await expect(page.locator('[data-resource-detail] .el-table__row')).toHaveCount(33);
  await page.getByRole('button', { name: /^数据集图层列表：/ }).click();
  await expect(page.locator('.el-popover').filter({ visible: true })).toContainText('CCWJQ, CJDCQ, CJDCQJX, CZCDYD, CZKFBJ, DLTB, FJMSQ, GDDB, GFBQ');
  await page.getByText('数据分类', { exact: true }).click();
  await expect(page.locator('.el-popover').filter({ visible: true })).toHaveCount(0);
  const checkSize = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('html').evaluate(
      (element: { scrollWidth: number }, viewportWidth) => element.scrollWidth <= viewportWidth, width
    )).toBe(true);
    const detail = page.locator('[data-resource-detail]');
    const body = detail.locator(':scope > header + div');
    await expect(body).toHaveCSS('overflow', 'hidden');
    await expect(page.getByText('数据分类', { exact: true })).toBeInViewport();
    const back = await page.getByRole('button', { name: '返回', exact: true }).boundingBox();
    const modify = await page.getByRole('button', { name: '修改', exact: true }).boundingBox();
    expect(back!.height).toBe(32);
    expect(modify!.height).toBe(back!.height);
    const upload = await page.getByRole('button', { name: '导入', exact: true }).boundingBox();
    const hint = await page.getByText('（支持 .xlsx、.xls）', { exact: true }).boundingBox();
    expect(upload).not.toBeNull();
    expect(hint).not.toBeNull();
    expect(hint!.x).toBeGreaterThan(upload!.x + upload!.width);
    expect(Math.abs(hint!.y + hint!.height / 2 - upload!.y - upload!.height / 2)).toBeLessThanOrEqual(1);
    expect(hint!.x + hint!.width).toBeLessThanOrEqual(width);
    if (width <= 760 || height <= 700) {
      await page.getByRole('button', { name: '展开数据集元数据', exact: true }).click();
      await expect(page.getByRole('button', { name: '数据集名称：年度调查数据集', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: '展开空间要素图层元数据', exact: true }).click();
      await expect(page.getByRole('button', { name: '展开数据集元数据', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '收起空间要素图层元数据', exact: true }).click();
    }
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`metadata-${width}-${height}.png`) });
    await page.getByText('属性名称32', { exact: true }).scrollIntoViewIfNeeded();
    await expect.poll(() => detail.locator('.el-table__body-wrapper .el-scrollbar__wrap').evaluate(
      (element: { scrollTop: number }) => element.scrollTop
    )).toBeGreaterThan(0);
    expect(await body.evaluate((element: { scrollTop: number }) => element.scrollTop)).toBe(0);
    await expect(page.getByText('数据分类', { exact: true })).toBeInViewport();
    await expect(page.locator('[data-resource-detail] header').getByRole('button', { name: '修改', exact: true })).toBeInViewport();
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}-${height}.png`) });
    await page.getByRole('button', { name: '修改', exact: true }).click();
    await page.getByRole('textbox', { name: 'FIELD_32字段名称', exact: true }).fill('窄屏未保存名称');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeInViewport();
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`edit-${width}-${height}.png`) });
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveCSS('font-size', '16px');
    await expect(dialog.getByRole('heading')).toHaveCSS('font-weight', '600');
    await expect(dialog.locator('.el-dialog__header')).toHaveCSS('min-height', '48px');
    await expect(dialog.getByRole('button', { name: '继续编辑', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: '放弃修改', exact: true })).toBeInViewport();
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`discard-${width}-${height}.png`) });
    await dialog.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('button', { name: '修改', exact: true })).toBeVisible();
  };
  for (const [width, height] of [[1440, 900], [1200, 800], [1199, 800], [760, 640], [390, 844], [1440, 600]]) {
    // oxlint-disable-next-line no-await-in-loop -- 复用同一详情逐个验证尺寸，保存独立截图
    await checkSize(width, height);
  }
});
