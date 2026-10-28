import { z } from 'zod';
import { http } from '@/shared/http/client';
import { calculationRowStatus, type CalculationProgress } from './calculation';
import {
  dedupeIndicators,
  type IndicatorCategory,
  indicatorResultValue,
  type IndicatorStatus,
  type IndicatorTreeNode
} from './indicator-tree';
import { type IndicatorResult, type ResultGeometry, resultLayersOf } from './result-layers';

// 待实测：字段先按旧页面实际读取的写，真实返回核对后收紧（docs/migration.md）

/** 指标树的来源：计算用全部指标（/tree/list），展示只要计算完成的（/tree/out） */
export type IndicatorTreeSource = 'calculation' | 'result';

export interface IndicatorTreeParams {
  readonly category: IndicatorCategory;
  readonly regionCode: string;
  readonly year: number;
}

/** 开始计算、处理前验证、查询进度共用的条件；analysisCode 是逗号连接的指标编码，查进度时要和开始计算时一致 */
export interface CalculationParams {
  readonly year: number;
  readonly regionCode: string;
  readonly analysisCode: string;
}

/** 指标页用到的接口；拥有者通过它请求，组件样例换成固定数据的实现 */
export interface IndicatorApi {
  fetchTree(source: IndicatorTreeSource, params: IndicatorTreeParams, signal?: AbortSignal): Promise<IndicatorTreeNode[]>;
  /** 这些指标是否已有计算结果（重新计算前要确认） */
  verifyCalculation(params: CalculationParams): Promise<boolean>;
  startCalculation(params: CalculationParams): Promise<void>;
  fetchProgress(params: CalculationParams, signal?: AbortSignal): Promise<CalculationProgress>;
  /** 一个指标的成果，id 是指标树上的记录 ID */
  fetchResult(id: string, signal?: AbortSignal): Promise<IndicatorResult>;
}

interface RawIndicatorNode {
  id?: string | null;
  dm: string;
  mc: string;
  sfjy?: unknown;
  status?: string | number | null;
  result?: string | null;
  reason?: string | null;
  children?: RawIndicatorNode[] | null;
}

const rawNodeSchema: z.ZodType<RawIndicatorNode> = z.lazy(() =>
  z.object({
    id: z.string().nullish(),
    dm: z.string(),
    mc: z.string(),
    sfjy: z.unknown().optional(),
    status: z.union([z.string(), z.number()]).nullish(),
    result: z.string().nullish(),
    reason: z.string().nullish(),
    children: z.array(rawNodeSchema).nullish()
  })
);

const NUMBERED_STATUS: Readonly<Record<string, IndicatorStatus>> = {
  '0': 'pending',
  '1': 'processing',
  '2': 'done',
  '3': 'failed'
};

// 状态可能是文字或 0～3（旧页面两种都处理）
function indicatorStatus(raw: string | number | null | undefined): IndicatorStatus | null {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return null;
  }
  if (/^\d+$/.test(text)) {
    return NUMBERED_STATUS[text] ?? 'pending';
  }
  if (/失败|错误|异常/.test(text)) {
    return 'failed';
  }
  if (/完成|已处理|成功/.test(text)) {
    return 'done';
  }
  return /正在|处理中|计算中|进行中/.test(text) ? 'processing' : 'pending';
}

const blankToNull = (text: string | null | undefined) => (text === undefined || text === null || text.trim() === '' ? null : text.trim());

function toNode(raw: RawIndicatorNode): IndicatorTreeNode {
  const children = raw.children ?? [];
  if (children.length > 0) {
    return { kind: 'group', code: raw.dm, name: raw.mc, children: children.map(toNode) };
  }
  return {
    kind: 'leaf',
    code: raw.dm,
    dataId: raw.id ?? '',
    name: raw.mc,
    disabled: Boolean(raw.sfjy),
    status: indicatorStatus(raw.status),
    result: blankToNull(raw.result),
    reason: blankToNull(raw.reason)
  };
}

const treeSchema = z.array(rawNodeSchema).transform(nodes => dedupeIndicators(nodes.map(toNode)));

const TREE_PATHS: Readonly<Record<IndicatorTreeSource, string>> = {
  calculation: '/api/analysis/tree/list',
  result: '/api/analysis/tree/out'
};

/** 指标树；失败时由全局提示给出原因（同旧页面），还没有可显示的树时树里另有重新加载 */
function fetchTree(source: IndicatorTreeSource, { category, regionCode, year }: IndicatorTreeParams, signal?: AbortSignal) {
  return http.get(TREE_PATHS[source], { query: { type: category, regionCode, year }, schema: treeSchema, signal });
}

/** 验证失败不挡住计算（旧页面的处理），所以不弹提示 */
function verifyCalculation(params: CalculationParams) {
  return http.post('/api/analysis/verify', params, { schema: z.boolean(), silent: true });
}

// 开始计算的成功返回没有用到，只判断业务码；失败由全局提示显示原因
const discardData = z.unknown().transform(() => undefined);

function startCalculation(params: CalculationParams) {
  return http.post('/api/analysis/calculate', params, { schema: discardData });
}

const progressSchema = z
  .object({
    ratio: z.number().nullish(),
    status: z.string().nullish(),
    calculate_data: z
      .array(z.object({ code: z.string(), name: z.string().nullish(), result: z.string().nullish() }))
      .nullish()
  })
  .transform((data): CalculationProgress => {
    const rows = (data.calculate_data ?? []).map(row => {
      const result = (row.result ?? '').trim();
      const status = calculationRowStatus(result);
      return { code: row.code, name: row.name ?? '', status, result: status === 'completed' ? result : null };
    });
    const resolved = rows.filter(row => row.status === 'completed' || row.status === 'failed').length;
    const ratio = data.ratio ?? null;
    const percent = ratio === null ? Math.round((resolved / Math.max(rows.length, 1)) * 100) : Math.round(ratio);
    return {
      rows,
      percent: Math.min(100, Math.max(0, percent)),
      finished: ratio === 100,
      statusText: blankToNull(data.status)
    };
  });

/** 查询进度；轮询中的失败由拥有者计数，不弹提示 */
function fetchProgress(params: CalculationParams, signal?: AbortSignal) {
  return http.get('/api/analysis/progress', {
    query: { year: params.year, regionCode: params.regionCode, analysisCode: params.analysisCode },
    schema: progressSchema,
    signal,
    silent: true
  });
}

// 几何类型是 Point、MultiLineString 这样的写法
function resultGeometry(type: string): ResultGeometry {
  const text = type.toUpperCase();
  if (text.includes('POINT')) {
    return 'point';
  }
  return text.includes('LINE') ? 'line' : 'fill';
}

const resultSchema = z
  .object({
    id: z.string(),
    result: z.string().nullish(),
    layers: z.array(z.object({ gdbName: z.string(), chineseName: z.string().nullish(), geomType: z.string() }))
  })
  .transform(
    (data): IndicatorResult => ({
      analysisId: data.id,
      value: blankToNull(data.result) === null ? null : indicatorResultValue(data.result ?? ''),
      layers: resultLayersOf(
        data.layers.map(layer => ({
          key: layer.gdbName,
          name: blankToNull(layer.chineseName) ?? layer.gdbName,
          geometry: resultGeometry(layer.geomType)
        }))
      )
    })
  );

/** 指标成果；失败由成果面板显示并重试 */
function fetchResult(id: string, signal?: AbortSignal) {
  return http.get('/api/analysis/indicate', { query: { id }, schema: resultSchema, signal, silent: true });
}

/** 真实接口 */
export const indicatorApi: IndicatorApi = {
  fetchTree,
  verifyCalculation,
  startCalculation,
  fetchProgress,
  fetchResult
};
