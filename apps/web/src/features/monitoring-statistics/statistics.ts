/** 行政区划等级，值是接口的 level */
export const AREA_LEVEL_IDS = ['province', 'city', 'district', 'county'] as const;
export type AreaLevel = (typeof AREA_LEVEL_IDS)[number];

export const AREA_LEVELS: readonly { readonly id: AreaLevel; readonly label: string }[] = [
  { id: 'province', label: '省级' },
  { id: 'city', label: '市级' },
  { id: 'district', label: '区级' },
  { id: 'county', label: '县级' }
];

/** 报表类型，值是接口的 tableType；名称、请求参数和状态字段按用户 2026-10-29 给出的对照 */
export const TABLE_TYPES = [
  'baseTable',
  'summaryTable',
  'baseChangeTable',
  'baseWaterTable',
  'changeWaterTable',
  'entityChangeTable'
] as const;
export type TableType = (typeof TABLE_TYPES)[number];

/** 变化类报表用哪个本底年份：基本变化、实体变化用变更本底，水路网变化用水路本底 */
export const BASE_YEAR_KINDS = ['change', 'water'] as const;
export type BaseYearKind = (typeof BASE_YEAR_KINDS)[number];

/** 两个本底年份 */
export type BaseYears = Readonly<Record<BaseYearKind, string>>;

export const BASE_YEAR_LABELS: Readonly<Record<BaseYearKind, string>> = { change: '变更本底', water: '水路本底' };

export interface TableDefinition {
  readonly type: TableType;
  readonly name: string;
  /** 能统计的行政区划等级 */
  readonly levels: readonly AreaLevel[];
  /** 区、县合成一级"区县级"，状态和请求都按 district（水路网报表） */
  readonly mergedDistrict: boolean;
  /** 变化类报表除了监测年份还要本底年份；其余为 null */
  readonly baseYear: BaseYearKind | null;
}

const ALL_LEVELS = AREA_LEVELS.map(level => level.id);
const WATER_LEVELS: readonly AreaLevel[] = ['province', 'city', 'district'];

// 基本统计、基本变化、实体变化四级；汇总统计只有省、市两级；两种水路网报表是省、市、区县三级
export const TABLES: readonly TableDefinition[] = [
  { type: 'baseTable', name: '基本统计报表', levels: ALL_LEVELS, mergedDistrict: false, baseYear: null },
  { type: 'summaryTable', name: '汇总统计报表', levels: ['province', 'city'], mergedDistrict: false, baseYear: null },
  { type: 'baseChangeTable', name: '基本变化统计报表', levels: ALL_LEVELS, mergedDistrict: false, baseYear: 'change' },
  { type: 'baseWaterTable', name: '水路网基本统计报表', levels: WATER_LEVELS, mergedDistrict: true, baseYear: null },
  { type: 'changeWaterTable', name: '水路网变化统计报表', levels: WATER_LEVELS, mergedDistrict: true, baseYear: 'water' },
  { type: 'entityChangeTable', name: '实体变化统计报表', levels: ALL_LEVELS, mergedDistrict: false, baseYear: 'change' }
];

export function tableOf(type: TableType): TableDefinition {
  const table = TABLES.find(item => item.type === type);
  if (!table) {
    throw new Error(`没有报表类型 ${type}`);
  }
  return table;
}

export const tableName = (type: TableType): string => tableOf(type).name;

/** 等级的名称；水路网报表的区级叫"区县级" */
export function levelLabel(level: AreaLevel, table?: TableType): string {
  if (level === 'district' && table !== undefined && tableOf(table).mergedDistrict) {
    return '区县级';
  }
  return AREA_LEVELS.find(item => item.id === level)?.label ?? level;
}

/** 页面各处年份的默认值：上一年（同旧页面） */
export function defaultYear(now = new Date()): string {
  return String(now.getFullYear() - 1);
}

/** 本底年份的默认值：监测年份的上一年；换监测年份时两个本底年份都回到它 */
export function defaultBaseYears(year: string): BaseYears {
  const previous = String(Number(year) - 1);
  return { change: previous, water: previous };
}

/** 本底年份要早于监测年份 */
export const isBaseYearValid = (year: string, baseYear: string) => Number(baseYear) < Number(year);

/** 报表在这组本底年份下用哪一年；不是变化类报表时为 null */
export function baseYearFor(table: TableType, baseYears: BaseYears): string | null {
  const kind = tableOf(table).baseYear;
  return kind === null ? null : baseYears[kind];
}

/** 一个统计任务的状态 */
export type TaskStatus = 'completed' | 'processing' | 'failed' | 'notStarted';

/** 按后端的状态文字判断；没有状态、"未处理"和认不出的都算未处理（同旧页面） */
export function taskStatusOf(text: string | null): TaskStatus {
  if (text === null) {
    return 'notStarted';
  }
  if (text.includes('正在处理')) {
    return 'processing';
  }
  if (text === '处理成功' || text === '处理完成') {
    return 'completed';
  }
  return text === '处理失败' ? 'failed' : 'notStarted';
}

/** 一个报表类型和行政区划等级的组合 */
export interface TableLevel {
  readonly table: TableType;
  readonly level: AreaLevel;
}

/** 组合的键，勾选和总览的状态都按它 */
export const tableLevelKey = ({ table, level }: TableLevel): string => `${table}:${level}`;

/** 可以计算的全部组合，按报表、等级的顺序 */
export const CALCULABLE: readonly TableLevel[] = TABLES.flatMap(table =>
  table.levels.map(level => ({ table: table.type, level }))
);

/** 总览接口给出的各组合状态文字；没有任务时为 null */
export type OverviewStatuses = ReadonlyMap<string, string | null>;

/**
 * 总览按本底年份分别查到的状态合成一份：变化类报表取自己本底年份的那一份，其余报表各份都一样，取第一份。
 * 两个本底年份相同时只查一次
 */
export function mergeOverview(
  byBaseYear: ReadonlyMap<string, OverviewStatuses>,
  baseYears: BaseYears
): OverviewStatuses {
  const first = byBaseYear.values().next().value;
  const merged = new Map<string, string | null>();
  for (const table of TABLES) {
    const statuses = table.baseYear === null ? first : byBaseYear.get(baseYears[table.baseYear]);
    for (const level of table.levels) {
      const key = tableLevelKey({ table: table.type, level });
      merged.set(key, statuses?.get(key) ?? null);
    }
  }
  return merged;
}

/** 总览矩阵的一格：不支持的等级不能点；水路网的区县级占区级、县级两列（merged） */
export type OverviewCell =
  | { readonly kind: 'unsupported'; readonly level: AreaLevel }
  | { readonly kind: TaskStatus; readonly level: AreaLevel; readonly text: string; readonly merged: boolean };

export interface OverviewRow {
  readonly table: TableType;
  readonly name: string;
  readonly cells: readonly OverviewCell[];
}

/** 总览矩阵：行是全部报表，列固定为四个等级；还没取到时各组合按未处理显示 */
export function overviewMatrix(statuses: OverviewStatuses | null): OverviewRow[] {
  return TABLES.map(table => ({
    table: table.type,
    name: table.name,
    cells: AREA_LEVELS.flatMap(({ id: level }): OverviewCell[] => {
      // 区县级那一格已经占了县级这一列
      if (table.mergedDistrict && level === 'county') {
        return [];
      }
      if (!table.levels.includes(level)) {
        return [{ kind: 'unsupported', level }];
      }
      const text = statuses?.get(tableLevelKey({ table: table.type, level })) ?? null;
      const merged = table.mergedDistrict && level === 'district';
      return [{ kind: taskStatusOf(text), level, text: text ?? '未处理', merged }];
    })
  }));
}

/** 总览里有处理中的组合：总览要定时跟进 */
export function hasProcessing(rows: readonly OverviewRow[]): boolean {
  return rows.some(row => row.cells.some(cell => cell.kind === 'processing'));
}

/** 已有结果的组合（成功、失败、处理中）；初次进入时当前组合没有结果，就落到第一个有结果的 */
export function firstWithResult(rows: readonly OverviewRow[]): TableLevel | null {
  for (const row of rows) {
    const cell = row.cells.find(
      item => item.kind === 'completed' || item.kind === 'processing' || item.kind === 'failed'
    );
    if (cell !== undefined) {
      return { table: row.table, level: cell.level };
    }
  }
  return null;
}

/** 一个报表的统计参数：哪些等级，变化类报表另带本底年份 */
export interface TableParam {
  readonly year: string;
  readonly bdYear?: string;
  readonly isProvince: boolean;
  readonly isCity: boolean;
  readonly isDistrict: boolean;
  readonly isCounty: boolean;
}

/** 创建任务的请求体：每个勾选了等级的报表一项，键是 tableType 加 Param（如 baseChangeTableParam） */
export type CreateTaskPayload = { year: string } & Partial<Record<`${TableType}Param`, TableParam>>;

/** 水路网的区县级按 district 传：isDistrict 为 true、isCounty 为 false */
export function createTaskPayload(
  year: string,
  baseYears: BaseYears,
  selected: readonly TableLevel[]
): CreateTaskPayload {
  const payload: CreateTaskPayload = { year };
  for (const table of TABLES) {
    const levels = new Set(selected.filter(item => item.table === table.type).map(item => item.level));
    if (levels.size > 0) {
      payload[`${table.type}Param`] = {
        year,
        ...(table.baseYear === null ? {} : { bdYear: baseYears[table.baseYear] }),
        isProvince: levels.has('province'),
        isCity: levels.has('city'),
        isDistrict: levels.has('district'),
        isCounty: levels.has('county')
      };
    }
  }
  return payload;
}
