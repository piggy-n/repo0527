import { reactive } from 'vue';
import type { StatisticsApi } from '@/features/monitoring-statistics/api';
import type { ReportCriteria, ReportRow, ReportStatus } from '@/features/monitoring-statistics/report';
import {
  AREA_LEVELS,
  type AreaLevel,
  type CreateTaskPayload,
  tableLevelKey,
  tableOf,
  TABLES,
  type TableType,
  taskStatusOf
} from '@/features/monitoring-statistics/statistics';
import { ApiError } from '@/shared/http/errors';
import { districtsOf, JIANGSU_CITIES } from '@/shared/map/region/region-catalog';

/** 样例的开关：在页面上切换，下一次请求按新的开关返回 */
export interface DemoSwitches {
  /** 每个请求的延迟（毫秒） */
  latency: number;
  overviewFails: boolean;
  reportFails: boolean;
  /** 开始统计的结果：成功、被拒绝、没有明确结果（网络错误） */
  createResult: 'accepted' | 'rejected' | 'uncertain';
}

export const INITIAL_SWITCHES: Readonly<DemoSwitches> = {
  latency: 300,
  overviewFails: false,
  reportFails: false,
  createResult: 'accepted'
};

// 一个组合的一轮统计：从 startedAt 开始，在 duration 内逐张处理完；没有统计过的组合没有任务
interface DemoRun {
  readonly startedAt: number;
  readonly duration: number;
}

// 各等级的地区：区和县（市）按名称分开
const DISTRICTS = JIANGSU_CITIES.flatMap(city => districtsOf(city.code));
const REGIONS: Readonly<Record<AreaLevel, readonly string[]>> = {
  province: ['江苏省'],
  city: JIANGSU_CITIES.map(city => city.name),
  district: DISTRICTS.filter(region => region.name.endsWith('区')).map(region => region.name),
  county: DISTRICTS.filter(region => !region.name.endsWith('区')).map(region => region.name)
};

// 水路网报表的区县级包括区和县（市）
const regionsOf = (table: TableType, level: AreaLevel) =>
  tableOf(table).mergedDistrict && level === 'district' ? [...REGIONS.district, ...REGIONS.county] : REGIONS[level];

// 每个地区的统计表张数和名称里的简称
const TABLE_SHAPES: Readonly<Record<TableType, { readonly count: number; readonly short: string }>> = {
  baseTable: { count: 49, short: '城基' },
  summaryTable: { count: 44, short: '城汇' },
  baseChangeTable: { count: 36, short: '城变' },
  baseWaterTable: { count: 12, short: '水基' },
  changeWaterTable: { count: 12, short: '水变' },
  entityChangeTable: { count: 18, short: '实变' }
};

const pad = (value: number) => String(value).padStart(2, '0');
const formatTime = (time: number) => {
  const date = new Date(time);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// 每 37 张里固定有一张失败，备注写原因
const failsAt = (index: number) => index % 37 === 5;

// 2025 年六种报表、四个等级都可选；2026 年同实测只有基本统计的省、县级；其他年份什么都没有
function optionsOfYear(year: string): Pick<ReportStatus, 'tables' | 'levels'> {
  if (year === '2025') {
    return {
      tables: TABLES.map(table => ({ value: table.type, label: table.name })),
      levels: AREA_LEVELS.map(level => ({ value: level.id, label: level.label }))
    };
  }
  if (year === '2026') {
    return {
      tables: [{ value: 'baseTable', label: '基本统计报表' }],
      levels: [
        { value: 'province', label: '省级' },
        { value: 'county', label: '县级' }
      ]
    };
  }
  return { tables: [], levels: [] };
}

// 一轮统计按年份、本底年份（变化类报表）和组合区分
const runKey = ({ year, table, level, baseYear }: ReportCriteria) =>
  `${year}|${baseYear ?? '-'}|${tableLevelKey({ table, level })}`;

// 2025 年已统计完的组合：基本统计同实测是省、市、县级（区级还在处理），汇总统计的市级没有任务；
// 本底 2024 年的基本变化省、市级，水路网基本的省级、区县级，水路网变化的区县级
const FINISHED_2025: readonly ReportCriteria[] = [
  { year: '2025', table: 'baseTable', level: 'province', baseYear: null },
  { year: '2025', table: 'baseTable', level: 'city', baseYear: null },
  { year: '2025', table: 'baseTable', level: 'county', baseYear: null },
  { year: '2025', table: 'summaryTable', level: 'province', baseYear: null },
  { year: '2025', table: 'baseChangeTable', level: 'province', baseYear: '2024' },
  { year: '2025', table: 'baseChangeTable', level: 'city', baseYear: '2024' },
  { year: '2025', table: 'baseWaterTable', level: 'province', baseYear: null },
  { year: '2025', table: 'baseWaterTable', level: 'district', baseYear: null },
  { year: '2025', table: 'changeWaterTable', level: 'district', baseYear: '2024' }
];

/** 固定数据的接口，不请求后端；switches 由页面切换 */
export function createDemoApi(): { readonly api: StatisticsApi; readonly switches: DemoSwitches } {
  const switches = reactive<DemoSwitches>({ ...INITIAL_SWITCHES });
  const created = Date.now();
  // 2026 年只有可选项、没有任务
  const runs = new Map<string, DemoRun>([
    ...FINISHED_2025.map(criteria => [runKey(criteria), { startedAt: created - 3_600_000, duration: 60_000 }] as const),
    [
      runKey({ year: '2025', table: 'baseTable', level: 'district', baseYear: null }),
      { startedAt: created - 5000, duration: 45_000 }
    ]
  ]);

  const respond = <T>(produce: () => T, signal?: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          resolve(produce());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, switches.latency);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('请求已取消', 'AbortError'));
      });
    });

  const rowsOf = (criteria: ReportCriteria, now: number): ReportRow[] => {
    const { year, table, level } = criteria;
    const run = runs.get(runKey(criteria));
    if (run === undefined) {
      return [];
    }
    const shape = TABLE_SHAPES[table];
    const names = regionsOf(table, level).flatMap(region =>
      Array.from({ length: shape.count }, (_, index) => ({ region, name: `${region}${shape.short}1-${index + 1}表` }))
    );
    const step = run.duration / names.length;
    const finished = Math.min(names.length, Math.max(0, Math.floor((now - run.startedAt) / step)));
    return names.map(({ region, name }, index) => {
      let text = '未处理';
      if (index < finished) {
        text = failsAt(index) ? '处理失败' : '处理成功';
      } else if (index === finished && now >= run.startedAt) {
        text = '正在处理';
      }
      return {
        year,
        regionName: region,
        name,
        status: taskStatusOf(text),
        statusText: text,
        completeTime: index < finished ? formatTime(run.startedAt + step * (index + 1)) : null,
        cause: text === '处理失败' ? '缺少统计用的基础数据（样例）' : null
      };
    });
  };

  // 总览里一个组合的状态：没有任务为 null，处理完有失败的是"处理失败"
  const overviewText = (criteria: ReportCriteria, now: number): string | null => {
    const rows = rowsOf(criteria, now);
    if (rows.length === 0) {
      return null;
    }
    if (rows.some(row => row.status === 'processing' || row.status === 'notStarted')) {
      return '正在处理';
    }
    return rows.some(row => row.status === 'failed') ? '处理失败' : '处理成功';
  };

  const reportOf = (criteria: ReportCriteria): ReportStatus => {
    const rows = rowsOf(criteria, Date.now());
    const count = (status: ReportRow['status']) => rows.filter(row => row.status === status).length;
    const completed = count('completed');
    const failed = count('failed');
    return {
      rows,
      counts: {
        total: rows.length,
        completed,
        failed,
        processing: count('processing'),
        notStarted: count('notStarted')
      },
      progress: rows.length === 0 ? null : ((completed + failed) / rows.length) * 100,
      statusText: null,
      ...optionsOfYear(criteria.year)
    };
  };

  // 提交的组合 3 秒后开始、25 秒统计完；没有明确结果时任务照样在"后台"执行
  const start = (payload: CreateTaskPayload) => {
    const now = Date.now();
    for (const table of TABLES) {
      const flags = payload[`${table.type}Param`];
      if (flags === undefined) {
        continue;
      }
      const levels: AreaLevel[] = [];
      if (flags.isProvince) {
        levels.push('province');
      }
      if (flags.isCity) {
        levels.push('city');
      }
      if (flags.isDistrict) {
        levels.push('district');
      }
      if (flags.isCounty) {
        levels.push('county');
      }
      for (const level of levels) {
        runs.set(runKey({ year: payload.year, table: table.type, level, baseYear: flags.bdYear ?? null }), {
          startedAt: now + 3000,
          duration: 25_000
        });
      }
    }
  };

  const api: StatisticsApi = {
    fetchOverview: (year, baseYear, signal) =>
      respond(() => {
        if (switches.overviewFails) {
          throw new Error('报表计算总览获取失败（样例）');
        }
        const now = Date.now();
        return new Map(
          TABLES.flatMap(table =>
            table.levels.map(level => {
              const criteria = { year, table: table.type, level, baseYear: table.baseYear === null ? null : baseYear };
              return [tableLevelKey(criteria), overviewText(criteria, now)] as const;
            })
          )
        );
      }, signal),
    fetchReport: (criteria, signal) =>
      respond(() => {
        if (switches.reportFails) {
          throw new Error('查询统计任务状态失败（样例）');
        }
        return reportOf(criteria);
      }, signal),
    createTasks: payload =>
      respond(() => {
        if (switches.createResult === 'rejected') {
          throw new ApiError({ kind: 'business', message: '已有统计任务在执行，请稍后再试（样例）' });
        }
        start(payload);
        if (switches.createResult === 'uncertain') {
          throw new ApiError({ kind: 'network', message: '网络异常，未收到响应（样例）' });
        }
      })
  };
  return { api, switches };
}
