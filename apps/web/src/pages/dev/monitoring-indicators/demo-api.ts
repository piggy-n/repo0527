import { reactive } from 'vue';
import type { CalculationParams, IndicatorApi } from '@/features/monitoring-indicators/api';
import { type CalculationProgress, calculationRowStatus } from '@/features/monitoring-indicators/calculation';
import type {
  IndicatorCategory,
  IndicatorLeaf,
  IndicatorStatus,
  IndicatorTreeNode
} from '@/features/monitoring-indicators/indicator-tree';
import { type ResultLayerSource, resultLayersOf } from '@/features/monitoring-indicators/result-layers';

/** 样例的开关：在页面上切换，下一次请求按新的开关返回 */
export interface DemoSwitches {
  /** 每个请求的延迟（毫秒） */
  latency: number;
  treeFails: boolean;
  treeEmpty: boolean;
  progressFails: boolean;
  resultFails: boolean;
}

export const INITIAL_SWITCHES: Readonly<DemoSwitches> = {
  latency: 500,
  treeFails: false,
  treeEmpty: false,
  progressFails: false,
  resultFails: false
};

interface DemoIndicator {
  readonly code: string;
  readonly name: string;
  readonly disabled: boolean;
  /** 计算完成后改写 */
  status: IndicatorStatus | null;
  result: string | null;
  reason: string | null;
  readonly layers: readonly ResultLayerSource[];
}

interface DemoGroup {
  readonly code: string;
  readonly name: string;
  readonly children: readonly (DemoGroup | DemoIndicator)[];
}

// 设施覆盖类只有一个点图层（旗子）；公园类两个点图层（圆点）
const coverage = (facility: string): ResultLayerSource[] => [
  { key: 'facility', name: `${facility}点`, geometry: 'point' },
  { key: 'road', name: '路网', geometry: 'line' },
  { key: 'covered', name: '已覆盖城镇住宅及宅基地', geometry: 'fill' },
  { key: 'uncovered', name: '未覆盖城镇住宅及宅基地', geometry: 'fill' },
  { key: 'range', name: `${facility}覆盖范围`, geometry: 'fill' },
  { key: 'urban', name: '城区范围面', geometry: 'fill' }
];

const PARKS: readonly ResultLayerSource[] = [
  { key: 'entrance', name: '公园绿地出入口', geometry: 'point' },
  { key: 'square', name: '广场中心点', geometry: 'point' },
  { key: 'park', name: '公园绿地广场', geometry: 'fill' },
  { key: 'urban', name: '城区范围面', geometry: 'fill' }
];

const indicator = (
  code: string,
  name: string,
  status: IndicatorStatus | null,
  extra: Partial<Pick<DemoIndicator, 'result' | 'reason' | 'disabled' | 'layers'>> = {}
): DemoIndicator => ({
  code,
  name,
  status,
  result: extra.result ?? null,
  reason: extra.reason ?? null,
  disabled: extra.disabled ?? false,
  layers: extra.layers ?? coverage('设施')
});

// 两个页签：多层分类、长名称、禁用、各种计算状态各有一个
function demoTrees(): Readonly<Record<IndicatorCategory, readonly DemoGroup[]>> {
  return {
    cstjpg: [
      {
        code: 'G-01',
        name: '生态宜居',
        children: [
          indicator('A-01', '建成区绿化覆盖率(%)', 'done', { result: '分析结果:43.78%', layers: PARKS }),
          indicator('A-02', '人均公园绿地面积(㎡)', 'pending', { layers: PARKS })
        ]
      },
      {
        code: 'G-02',
        name: '安全韧性',
        children: [
          indicator('A-03', '人均避难场所面积(㎡)', 'failed', { reason: '缺少避难场所数据' }),
          indicator('A-04', '内涝风险区覆盖率(%)', null, { disabled: true })
        ]
      }
    ],
    zhfxzb: [
      {
        code: 'G-11',
        name: '生活宜居便利',
        children: [
          {
            code: 'G-12',
            name: '教育便利性',
            children: [
              indicator('B-01', '社区幼儿园步行5分钟覆盖率(%)', 'done', {
                result: '分析结果:70.12%',
                layers: coverage('幼儿园')
              })
            ]
          },
          {
            code: 'G-13',
            name: '交通出行便利性',
            children: [
              indicator('B-02', '公交站点步行5分钟覆盖率(%)', 'processing', { layers: coverage('公交站') }),
              indicator('B-03', '轨道站点步行10分钟覆盖率(%)', null, { disabled: true })
            ]
          },
          indicator('B-04', '15分钟社区生活圈内基本公共服务设施步行可达覆盖率(%)', 'pending', {
            layers: coverage('公共服务设施')
          })
        ]
      }
    ]
  };
}

const allIndicators = (nodes: readonly (DemoGroup | DemoIndicator)[]): DemoIndicator[] =>
  nodes.flatMap(node => ('children' in node ? allIndicators(node.children) : [node]));

// 展示树只要计算完成的指标，分类空了不显示；展示树不带计算状态
function toNodes(nodes: readonly (DemoGroup | DemoIndicator)[], onlyDone: boolean): IndicatorTreeNode[] {
  return nodes.flatMap((node): IndicatorTreeNode[] => {
    if ('children' in node) {
      const children = toNodes(node.children, onlyDone);
      return children.length > 0 ? [{ kind: 'group', code: node.code, name: node.name, children }] : [];
    }
    if (onlyDone && node.status !== 'done') {
      return [];
    }
    const leaf: IndicatorLeaf = {
      kind: 'leaf',
      code: node.code,
      dataId: `demo-${node.code}`,
      name: node.name,
      disabled: node.disabled,
      status: onlyDone ? null : node.status,
      result: node.result,
      reason: node.reason
    };
    return [leaf];
  });
}

// 一次计算的标识：查进度时的条件和开始计算时一致
const runKey = ({ analysisCode, regionCode, year }: CalculationParams) => `${year}-${regionCode}-${analysisCode}`;

/** 固定数据的接口，不请求后端；switches 由页面切换 */
export function createDemoApi(): { readonly api: IndicatorApi; readonly switches: DemoSwitches } {
  const switches = reactive<DemoSwitches>({ ...INITIAL_SWITCHES });
  const trees = demoTrees();
  const byCode = new Map(Object.values(trees).flatMap(groups => allIndicators(groups)).map(item => [item.code, item]));
  // 每次计算开始的时间；第 i 个指标在开始后 6 + 5i 秒结束，名字带"避难"的失败
  const runs = new Map<string, number>();

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

  const progressOf = (params: CalculationParams): CalculationProgress => {
    const elapsed = (Date.now() - (runs.get(runKey(params)) ?? Date.now())) / 1000;
    const rows = params.analysisCode.split(',').map((code, index) => {
      const item = byCode.get(code);
      const name = item?.name ?? code;
      const endsAt = 6 + index * 5;
      let text = '';
      if (elapsed >= endsAt) {
        text = name.includes('避难') ? '计算失败' : `分析结果:${(40 + index * 7.31).toFixed(2)}%`;
      } else if (elapsed >= endsAt - 5) {
        text = '正在处理';
      }
      const status = calculationRowStatus(text);
      // 结束的写回指标树，刷新后能看到
      if (item && (status === 'completed' || status === 'failed')) {
        item.status = status === 'completed' ? 'done' : 'failed';
        item.result = status === 'completed' ? text : null;
        item.reason = status === 'failed' ? '缺少避难场所数据' : null;
      }
      return { code, name, status, result: status === 'completed' ? text : null };
    });
    const resolved = rows.filter(row => row.status === 'completed' || row.status === 'failed').length;
    const percent = Math.round((resolved / rows.length) * 100);
    return { rows, percent, finished: percent === 100, statusText: null };
  };

  const api: IndicatorApi = {
    fetchTree: (source, { category }, signal) =>
      respond(() => {
        if (switches.treeFails) {
          throw new Error('指标树加载失败（样例）');
        }
        return switches.treeEmpty ? [] : toNodes(trees[category], source === 'result');
      }, signal),
    verifyCalculation: ({ analysisCode }) =>
      respond(() => analysisCode.split(',').some(code => byCode.get(code)?.status === 'done')),
    startCalculation: params => respond(() => void runs.set(runKey(params), Date.now())),
    fetchProgress: (params, signal) =>
      respond(() => {
        if (switches.progressFails) {
          throw new Error('进度查询失败（样例）');
        }
        return progressOf(params);
      }, signal),
    fetchResult: (id, signal) =>
      respond(() => {
        if (switches.resultFails) {
          throw new Error('指标成果加载失败（样例）');
        }
        const item = byCode.get(id.replace(/^demo-/, ''));
        if (item === undefined) {
          throw new Error(`样例里没有 ${id}`);
        }
        const value = item.result === null ? null : item.result.replace(/^.*[:：]/, '');
        return { analysisId: id, value, layers: resultLayersOf(item.layers) };
      }, signal)
  };
  return { api, switches };
}
