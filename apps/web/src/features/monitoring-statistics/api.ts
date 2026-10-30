import { z } from 'zod';
import { http } from '@/shared/http/client';
import type { ReportCriteria, ReportStatus } from './report';
import {
  AREA_LEVEL_IDS,
  type AreaLevel,
  type CreateTaskPayload,
  type OverviewStatuses,
  TABLE_TYPES,
  tableLevelKey,
  tableName,
  TABLES,
  type TableType,
  taskStatusOf
} from './statistics';

// 返回结构按 2026-10-28 的实测写，见 docs/migration.md 的"城市国土空间监测基本统计：接口实测"；
// 四种新报表的参数和状态字段按用户 2026-10-29 给出的对照（同旧仓库 master-next 的 c79e7e6）

/** 统计页用到的接口；拥有者通过它请求，组件样例换成固定数据的实现 */
export interface StatisticsApi {
  /** 一年里各报表、各等级的处理状态（总览矩阵）；变化类报表的状态按 baseYear 这个本底年份 */
  fetchOverview(year: string, baseYear: string, signal?: AbortSignal): Promise<OverviewStatuses>;
  /** 一份报表的处理状态和全部统计表 */
  fetchReport(criteria: ReportCriteria, signal?: AbortSignal): Promise<ReportStatus>;
  /** 提交统计任务；写操作，失败时抛出 ApiError */
  createTasks(payload: CreateTaskPayload): Promise<void>;
}

// 总览里各报表、各等级的状态字段；水路网的区县级只有 district 一个字段
const STATUS_FIELDS: Readonly<Record<TableType, Partial<Record<AreaLevel, string>>>> = {
  baseTable: {
    province: 'baseProvinceStatus',
    city: 'baseCityStatus',
    district: 'baseDistrictStatus',
    county: 'baseCountyStatus'
  },
  summaryTable: { province: 'summaryProvinceStatus', city: 'summaryCityStatus' },
  baseChangeTable: {
    province: 'baseChangeProvinceStatus',
    city: 'baseChangeCityStatus',
    district: 'baseChangeDistrictStatus',
    county: 'baseChangeCountyStatus'
  },
  baseWaterTable: {
    province: 'baseWaterProvinceStatus',
    city: 'baseWaterCityStatus',
    district: 'baseWaterDistrictStatus'
  },
  changeWaterTable: {
    province: 'changeWaterProvinceStatus',
    city: 'changeWaterCityStatus',
    district: 'changeWaterDistrictStatus'
  },
  entityChangeTable: {
    province: 'entityChangeProvinceStatus',
    city: 'entityChangeCityStatus',
    district: 'entityChangeDistrictStatus',
    county: 'entityChangeCountyStatus'
  }
};

/** 一个组合在总览里的状态字段 */
export function statusField(table: TableType, level: AreaLevel): string {
  const field = STATUS_FIELDS[table][level];
  if (field === undefined) {
    throw new Error(`${tableName(table)}没有${level}的状态字段`);
  }
  return field;
}

// 两个查询接口返回同一个结构，各接口只填自己用到的字段，其余是 null。实测过的基本统计、汇总统计的字段一定有；
// 四种新报表的字段 2026-10-29 的后端还没有返回，缺少时按没有任务
const nullableText = z.string().nullable();
const MEASURED: ReadonlySet<TableType> = new Set(['baseTable', 'summaryTable']);
const overviewSchema = z
  .object(
    Object.fromEntries(
      TABLES.flatMap(table =>
        table.levels.map(level => [
          statusField(table.type, level),
          MEASURED.has(table.type) ? nullableText : nullableText.optional()
        ])
      )
    )
  )
  .transform(
    (data): OverviewStatuses =>
      new Map(
        TABLES.flatMap(table =>
          table.levels.map(level => [
            tableLevelKey({ table: table.type, level }),
            data[statusField(table.type, level)] ?? null
          ])
        )
      )
  );

/** 查询接口没有失败提示时由页面显示原因，所以不弹全局提示 */
function fetchOverview(year: string, baseYear: string, signal?: AbortSignal) {
  return http.post(
    '/statistics/select-left-task',
    { year, bdYear: baseYear },
    { schema: overviewSchema, signal, silent: true }
  );
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
      // 报表名称统一按前端的叫法（旧后端把基本变化叫"变化统计报表"）
      tables: data.tableTypeList.map(option => ({ value: option.value, label: tableName(option.value) })),
      levels: data.levelList
    })
  );

/** 查询状态；变化类报表另传本底年份。轮询中的失败由拥有者计数并显示，不弹提示 */
function fetchReport({ year, table, level, baseYear }: ReportCriteria, signal?: AbortSignal) {
  return http.post(
    '/statistics/select-task-status',
    { year, ...(baseYear === null ? {} : { bdYear: baseYear }), tableType: table, level },
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
