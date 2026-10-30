import type { RelationKind } from './relation-graph';

export interface RelationKindStyle {
  label: string;
  description: string;
  /** 线的颜色，和白底的对比度不低于 3:1 */
  color: string;
  /** SVG 的 stroke-dasharray，实线为 null */
  dash: string | null;
}

// 关系图的配色属于图表，不进界面令牌（和 graph-style.ts 一样）；线型和颜色一起区分关系，色弱时也能分辨
export const RELATION_KIND_STYLES: Readonly<Record<RelationKind, RelationKindStyle>> = {
  'class-mapping': {
    label: '分类对应',
    description: '不同数据成果之间的分类编码对应',
    color: '#3355d6',
    dash: null
  },
  temporal: { label: '时序关联', description: '同一类对象在不同时期的数据', color: '#b46b00', dash: '1 4' },
  'field-mapping': {
    label: '字段映射',
    description: '数据表之间的字段对标、编码转换',
    color: '#15803d',
    dash: '7 4'
  },
  spatial: { label: '空间关联', description: '要素之间的空间叠加、包含', color: '#be185d', dash: '12 4 2 4' }
};

// 泳道顶边的颜色，按数据成果在数据里的顺序取，不和关系线的颜色重复
const PRODUCT_COLORS = ['#6d28d9', '#0f766e', '#c2410c', '#0369a1', '#4d7c0f', '#9d174d'] as const;

export function productColor(index: number): string {
  return PRODUCT_COLORS[index % PRODUCT_COLORS.length];
}
