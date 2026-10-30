import { z } from 'zod';
import { http } from '@/shared/http/client';
import { calculationResultValue, calculationRowStatus, type CalculationProgress } from './calculation';
import {
  dedupeIndicators,
  type IndicatorCategory,
  type IndicatorStatus,
  type IndicatorTreeNode
} from './indicator-tree';
import { type IndicatorResult, type ResultGeometry, resultLayersOf } from './result-layers';

// 返回结构按 2026-10-28 的实测写，见 docs/migration.md 的"城市国土空间监测指标：接口实测"

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
  fetchTree(
    source: IndicatorTreeSource,
    params: IndicatorTreeParams,
    signal?: AbortSignal
  ): Promise<IndicatorTreeNode[]>;
  /** 这些指标是否已有计算结果（重新计算前要确认） */
  verifyCalculation(params: CalculationParams): Promise<boolean>;
  startCalculation(params: CalculationParams): Promise<void>;
  /** 后端还没有这次计算的进度时为 null */
  fetchProgress(params: CalculationParams, signal?: AbortSignal): Promise<CalculationProgress | null>;
  /** 一个指标的成果，id 是展示树上的记录 ID */
  fetchResult(id: string, signal?: AbortSignal): Promise<IndicatorResult>;
}

interface RawIndicatorNode {
  /** 只有展示树有 */
  id?: string;
  dm: string;
  mc: string;
  /** 指标的统计范围（城区、全域）；分类是 null */
  bz: string | null;
  /** 是否禁用：城市体检评估的指标是布尔，分类和综合分析指标是字符串；展示树没有 */
  sfjy?: boolean | 'true' | 'false';
  /** 计算树才有；综合分析指标是空字符串 */
  status?: string;
  /** 计算树的城市体检评估和展示树有，没有结果时是空字符串 */
  result?: string;
  reason?: string;
  children: RawIndicatorNode[];
}

const rawNodeSchema: z.ZodType<RawIndicatorNode> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    dm: z.string(),
    mc: z.string(),
    bz: z.string().nullable(),
    sfjy: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
    status: z.string().optional(),
    result: z.string().optional(),
    reason: z.string().optional(),
    children: z.array(rawNodeSchema)
  })
);

// 实测只有"未处理""已完成"，计算中和失败的说法沿用旧页面的判断
function indicatorStatus(text: string | undefined): IndicatorStatus | null {
  if (text === undefined || text === '') {
    return null;
  }
  if (/失败|错误|异常/.test(text)) {
    return 'failed';
  }
  if (/完成|已处理|成功/.test(text)) {
    return 'done';
  }
  return /正在|处理中|计算中|进行中/.test(text) ? 'processing' : 'pending';
}

const emptyToNull = (text: string | undefined) => (text === undefined || text === '' ? null : text);

// 没有下级的分类（如综合分析指标的"福利设施普惠性"）没有统计范围，不是指标，不显示
function toNodes(nodes: readonly RawIndicatorNode[]): IndicatorTreeNode[] {
  return nodes.flatMap((node): IndicatorTreeNode[] => {
    if (node.children.length > 0) {
      return [{ kind: 'group', code: node.dm, name: node.mc, children: toNodes(node.children) }];
    }
    if (node.bz === null) {
      return [];
    }
    return [
      {
        kind: 'leaf',
        code: node.dm,
        dataId: node.id ?? null,
        name: node.mc,
        disabled: node.sfjy === true || node.sfjy === 'true',
        status: indicatorStatus(node.status),
        result: emptyToNull(node.result),
        reason: emptyToNull(node.reason)
      }
    ];
  });
}

// 展示树在这一年、这个范围没有成果时是 null；同一分类会重复出现多次，去重后只留一份
const treeSchema = z
  .array(rawNodeSchema)
  .nullable()
  .transform(nodes => dedupeIndicators(toNodes(nodes ?? [])));

const TREE_PATHS: Readonly<Record<IndicatorTreeSource, string>> = {
  calculation: '/api/analysis/tree/list',
  result: '/api/analysis/tree/out'
};

/** 指标树；失败时由全局提示给出原因（同旧页面），还没有可显示的树时树里另有重新加载 */
function fetchTree(
  source: IndicatorTreeSource,
  { category, regionCode, year }: IndicatorTreeParams,
  signal?: AbortSignal
) {
  return http.get(TREE_PATHS[source], { query: { type: category, regionCode, year }, schema: treeSchema, signal });
}

/** 验证失败不挡住计算（旧页面的处理），所以不弹提示 */
function verifyCalculation(params: CalculationParams) {
  return http.post('/api/analysis/verify', params, { schema: z.boolean(), silent: true });
}

// 开始计算是写操作，没有实测返回；只判断业务码，失败由全局提示显示原因
const discardData = z.unknown().transform(() => undefined);

function startCalculation(params: CalculationParams) {
  return http.post('/api/analysis/calculate', params, { schema: discardData });
}

// 另有 total、select、year、calculate 几个说明文字，和下面的指标行重复，不用
const progressSchema = z
  .object({
    ratio: z.number(),
    status: z.string(),
    calculate_data: z.array(z.object({ code: z.string(), name: z.string(), result: z.string() }))
  })
  .nullable()
  .transform((data): CalculationProgress | null => {
    if (data === null) {
      return null;
    }
    const rows = data.calculate_data.map(({ code, name, result }) => {
      const status = calculationRowStatus(result);
      return { code, name, status, result: status === 'completed' ? calculationResultValue(result) : null };
    });
    return {
      rows,
      percent: Math.min(100, Math.max(0, Math.round(data.ratio))),
      finished: data.ratio === 100,
      statusText: emptyToNull(data.status)
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

const GEOMETRIES = { POINT: 'point', LINE: 'line', POLYGON: 'fill' } as const satisfies Record<string, ResultGeometry>;

const resultSchema = z
  .object({
    id: z.string(),
    result: z.string(),
    layers: z.array(
      z.object({ gdbName: z.string(), chineseName: z.string(), type: z.enum(['POINT', 'LINE', 'POLYGON']) })
    )
  })
  .transform(
    (data): IndicatorResult => ({
      analysisId: data.id,
      value: data.result,
      layers: resultLayersOf(
        data.layers.map(layer => ({ key: layer.gdbName, name: layer.chineseName, geometry: GEOMETRIES[layer.type] }))
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
