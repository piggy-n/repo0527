import type { Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

interface Backend {
  // 开始计算收到的请求体，按顺序
  calculations: unknown[];
  // 成果瓦片的路径（不含 /backend）
  tiles: string[];
}

// 本地接口样本：字段按 2026-10-28 只读核对的真实接口（docs/migration.md）
const listLeaf = (dm: string, mc: string, status: string, result: string) => ({
  result, reason: '', children: [], mc, sfjy: false, jb: null, bz: '城区', dm, status
});

const calculationTree = [
  { children: [listLeaf('A-32', '社区小学步行10分钟覆盖率（%）', '未处理', ''),
    listLeaf('A-33', '社区中学步行15分钟覆盖率（%）', '已完成', '50.98%')],
  mc: '教育便利性', sfjy: 'false', jb: 1, bz: null, dm: 'A', status: '' }
];

const ANALYSIS_ID = 'e3472ce215e0420baec22477cb48721b';

const resultGroup = {
  bz: null, dm: 'A', id: '', jb: 1, mc: '教育便利性', result: '',
  children: [{ bz: '城区', children: [], dm: 'A-32', id: ANALYSIS_ID, jb: null, mc: '社区小学步行10分钟覆盖率（%）', result: '40.04%' }]
};

const indicate = {
  id: ANALYSIS_ID,
  result: '40.04%',
  layers: [
    { gdbName: 'xxp', chineseName: '社区小学', type: 'POINT' },
    { gdbName: 'roads', chineseName: '路网', type: 'LINE' },
    { gdbName: 'cqjcfwa', chineseName: '城区范围面', type: 'POLYGON' }
  ]
};

const progress = {
  total: '一共1个指标', select: ['社区小学步行10分钟覆盖率（%）'], year: '2026年',
  calculate_data: [{ code: 'A-32', name: '社区小学步行10分钟覆盖率（%）', result: '分析结果:40.04%' }],
  calculate: '1个指标，0个正在计算，1个已完成，0个计算失败', status: '已处理完成', ratio: 100
};

// 产物测试只使用本地接口样本，不导入源码；没有列出的接口交给公共夹具
const test = base.extend<{ backend: Backend }>({
  backend: [async ({ context }, use) => {
    const backend: Backend = { calculations: [], tiles: [] };
    await context.route('**/backend/api/analysis/**', async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice('/backend'.length);
      if (endpoint.startsWith('/api/analysis/mvt/')) {
        // 空瓦片：只确认地址，地图上没有要素
        backend.tiles.push(endpoint);
        await route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
        return;
      }
      let data: unknown;
      if (endpoint === '/api/analysis/tree/list' && request.method() === 'GET') {
        data = calculationTree;
      } else if (endpoint === '/api/analysis/tree/out' && request.method() === 'GET') {
        data = [resultGroup, resultGroup];
      } else if (endpoint === '/api/analysis/verify' && request.method() === 'POST') {
        data = false;
      } else if (endpoint === '/api/analysis/calculate' && request.method() === 'POST') {
        backend.calculations.push(request.postDataJSON());
        data = null;
      } else if (endpoint === '/api/analysis/progress' && request.method() === 'GET') {
        data = progress;
      } else if (endpoint === '/api/analysis/indicate' && request.method() === 'GET') {
        data = indicate;
      } else {
        await route.fallback();
        return;
      }
      await route.fulfill({ json: { code: 200, data } });
    });
    await use(backend);
  }, { auto: true }]
});

// Element 的复选框把原生输入框隐藏了，点它的标签；展示页签的树也挂着（只是隐藏），只找显示出来的
async function check(page: Page, name: string) {
  const box = page.locator('[data-indicator-panel] .el-checkbox:visible', { hasText: name });
  await box.click();
  await expect(box).toHaveClass(/is-checked/);
}

async function openIndicators(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto('/space-monitoring-indicators');
  await expect(page.locator('[data-indicators-page] .maplibregl-canvas')).toBeVisible();
}

test('勾选指标开始计算，进度查到全部完成；展示页签选中指标后显示成果并请求成果瓦片', async ({ page, backend }) => {
  await openIndicators(page);
  const panel = page.locator('[data-indicator-panel]');

  await check(page, '社区小学步行10分钟覆盖率（%）');
  await panel.getByRole('button', { name: '开始计算', exact: true }).click();
  const confirm = page.locator('.el-message-box');
  await expect(confirm).toContainText('是否开始计算当前选中的指标？');
  await confirm.getByRole('button', { name: '开始计算', exact: true }).click();

  const progressPanel = page.locator('[data-calculation-progress]');
  await expect(progressPanel).toContainText('已处理完成');
  await expect(progressPanel.locator('.el-table__body')).toContainText('40.04%');
  const year = new Date().getFullYear();
  expect(backend.calculations).toEqual([{ year, regionCode: '320100', analysisCode: 'A-32' }]);

  await panel.getByRole('tab', { name: '指标展示' }).click();
  await expect(progressPanel).toBeHidden();
  await check(page, '社区小学步行10分钟覆盖率（%）');
  const result = page.locator('[data-indicator-result]');
  await expect(result).toContainText('40.04%');
  await expect(result.getByRole('img', { name: '旗子' })).toBeVisible();
  await expect(result.locator('.el-checkbox')).toHaveText(['省', '市', '县', '社区小学', '路网', '城区范围面']);
  await expect.poll(() => backend.tiles.some(tile => tile.startsWith(`/api/analysis/mvt/${ANALYSIS_ID}/`))).toBe(true);
});
