/** 行政区划等级，值是接口的 level */
export const AREA_LEVEL_IDS = ['province', 'city', 'district', 'county'] as const;
export type AreaLevel = (typeof AREA_LEVEL_IDS)[number];

export const AREA_LEVELS: readonly { readonly id: AreaLevel; readonly label: string }[] = [
  { id: 'province', label: '省级' },
  { id: 'city', label: '市级' },
  { id: 'district', label: '区级' },
  { id: 'county', label: '县级' }
];

/** 报表类型，值是接口的 tableType */
export const TABLE_TYPES = [
  'baseTable',
  'summaryTable',
  'changeTable',
  'waterBaseTable',
  'waterChangeTable',
  'entityChangeTable'
] as const;
export type TableType = (typeof TABLE_TYPES)[number];

export interface TableDefinition {
  readonly type: TableType;
  readonly name: string;
  /** 暂未开放的不能计算，总览里显示"暂未开放" */
  readonly enabled: boolean;
  /** 能统计的行政区划等级 */
  readonly levels: readonly AreaLevel[];
}

const ALL_LEVELS = AREA_LEVELS.map(level => level.id);

// 报表清单沿用旧页面：基本统计四级，汇总统计只有省、市两级，其余暂未开放
export const TABLES: readonly TableDefinition[] = [
  { type: 'baseTable', name: '基本统计报表', enabled: true, levels: ALL_LEVELS },
  { type: 'summaryTable', name: '汇总统计报表', enabled: true, levels: ['province', 'city'] },
  { type: 'changeTable', name: '变化统计报表', enabled: false, levels: ALL_LEVELS },
  { type: 'waterBaseTable', name: '水路网基本统计报表', enabled: false, levels: ALL_LEVELS },
  { type: 'waterChangeTable', name: '水路网变化统计报表', enabled: false, levels: ALL_LEVELS },
  { type: 'entityChangeTable', name: '实体变化统计报表', enabled: false, levels: ALL_LEVELS }
];

export const levelLabel = (level: AreaLevel): string => AREA_LEVELS.find(item => item.id === level)?.label ?? level;

export const tableName = (type: TableType): string => TABLES.find(item => item.type === type)?.name ?? type;

/** 页面各处年份的默认值：上一年（同旧页面） */
export function defaultYear(now = new Date()): string {
  return String(now.getFullYear() - 1);
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

/** 组合的键，勾选和跟踪都按它 */
export const tableLevelKey = ({ table, level }: TableLevel): string => `${table}:${level}`;

/** 可以计算的全部组合，按报表、等级的顺序 */
export const CALCULABLE: readonly TableLevel[] = TABLES.filter(table => table.enabled).flatMap(table =>
  table.levels.map(level => ({ table: table.type, level }))
);

/** 总览接口给出的各组合状态文字；没有任务时为 null */
export type OverviewStatuses = ReadonlyMap<string, string | null>;

/** 总览矩阵的一格：不支持的等级、暂未开放的报表不能点 */
export type OverviewCell =
  | { readonly kind: 'unsupported'; readonly level: AreaLevel }
  | { readonly kind: 'disabled'; readonly level: AreaLevel }
  | { readonly kind: TaskStatus; readonly level: AreaLevel; readonly text: string };

export interface OverviewRow {
  readonly table: TableType;
  readonly name: string;
  readonly disabled: boolean;
  readonly cells: readonly OverviewCell[];
}

/** 总览矩阵：行是全部报表，列固定为四个等级；还没取到时各组合按未处理显示 */
export function overviewMatrix(statuses: OverviewStatuses | null): OverviewRow[] {
  return TABLES.map(table => ({
    table: table.type,
    name: table.name,
    disabled: !table.enabled,
    cells: AREA_LEVELS.map(({ id: level }): OverviewCell => {
      if (!table.enabled) {
        return { kind: 'disabled', level };
      }
      if (!table.levels.includes(level)) {
        return { kind: 'unsupported', level };
      }
      const text = statuses?.get(tableLevelKey({ table: table.type, level })) ?? null;
      return { kind: taskStatusOf(text), level, text: text ?? '未处理' };
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
    const cell = row.cells.find(item => item.kind === 'completed' || item.kind === 'processing' || item.kind === 'failed');
    if (cell !== undefined) {
      return { table: row.table, level: cell.level };
    }
  }
  return null;
}

/** 一个报表要统计哪些等级 */
export interface LevelFlags {
  readonly year: string;
  readonly isProvince: boolean;
  readonly isCity: boolean;
  readonly isDistrict: boolean;
  readonly isCounty: boolean;
}

/** 创建任务的请求体：每个勾选了等级的报表一项（如 baseTableParam），字段名和结构沿用旧接口 */
export type CreateTaskPayload = { year: string } & Partial<Record<`${TableType}Param`, LevelFlags>>;

export function createTaskPayload(year: string, selected: readonly TableLevel[]): CreateTaskPayload {
  const payload: CreateTaskPayload = { year };
  for (const table of TABLES) {
    const levels = new Set(selected.filter(item => item.table === table.type).map(item => item.level));
    if (levels.size > 0) {
      payload[`${table.type}Param`] = {
        year,
        isProvince: levels.has('province'),
        isCity: levels.has('city'),
        isDistrict: levels.has('district'),
        isCounty: levels.has('county')
      };
    }
  }
  return payload;
}
