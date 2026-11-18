/**
 * 图层行内提示的种类（ADR 0167）：部署时在 .env 里用总开关 VITE_LAYER_HINTS_ENABLED 和每类的 VITE_LAYER_HINT_* 开关，
 * 关掉的一类在图层行内、状态栏的条目和数据加载的明细里都不显示。前三类同时管数据加载的条目和明细
 */
export const LAYER_HINTS = ['loading', 'failed', 'done', 'config-error', 'minzoom', 'covering'] as const;

export type LayerHint = (typeof LAYER_HINTS)[number];
