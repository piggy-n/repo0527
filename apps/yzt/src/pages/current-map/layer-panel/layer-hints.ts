import { z } from 'zod';
import type { ResourceStatusKind } from '@/features/resource-map/resource-status';
import type { RequestKinds } from '@/shared/map/request-status/request-status';

// 图层行内的提示和数据加载明细的开关（用户 2026-11-17，ADR 0167）：按类开关，关掉的一类在行内、状态栏的条目和明细里都不显示

/** 提示的种类，按设置里的先后：前三类同时管数据加载的条目和明细 */
export const LAYER_HINTS = ['loading', 'failed', 'done', 'config-error', 'minzoom', 'covering'] as const;

export type LayerHint = (typeof LAYER_HINTS)[number];

/** 设置里的名称和说明 */
export const LAYER_HINT_TEXTS: Readonly<Record<LayerHint, { readonly name: string; readonly detail: string }>> = {
  loading: { name: '加载中', detail: '名称后转圈，数据加载里的"加载中"' },
  failed: { name: '加载失败', detail: '瓦片、模型加载失败的图标和重试，数据加载里的"有失败"' },
  done: { name: '加载完成', detail: '数据加载里的"已完成"和"已加载完成"' },
  'config-error': { name: '配置错误', detail: '资源的配置不对、画不出来' },
  minzoom: { name: '未到显示级别', detail: '放大到第几级才显示' },
  covering: { name: '盖住模型', detail: '三维里排在模型上面、接近不透明的面' }
};

/** 设置里的两组 */
export const LAYER_HINT_GROUPS: readonly { readonly title: string; readonly hints: readonly LayerHint[] }[] = [
  { title: '数据加载', hints: ['loading', 'failed', 'done'] },
  { title: '图层状态', hints: ['config-error', 'minzoom', 'covering'] }
];

/** 记下的设置：只记关掉的；认不出的忽略，以后加的种类默认开着 */
export const storedLayerHintsSchema = z.object({ hidden: z.array(z.string()) });

export type StoredLayerHints = z.infer<typeof storedLayerHintsSchema>;

const isLayerHint = (value: string): value is LayerHint => (LAYER_HINTS as readonly string[]).includes(value);

/** 记下的设置里开着的种类 */
export function shownHintsOf(stored: StoredLayerHints): ReadonlySet<LayerHint> {
  const hidden = new Set(stored.hidden.filter(isLayerHint));
  return new Set(LAYER_HINTS.filter(hint => !hidden.has(hint)));
}

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
