import type { CatalogCategory, ResourceGeometry } from './catalog';
import { CATALOG_ROOT, type TreeMove } from './catalog-order';
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
 * 面板上的目录树，按叠放顺序（ADR 0118）：同一个父节点下的子节点按它们最靠前的资源在 state.order 里的位置排；没有资源的分类不显示。
 * 有关键字时（不区分大小写）只留名称命中的资源，分类名称命中时留下它的全部资源；分类的勾选和数量只算显示出来的资源
 */
export function panelTree(state: ResourceLayersState, keyword = ''): PanelCategory[] {
  const { catalog, order } = state;
  if (!catalog) {
    return [];
  }
  const needle = keyword.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const position = new Map(order.map((code, index) => [code, index]));
  // 子节点按它最靠前的资源排，不在顺序里的排在最后；顺序整理过，同一个分类的资源连在一起
  const rankOf = (node: PanelNode) => {
    const codes = node.kind === 'resource' ? [node.code] : node.codes;
    return Math.min(order.length, ...codes.map(code => position.get(code) ?? order.length));
  };
  const sortedNodes = <T extends PanelNode>(nodes: readonly T[]) => nodes.toSorted((a, b) => rankOf(a) - rankOf(b));

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
    const sorted = sortedNodes(children);
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
  return sortedNodes(roots);
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

// 目录树里从顶层到资源的每一层：父节点、这一层的子节点，以及其中通往资源的那个
interface TreeStep {
  readonly parentId: string;
  readonly keys: readonly string[];
  readonly key: string;
}

function pathTo(nodes: readonly PanelNode[], code: string, parentId: string): TreeStep[] | null {
  const keys = nodes.map(nodeKey);
  for (const node of nodes) {
    if (node.kind === 'resource' && node.code === code) {
      return [{ parentId, keys, key: code }];
    }
    if (node.kind === 'category' && node.codes.includes(code)) {
      const rest = pathTo(node.children, code, node.id);
      return rest && [{ parentId, keys, key: node.id }, ...rest];
    }
  }
  return null;
}

/**
 * 把 code 挪到 neighbor 原来的位置（neighbor 在上面时挪到它上面，在下面时挪到它下面）对应的目录树调整：两者在同一个分类下时直接换位，
 * 否则在两者分开的那一层，code 所在的分类整体挪到 neighbor 所在的分类旁边，同一个分类的资源总是连在一起（ADR 0118）
 */
function moveBeside(state: ResourceLayersState, code: string, neighbor: string): TreeMove | null {
  const tree = panelTree(state);
  const own = pathTo(tree, code, CATALOG_ROOT) ?? [];
  const other = pathTo(tree, neighbor, CATALOG_ROOT) ?? [];
  const level = own.findIndex((step, index) => step.key !== other[index]?.key);
  const step = own[level];
  const beside = other[level];
  if (!step || !beside) {
    return null;
  }
  const { parentId, keys } = step;
  return { parentId, keys, from: keys.indexOf(step.key), to: keys.indexOf(beside.key) };
}

/**
 * 在"已选择图层"里拖到第 to 位（放下后在已勾选的列表里的位置）时交给拥有者 move 的调整：挪到那个位置上原来的已勾选资源旁边，
 * 中间没勾选的资源不算，跨分类时整个分类一起挪。位置不变、不在"已选择图层"里时为 null；位置越界时抛错
 */
export function checkedDropTarget(state: ResourceLayersState, code: string, to: number): TreeMove | null {
  const codes = checkedLayers(state).map(layer => layer.code);
  const from = codes.indexOf(code);
  if (!(Number.isInteger(to) && to >= 0 && to < codes.length)) {
    throw new RangeError(`位置应在 0～${codes.length - 1} 之间，收到 ${to}`);
  }
  const neighbor = codes[to];
  return from === -1 || from === to || neighbor === undefined ? null : moveBeside(state, code, neighbor);
}

/**
 * 在已勾选的资源之间上移、下移一位时交给拥有者 move 的调整：和相邻的已勾选资源换位，中间没勾选的资源不算，
 * 跨分类时整个分类一起挪。已经在最上面、最下面，或者没有勾选时为 null
 */
export function moveTarget(state: ResourceLayersState, code: string, direction: 'up' | 'down'): TreeMove | null {
  const codes = checkedLayers(state).map(layer => layer.code);
  const index = codes.indexOf(code);
  const neighbor = index === -1 ? undefined : codes[direction === 'up' ? index - 1 : index + 1];
  return neighbor === undefined ? null : moveBeside(state, code, neighbor);
}
