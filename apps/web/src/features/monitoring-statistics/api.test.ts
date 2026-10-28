import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { statisticsApi } from './api';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ok = (data: JsonBodyType) => HttpResponse.json({ success: true, code: 200, data, msg: '请求成功' });

// 两个查询接口返回同一个结构，没用到的字段是 null（2026-10-28 实测，docs/migration.md）
const dto = (change: Record<string, JsonBodyType>) => ({
  dataVolume: null,
  status: null,
  tableInfoList: null,
  totalNum: null,
  unProcessNum: null,
  processingNum: null,
  processedNum: null,
  failNum: 0,
  baseProvinceStatus: null,
  baseCityStatus: null,
  baseDistrictStatus: null,
  baseCountyStatus: null,
  summaryProvinceStatus: null,
  summaryCityStatus: null,
  summaryDistrictStatus: null,
  summaryCountyStatus: null,
  year: null,
  tableTypeList: null,
  levelList: null,
  progress: 0,
  ...change
});

const TABLE_TYPES = [
  { label: '基本统计报表', value: 'baseTable' },
  { label: '汇总统计报表', value: 'summaryTable' }
];
const LEVELS = [
  { label: '省级', value: 'province' },
  { label: '市级', value: 'city' },
  { label: '区级', value: 'district' },
  { label: '县级', value: 'county' }
];

describe('总览', () => {
  it('按年份查询，八个组合的状态文字原样给出，没有任务的是 null', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/statistics/select-left-task', async ({ request }) => {
        bodies.push(await request.json());
        return ok(
          dto({
            baseProvinceStatus: '处理失败',
            baseCityStatus: '未处理',
            summaryCityStatus: '处理失败'
          })
        );
      })
    );

    const statuses = await statisticsApi.fetchOverview('2025');

    expect(bodies).toEqual([{ year: '2025' }]);
    expect(Object.fromEntries(statuses)).toEqual({
      'baseTable:province': '处理失败',
      'baseTable:city': '未处理',
      'baseTable:district': null,
      'baseTable:county': null,
      'summaryTable:province': null,
      'summaryTable:city': '处理失败',
      'summaryTable:district': null,
      'summaryTable:county': null
    });
  });
});

describe('报表状态', () => {
  it('按年份、报表、等级查询；行的状态按文字归类，处理时间里的两个空格合成一个', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/statistics/select-task-status', async ({ request }) => {
        bodies.push(await request.json());
        return ok(
          dto({
            tableInfoList: [
              {
                year: '2025',
                name: '江苏省城基1-1表',
                status: '处理失败',
                cause: '缺少基础数据',
                completeTime: null,
                regionName: '江苏省',
                sort: null
              },
              {
                year: '2025',
                name: '南京市城基1-1表',
                status: '处理成功',
                cause: null,
                completeTime: '2026-10-17  10:20:19',
                regionName: '南京市',
                sort: null
              }
            ],
            totalNum: 51,
            processedNum: 1,
            failNum: 1,
            processingNum: 1,
            unProcessNum: 49,
            progress: 1.9607843137254901,
            tableTypeList: TABLE_TYPES,
            levelList: LEVELS
          })
        );
      })
    );

    const report = await statisticsApi.fetchReport({ year: '2025', table: 'baseTable', level: 'province' });

    expect(bodies).toEqual([{ year: '2025', tableType: 'baseTable', level: 'province' }]);
    expect(report.rows).toEqual([
      {
        year: '2025',
        regionName: '江苏省',
        name: '江苏省城基1-1表',
        status: 'failed',
        statusText: '处理失败',
        completeTime: null,
        cause: '缺少基础数据'
      },
      {
        year: '2025',
        regionName: '南京市',
        name: '南京市城基1-1表',
        status: 'completed',
        statusText: '处理成功',
        completeTime: '2026-10-17 10:20:19',
        cause: null
      }
    ]);
    expect(report).toMatchObject({
      counts: { total: 51, completed: 1, failed: 1, processing: 1, notStarted: 49 },
      progress: 1.9607843137254901,
      statusText: null,
      tables: [
        { value: 'baseTable', label: '基本统计报表' },
        { value: 'summaryTable', label: '汇总统计报表' }
      ],
      levels: LEVELS.map(({ value, label }) => ({ value, label }))
    });
  });

  it('没有任务时百分比是字符串 "NaN"，按没有处理', async () => {
    server.use(
      mock.post('/backend/statistics/select-task-status', () =>
        ok(
          dto({
            tableInfoList: [],
            totalNum: 0,
            processedNum: 0,
            processingNum: 0,
            unProcessNum: 0,
            progress: 'NaN',
            tableTypeList: [TABLE_TYPES[0]],
            levelList: [LEVELS[0], LEVELS[3]]
          })
        )
      )
    );

    const report = await statisticsApi.fetchReport({ year: '2026', table: 'baseTable', level: 'province' });

    expect(report).toMatchObject({ rows: [], progress: null, counts: { total: 0 } });
    expect(report.levels.map(level => level.value)).toEqual(['province', 'county']);
  });

  it('没见过的报表类型按返回格式错误处理', async () => {
    server.use(
      mock.post('/backend/statistics/select-task-status', () =>
        ok(
          dto({
            tableInfoList: [],
            totalNum: 0,
            processedNum: 0,
            processingNum: 0,
            unProcessNum: 0,
            tableTypeList: [{ label: '新报表', value: 'newTable' }],
            levelList: []
          })
        )
      )
    );
    await expect(
      statisticsApi.fetchReport({ year: '2025', table: 'baseTable', level: 'province' })
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});

describe('开始统计', () => {
  it('请求体按旧接口的结构提交；业务码失败时抛出 ApiError', async () => {
    const bodies: unknown[] = [];
    server.use(
      mock.post('/backend/statistics/create-table', async ({ request }) => {
        bodies.push(await request.json());
        return bodies.length === 1
          ? ok(null)
          : HttpResponse.json({ success: false, code: 500, data: null, msg: '已有统计任务在执行' });
      })
    );
    const payload = {
      year: '2025',
      baseTableParam: { year: '2025', isProvince: true, isCity: false, isDistrict: false, isCounty: false }
    };

    await expect(statisticsApi.createTasks(payload)).resolves.toBeUndefined();
    await expect(statisticsApi.createTasks(payload)).rejects.toMatchObject({
      kind: 'business',
      message: '已有统计任务在执行'
    });
    expect(bodies).toEqual([payload, payload]);
  });
});
