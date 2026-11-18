import type { ResourceStatusKind } from '@/features/resource-map/resource-status';
import type { LayerHint } from '@/shared/config/layer-hints';
import type { RequestKinds } from '@/shared/map/request-status/request-status';

// 图层行内提示的开关（ADR 0167）怎样落到数据加载和资源行上：开关在 .env，由 appConfig.layerHints 给出

/** 数据加载的条目、明细和行内的转圈、失败显示哪几类 */
export function requestKindsOf(shown: ReadonlySet<LayerHint>): RequestKinds {
  return { loading: shown.has('loading'), failed: shown.has('failed'), done: shown.has('done') };
}

/** 资源行的状态图标显示哪几种：瓦片加载失败跟着"加载失败" */
export function resourceStatusKindsOf(shown: ReadonlySet<LayerHint>): readonly ResourceStatusKind[] {
  const kinds: [ResourceStatusKind, LayerHint][] = [
    ['config-error', 'config-error'],
    ['tile-error', 'failed'],
    ['minzoom', 'minzoom']
  ];
  return kinds.flatMap(([kind, hint]) => (shown.has(hint) ? [kind] : []));
}
