import type { CatalogCategory, ResourceGeometry } from './catalog';
import { CATALOG_ROOT, type CatalogOrder, EMPTY_CATALOG_ORDER, orderedChildren } from './catalog-order';
import type { ResourceLayersState } from './resource-layers';

// 图层面板显示的数据，都由显示状态推导；面板只显示和调用拥有者的操作（5C.2）

/** 分类的勾选状态：全部、部分、都没有勾选 */
export type CheckState = 'all' | 'some' | 'none';

export interface PanelResource {
  readonly kind: 'resource';
  readonly code: string;
  readonly name: string;
  /** 名称前的几何类型图标 */
  readonly geometry: ResourceGeometry;
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

/** 目录顺序里的键：分类的 id、资源的 code */
export function nodeKey(node: PanelNode): string {
  return node.kind === 'category' ? node.id : node.code;
}

function checkStateOf(codes: readonly string[], state: ResourceLayersState): CheckState {
  const checked = codes.filter(code => state.displays.get(code)?.checked).length;
  if (checked === 0) {
    return 'none';
  }
  return checked === codes.length ? 'all' : 'some';
}

/**
 * 面板上的目录树，按目录顺序，有用户调整过的目录顺序时按它排（ADR 0053 第 6 节）：没有资源的分类不显示。
 * 有关键字时（不区分大小写）只留名称命中的资源，分类名称命中时留下它的全部资源；分类的勾选和数量只算显示出来的资源
 */
export function panelTree(
  state: ResourceLayersState,
  keyword = '',
  order: CatalogOrder = EMPTY_CATALOG_ORDER
): PanelCategory[] {
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
      return [{ kind: 'resource', code: child.code, name: resource.name, geometry: resource.geometry, checked }];
    });
    const sorted = orderedChildren(children, nodeKey, order[category.id]);
    const codes = sorted.flatMap(child => (child.kind === 'resource' ? [child.code] : child.codes));
    if (codes.length === 0) {
      return null;
    }
    const { id, name } = category;
    return { kind: 'category', id, name, children: sorted, codes, checkState: checkStateOf(codes, state) };
  };

  const roots = catalog.categories.flatMap(category => {
    const node = categoryNode(category, needle === '');
    return node ? [node] : [];
  });
  return orderedChildren(roots, nodeKey, order[CATALOG_ROOT]);
}

// 子树里要展开的分类：all 为 true 时全部，否则只要含有勾选资源的
function expandedCategories(tree: readonly PanelNode[], all: boolean): string[] {
  return tree.flatMap(node =>
    node.kind === 'category' && (all || node.checkState !== 'none')
      ? [node.id, ...expandedCategories(node.children, all)]
      : []
  );
}

/**
 * 默认展开的分类：含有勾选资源的分类（同旧项目），进入页面时勾选的资源看得见；
 * 一个资源也没有勾选时展开全部（ADR 0094）
 */
export function expandedByDefault(tree: readonly PanelNode[]): Set<string> {
  const anyChecked = tree.some(node => (node.kind === 'category' ? node.checkState !== 'none' : node.checked));
  return new Set(expandedCategories(tree, !anyChecked));
}

export interface CheckedLayer {
  readonly code: string;
  readonly name: string;
  /** 0～1 */
  readonly opacity: number;
  /** 显示的年份 */
  readonly year: number;
  /** 可选的年份，新的在前；只有一个时不能切换（ADR 0052 第 1 节） */
  readonly years: readonly number[];
}

/** 已勾选的资源，按叠放顺序从上到下：在这里调整顺序、透明度和年份 */
export function checkedLayers(state: ResourceLayersState): CheckedLayer[] {
  return state.order.flatMap(code => {
    const resource = state.catalog?.resources.get(code);
    const display = state.displays.get(code);
    if (!resource || !display?.checked) {
      return [];
    }
    const { opacity, year } = display;
    return [{ code, name: resource.name, opacity, year, years: resource.years.toReversed() }];
  });
}

/**
 * 在"已选择图层"里拖到第 to 位（放下后在已勾选的列表里的位置）时交给拥有者 move 的位置：移到那个位置上原来的已勾选资源所在的位置，
 * 中间没勾选的资源不算。位置不变、不在"已选择图层"里时为 null；位置越界时抛错
 */
export function checkedDropTarget(state: ResourceLayersState, code: string, to: number): number | null {
  const codes = checkedLayers(state).map(layer => layer.code);
  const from = codes.indexOf(code);
  if (!(Number.isInteger(to) && to >= 0 && to < codes.length)) {
    throw new RangeError(`位置应在 0～${codes.length - 1} 之间，收到 ${to}`);
  }
  const neighbor = codes[to];
  return from === -1 || from === to || neighbor === undefined ? null : state.order.indexOf(neighbor);
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
