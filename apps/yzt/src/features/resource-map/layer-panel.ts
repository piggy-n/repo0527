import type { SourceActivities } from '@mx/map-core';
import type { IconName } from '@/shared/icons/SvgIcon';
import type { CatalogNode } from '@/shared/map/layer-panel/catalog-tree';
import type { RequestSource } from '@/shared/map/request-status/request-status';
import type { CatalogCategory, ResourceGeometry } from './catalog';
import { addedCodes, type ResourceLayersState, resourceSourceId } from './resource-layers';

// 资源图层在面板上显示的数据（ADR 0157），都由显示状态推导；面板只显示和调用拥有者的操作

const RESOURCE_PREFIX = 'resource:';
const CATEGORY_PREFIX = 'resource-category:';

/** 资源在面板上的键：资源目录的项、当前图层的行都用它 */
export function resourceKey(code: string): string {
  return `${RESOURCE_PREFIX}${code}`;
}

/** 键对应的资源；不是资源的键时为 null */
export function resourceCodeOfKey(key: string): string | null {
  return key.startsWith(RESOURCE_PREFIX) ? key.slice(RESOURCE_PREFIX.length) : null;
}

/** 名称前的几何类型图标 */
export const GEOMETRY_ICONS: Readonly<Record<ResourceGeometry, IconName>> = {
  fill: 'geometry-polygon',
  line: 'geometry-line',
  circle: 'geometry-point'
};

/**
 * 资源目录的节点，按目录的顺序：目录顺序固定，和叠放顺序无关（ADR 0157，取代 ADR 0118）；没有资源的分类不显示。
 * 有关键字时（不区分大小写）只留名称命中的资源和它的路径，分类名称命中时留下它的全部资源
 */
export function resourceCatalogNodes(state: ResourceLayersState, keyword = ''): CatalogNode[] {
  const { catalog } = state;
  if (!catalog) {
    return [];
  }
  const needle = keyword.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);

  // keepAll：没有关键字，或者祖先分类的名称已经命中
  const categoryNode = (category: CatalogCategory, keepAll: boolean): CatalogNode | null => {
    const keep = keepAll || matches(category.name);
    const children = category.children.flatMap((child): CatalogNode[] => {
      if (child.kind === 'category') {
        const node = categoryNode(child, keep);
        return node ? [node] : [];
      }
      const resource = catalog.resources.get(child.code);
      if (!resource || !(keep || matches(resource.name))) {
        return [];
      }
      const added = state.displays.get(child.code)?.added ?? false;
      const icon = GEOMETRY_ICONS[resource.geometry];
      return [{ kind: 'leaf', key: resourceKey(child.code), label: resource.name, icon, added }];
    });
    return children.length > 0
      ? { kind: 'branch', key: `${CATEGORY_PREFIX}${category.id}`, label: category.name, children }
      : null;
  };

  return catalog.categories.flatMap(category => {
    const node = categoryNode(category, needle === '');
    return node ? [node] : [];
  });
}

/** 当前图层里的一个资源 */
export interface CurrentLayer {
  readonly code: string;
  readonly name: string;
  readonly geometry: ResourceGeometry;
  /** 0～1 */
  readonly opacity: number;
  /** 显示的年份 */
  readonly year: number;
  /** 可选的年份，新的在前；只有一个时不能切换（ADR 0052 第 1 节） */
  readonly years: readonly number[];
  /** 行首复选框：显示还是隐藏 */
  readonly visible: boolean;
}

/** 当前地图里的资源（包括隐藏的），按叠放顺序从上到下 */
export function currentLayers(state: ResourceLayersState): CurrentLayer[] {
  return addedCodes(state).flatMap(code => {
    const resource = state.catalog?.resources.get(code);
    const display = state.displays.get(code);
    if (!resource || !display) {
      return [];
    }
    const { name, geometry, years } = resource;
    const { opacity, year, checked } = display;
    return [{ code, name, geometry, opacity, year, years: years.toReversed(), visible: checked }];
  });
}

/** 请求状态里的资源（ADR 0158）：当前地图里画着、这一轮请求过瓦片的，按叠放顺序；键同当前图层的行，点了在那里选中 */
export function resourceRequests(state: ResourceLayersState, activities: SourceActivities): RequestSource[] {
  return currentLayers(state).flatMap(({ code, name, geometry }) => {
    const activity = activities.get(resourceSourceId(code));
    return activity ? [{ kind: 'tiles', key: resourceKey(code), name, icon: GEOMETRY_ICONS[geometry], activity }] : [];
  });
}
