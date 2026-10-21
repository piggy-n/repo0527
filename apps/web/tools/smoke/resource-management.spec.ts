import type { Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

// 测试登录令牌的编码，不包含真实凭据
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

interface Directory {
  id: string;
  name: string;
  icon?: string;
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
  saves: { id: string | null; resourceName: string | null; attributes: Attribute[] }[];
  holdPage?: Promise<void>;
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
      failPage: false, failDetail: false, emptyAttributes: false, saves: [], writes: [], reads: [], pages: [] };
    const saved = new Map<string, { resourceName: string; attributes: Attribute[] }>();
    const groups: Directory[] = [
      { id: 'base', name: '基础库', children: ['土地资源', '地质/矿产资源', '海洋资源', '水资源', '森林资源',
        '草原资源', '湿地资源', '荒漠', '国家公园'].map((name, index) => ({ id: `base-${index}`, name,
        icon: name.replace('/', '_') + '@1x.png' })) },
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
          layer_code: `LAYER_${index}`, dataset_code: 'DATASET', slice: index % 2 === 0, enable: index % 3 === 0 ? 'false' : 'true'
        })).filter(row => (!saved.has(row.id) || saved.get(row.id)?.resourceName === params.resource) &&
          (!params.layerName || row.layer_name.includes(params.layerName)) &&
          (!params.year || String(row.year) === params.year));
        const pages = Math.ceil(rows.length / params.pageSize);
        const pageNum = Math.min(params.pageNum, Math.max(pages, 1));
        data = { list: rows.slice((pageNum - 1) * params.pageSize, pageNum * params.pageSize),
          total: rows.length, pages, pageNum, pageSize: params.pageSize };
      } else if (endpoint === '/resource-management/layer/struct') {
        await backend.holdDetail;
        fail = backend.failDetail;
        const id = url.searchParams.get('id')!;
        data = { id, resourceName: saved.get(id)?.resourceName ?? '土地资源', datasetName: '年度调查数据集',
          datasetCode: 'DATASET', datasets: 'CCWJQ, CJDCQ, CJDCQJX, CZCDYD, CZKFBJ, DLTB, FJMSQ, GDDB, GFBQ',
          year: 2025, submit_unit: '江苏省基础地理信息中心', layerName: 'DLTB', layerCode: 'LAYER',
          elementType: '其他', layerRecord: 29307, coordinate: 'Geodetic Coordinate System 2000 (EPSG:4490)',
          attributes: backend.emptyAttributes ? [] : saved.get(id)?.attributes ?? Array.from({ length: 33 }, (_, index) => ({
            attrId: index === 0 ? null : `attribute-${index}`, name: index === 0 ? null : `属性名称${index}`,
            code: `FIELD_${index}`, fieldType: index === 0 ? 'Long' : 'String', fieldLength: '100', year: 2025,
            remark: index === 0 ? '必须保留的备注' : null
          })) };
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

test('目录维护、列表联动、失败保留草稿和重试；正式页面没有刷新按钮', async ({ page, resourceBackend }) => {
  await enter(page);
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
  await expect(page.locator('.el-tree [class*="_treeIcon_"]')).toHaveCount(19);
  await page.getByRole('button', { name: '在三区三线新增目录', exact: true }).click();
  const add = page.getByRole('dialog', { name: '新增二级目录', exact: true });
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
  await page.getByRole('button', { name: '重命名土地资源', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名目录', exact: true });
  await rename.getByPlaceholder('请输入目录名称').fill('土地调查');
  await rename.getByPlaceholder('请输入目录名称').press('Enter');
  await expect(rename).not.toBeVisible();
  await expect(page.locator('h2').filter({ hasText: '土地调查' })).toBeVisible();
  await expect(page.getByPlaceholder('请输入资源名称')).toHaveValue('');
  await page.getByRole('button', { name: '删除土地调查', exact: true }).click();
  const remove = page.getByRole('dialog', { name: '删除目录', exact: true });
  await remove.getByRole('button', { name: '取消', exact: true }).click();
  await expect(remove).not.toBeVisible();
  expect(resourceBackend.writes).toHaveLength(3);
  await page.getByRole('button', { name: '删除土地调查', exact: true }).click();
  await remove.getByRole('button', { name: '删除目录', exact: true }).click();
  await expect(remove).not.toBeVisible();
  await expect(page.locator('h2').filter({ hasText: '地质/矿产资源' })).toBeVisible();
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
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  resourceBackend.failYears = false;
  await page.getByRole('button', { name: '重试年份', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试年份', exact: true })).toHaveCount(0);
  await page.locator('.el-pager').getByText('2', { exact: true }).click();
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录10');
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
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  resourceBackend.failPage = true;
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('刷新失败，以下为上次结果。', { exact: false })).toBeVisible();
  await expect(page.locator('.el-table__row')).toHaveCount(10);
});

test('多尺寸布局、长名称、目录抽屉及窄屏弹窗', async ({ page }, testInfo) => {
  await enter(page);
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  await page.evaluate('document.fonts.ready');
  const checkSize = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('html').evaluate(
      (element: { scrollWidth: number }, viewportWidth) => element.scrollWidth <= viewportWidth, width
    )).toBe(true);
    await expect(page.locator('.el-pagination')).toBeVisible();
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
  await page.getByRole('button', { name: '在基础库新增目录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增二级目录', exact: true });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
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
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  resourceBackend.holdPage = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.el-loading-mask')).toBeVisible();
  await expect(page.locator('.el-table__row')).toHaveCount(10);
  release?.();
  await expect(page.locator('.el-loading-mask')).not.toBeVisible();
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
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录11');
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
  await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true })).toBeDisabled();
  release();
  await expect(detail.getByRole('button', { name: '修改', exact: true })).toBeVisible();
  expect(resourceBackend.saves).toHaveLength(2);
  expect(resourceBackend.saves[1]).toMatchObject({ id: 'row-11', resourceName: '水资源' });
  expect(resourceBackend.saves[1].attributes[0]).toEqual({ attrId: null, name: '标识码', code: 'FIELD_0',
    fieldType: 'Long', fieldLength: '100', year: 2025, remark: '必须保留的备注' });
  expect(resourceBackend.saves[1].attributes[1].name).toBeNull();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(page.getByPlaceholder('请输入资源名称')).toHaveValue('记录');
  await expect(page.locator('.el-pager .is-active')).toHaveText('2');
  await expect(page.locator('.el-table__row').first()).toContainText('土地资源记录12');
});

test('未保存返回、切目录、取消编辑和路由离开都确认；拒绝不改目录高亮', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  await page.getByRole('button', { name: '修改', exact: true }).click();
  await page.getByRole('textbox', { name: 'FIELD_0字段名称', exact: true }).fill('未保存');
  const dialog = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
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

test('详情与编辑多尺寸布局：长标题、属性表滚动、固定头尾和未保存弹窗', async ({ page }, testInfo) => {
  await enter(page);
  await page.getByRole('button', { name: '查看', exact: true }).first().click();
  await expect(page.locator('[data-resource-detail] .el-table__row')).toHaveCount(33);
  const checkSize = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('html').evaluate(
      (element: { scrollWidth: number }, viewportWidth) => element.scrollWidth <= viewportWidth, width
    )).toBe(true);
    await page.getByText('数据分类', { exact: true }).scrollIntoViewIfNeeded();
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`metadata-${width}-${height}.png`) });
    await page.getByText('属性名称32', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.locator('[data-resource-detail] header').getByRole('button', { name: '修改', exact: true })).toBeInViewport();
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}-${height}.png`) });
    await page.getByRole('button', { name: '修改', exact: true }).click();
    await page.getByRole('textbox', { name: 'FIELD_32字段名称', exact: true }).fill('窄屏未保存名称');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeInViewport();
    await settleAnimations(page);
    await page.screenshot({ path: testInfo.outputPath(`edit-${width}-${height}.png`) });
    await page.getByRole('button', { name: '取消编辑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
    await expect(dialog).toBeVisible();
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
