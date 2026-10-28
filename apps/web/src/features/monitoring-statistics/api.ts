import { z } from 'zod';
import { http } from '@/shared/http/client';
import type { ReportCriteria, ReportStatus } from './report';
import {
  AREA_LEVEL_IDS,
  type CreateTaskPayload,
  type OverviewStatuses,
  TABLE_TYPES,
  tableLevelKey,
  taskStatusOf
} from './statistics';

// 返回结构按 2026-10-28 的实测写，见 docs/migration.md 的"城市国土空间监测基本统计：接口实测"

/** 统计页用到的接口；拥有者通过它请求，组件样例换成固定数据的实现 */
export interface StatisticsApi {
  /** 一年里各报表、各等级的处理状态（总览矩阵） */
  fetchOverview(year: string, signal?: AbortSignal): Promise<OverviewStatuses>;
  /** 一份报表的处理状态和全部统计表 */
  fetchReport(criteria: ReportCriteria, signal?: AbortSignal): Promise<ReportStatus>;
  /** 提交统计任务；写操作，失败时抛出 ApiError */
  createTasks(payload: CreateTaskPayload): Promise<void>;
}

// 两个查询接口返回同一个结构，总览只填 base*Status、summary*Status，其余字段是 null
const nullableText = z.string().nullable();
const overviewSchema = z
  .object({
    baseProvinceStatus: nullableText,
    baseCityStatus: nullableText,
    baseDistrictStatus: nullableText,
    baseCountyStatus: nullableText,
    summaryProvinceStatus: nullableText,
    summaryCityStatus: nullableText,
    summaryDistrictStatus: nullableText,
    summaryCountyStatus: nullableText
  })
  .transform(
    (data): OverviewStatuses =>
      new Map([
        [tableLevelKey({ table: 'baseTable', level: 'province' }), data.baseProvinceStatus],
        [tableLevelKey({ table: 'baseTable', level: 'city' }), data.baseCityStatus],
        [tableLevelKey({ table: 'baseTable', level: 'district' }), data.baseDistrictStatus],
        [tableLevelKey({ table: 'baseTable', level: 'county' }), data.baseCountyStatus],
        [tableLevelKey({ table: 'summaryTable', level: 'province' }), data.summaryProvinceStatus],
        [tableLevelKey({ table: 'summaryTable', level: 'city' }), data.summaryCityStatus],
        [tableLevelKey({ table: 'summaryTable', level: 'district' }), data.summaryDistrictStatus],
        [tableLevelKey({ table: 'summaryTable', level: 'county' }), data.summaryCountyStatus]
      ])
  );

/** 查询接口没有失败提示时由页面显示原因，所以不弹全局提示 */
function fetchOverview(year: string, signal?: AbortSignal) {
  return http.post('/statistics/select-left-task', { year }, { schema: overviewSchema, signal, silent: true });
}

// 处理时间写成"2026-10-17  10:14:15"（日期和时间之间两个空格），显示时合成一个
const rowSchema = z
  .object({
    year: z.string(),
    regionName: z.string(),
    name: z.string(),
    status: z.string(),
    completeTime: z.string().nullable(),
    cause: z.string().nullable()
  })
  .transform(row => ({
    year: row.year,
    regionName: row.regionName,
    name: row.name,
    status: taskStatusOf(row.status),
    statusText: row.status,
    completeTime: row.completeTime?.replace(/\s+/, ' ') ?? null,
    cause: row.cause
  }));

const optionSchema = <T extends string>(values: readonly [T, ...T[]]) =>
  z.object({ value: z.enum(values), label: z.string() });

const reportSchema = z
  .object({
    tableInfoList: z.array(rowSchema),
    totalNum: z.number(),
    processedNum: z.number(),
    failNum: z.number(),
    processingNum: z.number(),
    unProcessNum: z.number(),
    // 没有任务时是字符串 "NaN"
    progress: z.union([z.number(), z.literal('NaN')]),
    status: z.string().nullable(),
    tableTypeList: z.array(optionSchema(TABLE_TYPES)),
    levelList: z.array(optionSchema(AREA_LEVEL_IDS))
  })
  .transform(
    (data): ReportStatus => ({
      rows: data.tableInfoList,
      counts: {
        total: data.totalNum,
        completed: data.processedNum,
        failed: data.failNum,
        processing: data.processingNum,
        notStarted: data.unProcessNum
      },
      progress: data.progress === 'NaN' ? null : data.progress,
      statusText: data.status,
      tables: data.tableTypeList,
      levels: data.levelList
    })
  );

/** 查询状态；轮询中的失败由拥有者计数并显示，不弹提示 */
function fetchReport({ year, table, level }: ReportCriteria, signal?: AbortSignal) {
  return http.post(
    '/statistics/select-task-status',
    { year, tableType: table, level },
    { schema: reportSchema, signal, silent: true }
  );
}

// 创建的成功返回没有用到（写操作，没有实测），只判断业务码；失败原因由页面提示
const discardData = z.unknown().transform(() => undefined);

function createTasks(payload: CreateTaskPayload) {
  return http.post('/statistics/create-table', payload, { schema: discardData, silent: true });
}

/** 真实接口 */
export const statisticsApi: StatisticsApi = { fetchOverview, fetchReport, createTasks };
