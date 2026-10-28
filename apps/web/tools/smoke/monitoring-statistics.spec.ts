import type { Page } from 'playwright/test';
import { expect, test as base } from './fixtures.ts';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

interface Backend {
  // 开始统计收到的请求体，按顺序
  creates: unknown[];
}

// 本地接口样本：结构按 2026-10-28 只读核对的真实接口（docs/migration.md），两个查询接口返回同一个结构
const dto = (change: Record<string, unknown>) => ({
  dataVolume: null, status: null, tableInfoList: null, totalNum: null, unProcessNum: null, processingNum: null,
  processedNum: null, failNum: 0, baseProvinceStatus: null, baseCityStatus: null, baseDistrictStatus: null,
  baseCountyStatus: null, summaryProvinceStatus: null, summaryCityStatus: null, summaryDistrictStatus: null,
  summaryCountyStatus: null, year: null, tableTypeList: null, levelList: null, progress: 0, ...change
});

const options = {
  tableTypeList: [{ label: '基本统计报表', value: 'baseTable' }, { label: '汇总统计报表', value: 'summaryTable' }],
  levelList: [{ label: '省级', value: 'province' }, { label: '市级', value: 'city' }]
};

// 只有汇总统计的省级有结果：进入页面后应落到这个组合
const summaryRows = [
  { year: '2025', name: '江苏省城汇1-1表', status: '处理成功', cause: null, completeTime: '2026-10-17  10:20:19', regionName: '江苏省', sort: null },
  { year: '2025', name: '江苏省城汇1-2表', status: '处理失败', cause: '缺少基础数据', completeTime: null, regionName: '江苏省', sort: null }
];

const report = (tableType: string, level: string) =>
  tableType === 'summaryTable' && level === 'province'
    ? dto({ ...options, tableInfoList: summaryRows, totalNum: 2, processedNum: 1, failNum: 1, processingNum: 0, unProcessNum: 0, progress: 100 })
    : dto({ ...options, tableInfoList: [], totalNum: 0, processedNum: 0, processingNum: 0, unProcessNum: 0, progress: 'NaN' });

// 产物测试只使用本地接口样本，不导入源码；没有列出的接口交给公共夹具
const test = base.extend<{ backend: Backend }>({
  backend: [async ({ context }, use) => {
    const backend: Backend = { creates: [] };
    await context.route('**/backend/**', async route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname.slice('/backend'.length);
      let data: unknown;
      if (endpoint === '/user/login') {
        const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'smoke', exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
        data = { token, loginName: 'smoke', realName: '冒烟测试', roleCode: 'admin' };
      } else if (endpoint === '/statistics/select-left-task' && request.method() === 'POST') {
        data = dto({ summaryProvinceStatus: '处理失败' });
      } else if (endpoint === '/statistics/select-task-status' && request.method() === 'POST') {
        const body = request.postDataJSON() as { tableType: string; level: string };
        data = report(body.tableType, body.level);
      } else if (endpoint === '/statistics/create-table' && request.method() === 'POST') {
        backend.creates.push(request.postDataJSON());
        data = null;
      } else if (endpoint === '/statistics/page' && request.method() === 'POST') {
        data = { list: [], total: 0, pageNum: 1, pageSize: 20, pages: 0 };
      } else if (endpoint === '/api/apply/list' && request.method() === 'POST') {
        data = { list: [], total: 0, pageNum: 1, pageSize: 20, pages: 0 };
      } else {
        await route.fallback();
        return;
      }
      await route.fulfill({ json: { code: 200, data } });
    });
    await use(backend);
  }, { auto: true }]
});

async function openStatistics(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入账号').fill('smoke');
  await page.getByPlaceholder('请输入密码').fill('smoke-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/current-map$/);
  await page.goto('/space-monitoring-basic-statistics');
  await expect(page.locator('[data-statistics-page]')).toBeVisible();
}

test('进入后落到有结果的组合；展开左栏提交统计，确认后左栏收起并按请求体提交', async ({ page, backend }) => {
  await openStatistics(page);
  const content = page.locator('[data-statistics-page]');
  await expect(content.getByRole('button', { name: '处理失败', pressed: true })).toBeVisible();
  await expect(content).toContainText('共2个报表');
  await expect(content).toContainText('缺少基础数据');

  await page.getByRole('button', { name: '统计报表计算' }).click();
  await page.locator('aside .el-checkbox', { hasText: '汇总统计报表' }).click();
  await page.getByRole('button', { name: '开始统计分析' }).click();
  const confirm = page.locator('.el-message-box');
  await expect(confirm).toContainText('本次将提交 2 项，其中 1 项已有统计任务');
  await confirm.getByRole('button', { name: '确认开始' }).click();

  await expect(page.getByRole('button', { name: '统计报表计算' })).toBeVisible();
  const year = String(new Date().getFullYear() - 1);
  await expect.poll(() => backend.creates).toEqual([
    { year, summaryTableParam: { year, isProvince: true, isCity: true, isDistrict: false, isCounty: false } }
  ]);
});

test('管理员点"去下载"进入系统管理的统计报表', async ({ page }) => {
  await openStatistics(page);
  await page.getByRole('button', { name: '去下载' }).click();
  await expect(page).toHaveURL(/\/system-management\/statistical-report$/);
});
