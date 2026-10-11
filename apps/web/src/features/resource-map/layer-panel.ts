import type { CatalogCategory } from './catalog';
import type { ResourceLayersState } from './resource-layers';

// 图层面板显示的数据，都由显示状态推导；面板只显示和调用拥有者的操作（5C.2）

/** 分类的勾选状态：全部、部分、都没有勾选 */
export type CheckState = 'all' | 'some' | 'none';

export interface PanelResource {
  readonly kind: 'resource';
  readonly code: string;
  readonly name: string;
  readonly checked: boolean;
}

export interface PanelCategory {
  readonly kind: 'category';
  readonly id: string;
  readonly name: string;
  readonly children: readonly PanelNode[];
  /** 分类下显示出来的全部资源：勾选分类时一起勾选，数量显示在分类旁边 */
  readonly codes: readonly string[];
  readonly checkState: CheckState;
}

export type PanelNode = PanelCategory | PanelResource;

function checkStateOf(codes: readonly string[], state: ResourceLayersState): CheckState {
  const checked = codes.filter(code => state.displays.get(code)?.checked).length;
  if (checked === 0) {
    return 'none';
  }
  return checked === codes.length ? 'all' : 'some';
}

/**
 * 面板上的目录树，按目录顺序：没有资源的分类不显示。有关键字时（不区分大小写）只留名称命中的资源，
 * 分类名称命中时留下它的全部资源；分类的勾选和数量只算显示出来的资源
 */
export function panelTree(state: ResourceLayersState, keyword = ''): PanelCategory[] {
  const { catalog } = state;
  if (!catalog) {
    return [];
  }
  const needle = keyword.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);

  // keepAll：没有关键字，或者祖先分类的名称已经命中
  const categoryNode = (category: CatalogCategory, keepAll: boolean): PanelCategory | null => {
    const keep = keepAll || matches(category.name);
    const children = category.children.flatMap((child): PanelNode[] => {
      if (child.kind === 'category') {
        const node = categoryNode(child, keep);
        return node ? [node] : [];
      }
      const resource = catalog.resources.get(child.code);
      if (!resource || !(keep || matches(resource.name))) {
        return [];
      }
      const checked = state.displays.get(child.code)?.checked ?? false;
      return [{ kind: 'resource', code: child.code, name: resource.name, checked }];
    });
    const codes = children.flatMap(child => (child.kind === 'resource' ? [child.code] : child.codes));
    if (codes.length === 0) {
      return null;
    }
    const { id, name } = category;
    return { kind: 'category', id, name, children, codes, checkState: checkStateOf(codes, state) };
  };

  return catalog.categories.flatMap(category => {
    const node = categoryNode(category, needle === '');
    return node ? [node] : [];
  });
}

/** 默认展开的分类：含有勾选资源的分类（同旧项目），进入页面时勾选的资源看得见 */
export function expandedByDefault(tree: readonly PanelNode[]): Set<string> {
  return new Set(
    tree.flatMap(node =>
      node.kind === 'category' && node.checkState !== 'none' ? [node.id, ...expandedByDefault(node.children)] : []
    )
  );
}

export interface CheckedLayer {
  readonly code: string;
  readonly name: string;
  /** 0～1 */
  readonly opacity: number;
}

/** 已勾选的资源，按叠放顺序从上到下：在这里调整顺序和透明度 */
export function checkedLayers(state: ResourceLayersState): CheckedLayer[] {
  return state.order.flatMap(code => {
    const resource = state.catalog?.resources.get(code);
    const display = state.displays.get(code);
    return resource && display?.checked ? [{ code, name: resource.name, opacity: display.opacity }] : [];
  });
}

/**
 * 在已勾选的资源之间上移、下移一位时交给拥有者 move 的位置：移到相邻的已勾选资源所在的位置，中间没勾选的资源不算。
 * 已经在最上面、最下面，或者没有勾选时为 null
 */
export function moveTarget(state: ResourceLayersState, code: string, direction: 'up' | 'down'): number | null {
  const codes = checkedLayers(state).map(layer => layer.code);
  const index = codes.indexOf(code);
  const neighbor = index === -1 ? undefined : codes[direction === 'up' ? index - 1 : index + 1];
  return neighbor === undefined ? null : state.order.indexOf(neighbor);
}
