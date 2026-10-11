import type { ResourceTreeCategory, ResourceTreeLayer, ResourceTreeNode } from './api';

/** 资源的几何类型，对应 MapLibre 的图层类型 */
export type ResourceGeometry = 'fill' | 'line' | 'circle';

/** 一个资源（ADR 0041 第 1 节）：身份是 code，年份另外选 */
export interface Resource {
  readonly code: string;
  readonly name: string;
  readonly geometry: ResourceGeometry;
  /** 升序、不重复 */
  readonly years: readonly number[];
  readonly categoryId: string;
  /** 在目录里的顺序，默认配色按它从配色板取 */
  readonly index: number;
}

export interface CatalogCategory {
  readonly kind: 'category';
  /** 名称路径，如"基础库 / 土地资源"：有的分类 code 是 null */
  readonly id: string;
  readonly name: string;
  readonly children: readonly CatalogNode[];
}

export interface CatalogResourceNode {
  readonly kind: 'resource';
  readonly code: string;
}

export type CatalogNode = CatalogCategory | CatalogResourceNode;

/** 目录里不该出现的数据：实测没有出现，出现时按第一次出现的为准 */
export type CatalogProblem =
  | { readonly kind: 'code-in-two-categories'; readonly code: string; readonly categoryIds: readonly string[] }
  | { readonly kind: 'conflicting-geometry'; readonly code: string; readonly geometries: readonly ResourceGeometry[] }
  | { readonly kind: 'duplicate-category'; readonly id: string };

export interface ResourceCatalog {
  /** 顶层分组，保持接口的顺序；空分类也保留，面板决定是否显示 */
  readonly categories: readonly CatalogCategory[];
  /** 按目录顺序 */
  readonly resources: ReadonlyMap<string, Resource>;
  readonly problems: readonly CatalogProblem[];
}

const GEOMETRY: Readonly<Record<ResourceTreeLayer['geoType'], ResourceGeometry>> = {
  Polygon: 'fill',
  Line: 'line',
  Point: 'circle'
};

const isCategory = (node: ResourceTreeNode): node is ResourceTreeCategory => 'children' in node;

/** 由接口树得出目录：按 code 去重并合并年份；不抛错，异常数据记进 problems（目录在 computed 里得出，ADR 0028） */
export function buildCatalog(tree: readonly ResourceTreeCategory[]): ResourceCatalog {
  const resources = new Map<string, Resource>();
  const problems: CatalogProblem[] = [];
  const categoryIds = new Set<string>();

  const addLayer = (layer: ResourceTreeLayer, categoryId: string): CatalogResourceNode | null => {
    const geometry = GEOMETRY[layer.geoType];
    const existing = resources.get(layer.code);
    if (!existing) {
      resources.set(layer.code, {
        code: layer.code,
        name: layer.name,
        geometry,
        years: [...new Set(layer.yearList)].toSorted((a, b) => a - b),
        categoryId,
        index: resources.size
      });
      return { kind: 'resource', code: layer.code };
    }
    // 后端按"图层 × 年份"逐条返回：同一个 code 重复出现时合并年份，其余以第一次出现的为准
    resources.set(layer.code, {
      ...existing,
      years: [...new Set([...existing.years, ...layer.yearList])].toSorted((a, b) => a - b)
    });
    if (existing.categoryId !== categoryId) {
      problems.push({
        kind: 'code-in-two-categories',
        code: layer.code,
        categoryIds: [existing.categoryId, categoryId]
      });
    }
    if (existing.geometry !== geometry) {
      problems.push({ kind: 'conflicting-geometry', code: layer.code, geometries: [existing.geometry, geometry] });
    }
    return null;
  };

  const addCategory = (category: ResourceTreeCategory, path: readonly string[]): CatalogCategory => {
    const names = [...path, category.name];
    const id = names.join(' / ');
    if (categoryIds.has(id)) {
      problems.push({ kind: 'duplicate-category', id });
    }
    categoryIds.add(id);
    const children = category.children.flatMap(child => {
      const node = isCategory(child) ? addCategory(child, names) : addLayer(child, id);
      return node ? [node] : [];
    });
    return { kind: 'category', id, name: category.name, children };
  };

  const categories = tree.map(category => addCategory(category, []));
  return { categories, resources, problems };
}
