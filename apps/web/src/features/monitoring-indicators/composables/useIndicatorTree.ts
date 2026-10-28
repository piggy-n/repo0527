import { computed, type ComputedRef, type Ref, shallowReadonly, shallowRef, watch } from 'vue';
import type { IndicatorApi, IndicatorTreeParams, IndicatorTreeSource } from '../api';
import {
  type IndicatorCategory,
  indicatorLeaves,
  type IndicatorLeaf,
  type IndicatorTreeNode
} from '../indicator-tree';
import { useIndicatorTreeQuery } from '../queries';
import type { IndicatorConditions } from './useIndicatorConditions';

/** 树的显示状态 */
export type IndicatorTreeState =
  /** 年份或监测范围没选，不请求 */
  | { readonly kind: 'waiting' }
  /** 还没有可显示的树 */
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  /** refreshing：显示着的是上一次的树，新的还在请求 */
  | { readonly kind: 'ready'; readonly nodes: readonly IndicatorTreeNode[]; readonly refreshing: boolean };

/** multiple：计算时可以多选，跨页签累计；single：展示时每个页签各选一个，只看当前页签的 */
export type IndicatorPickMode = 'multiple' | 'single';

export interface IndicatorTree {
  readonly mode: IndicatorPickMode;
  readonly category: Readonly<Ref<IndicatorCategory>>;
  readonly setCategory: (category: IndicatorCategory) => void;
  readonly state: ComputedRef<IndicatorTreeState>;
  /** 树上显示为勾选的指标编码 */
  readonly checked: ComputedRef<ReadonlySet<string>>;
  /** 选中的指标：多选时是全部页签的，按勾选的先后；单选时是当前页签的，最多一个 */
  readonly picked: ComputedRef<readonly IndicatorLeaf[]>;
  /** 勾选或取消一个指标；禁用的不变。单选时勾选会取消当前页签原来选的 */
  readonly toggle: (leaf: IndicatorLeaf, checked: boolean) => void;
  /** 全选或取消当前页签的全部可选指标（只用于多选） */
  readonly toggleAll: (checked: boolean) => void;
  readonly clear: () => void;
  /** 按当前条件重新请求 */
  readonly refresh: () => void;
}

export interface IndicatorTreeOptions {
  readonly api: IndicatorApi;
  readonly source: IndicatorTreeSource;
  readonly mode: IndicatorPickMode;
  readonly conditions: IndicatorConditions;
}

interface Pick {
  readonly leaf: IndicatorLeaf;
  readonly category: IndicatorCategory;
}

const sameParams = (a: IndicatorTreeParams, b: IndicatorTreeParams) =>
  a.category === b.category && a.regionCode === b.regionCode && a.year === b.year;

/** 一棵指标树：页签、加载和选择；在页面的 setup 中调用 */
export function useIndicatorTree({ api, source, mode, conditions }: IndicatorTreeOptions): IndicatorTree {
  const category = shallowRef<IndicatorCategory>('cstjpg');
  // 选择按编码记，不可变，变化时整体替换；记下所在页签，单选时每个页签各一个
  const picks = shallowRef<ReadonlyMap<string, Pick>>(new Map());

  const params = computed((): IndicatorTreeParams | null => {
    const year = conditions.year.value;
    const region = conditions.region.value;
    return year === null || region === null ? null : { category: category.value, regionCode: region.code, year };
  });
  const query = useIndicatorTreeQuery(api, source, () => params.value);

  const state = computed((): IndicatorTreeState => {
    if (params.value === null) {
      return { kind: 'waiting' };
    }
    const data = query.data.value;
    if (data === undefined) {
      return query.isError.value ? { kind: 'failed', message: query.error.value?.message ?? '' } : { kind: 'loading' };
    }
    return { kind: 'ready', nodes: data.nodes, refreshing: query.isFetching.value };
  });

  const visiblePicks = computed(() =>
    [...picks.value.values()].filter(pick => mode === 'multiple' || pick.category === category.value)
  );

  const replace = (next: Map<string, Pick>) => {
    picks.value = next;
  };

  const toggle = (leaf: IndicatorLeaf, checked: boolean) => {
    if (leaf.disabled) {
      return;
    }
    const next = new Map(picks.value);
    if (checked) {
      if (mode === 'single') {
        for (const [code, pick] of next) {
          if (pick.category === category.value) {
            next.delete(code);
          }
        }
      }
      next.set(leaf.code, { leaf, category: category.value });
    } else {
      next.delete(leaf.code);
    }
    replace(next);
  };

  const toggleAll = (checked: boolean) => {
    const current = state.value;
    if (mode !== 'multiple' || current.kind !== 'ready') {
      return;
    }
    const next = new Map(picks.value);
    for (const leaf of indicatorLeaves(current.nodes)) {
      if (leaf.disabled) {
        continue;
      }
      if (checked) {
        next.set(leaf.code, { leaf, category: category.value });
      } else {
        next.delete(leaf.code);
      }
    }
    replace(next);
  };

  // 新的树到了：当前页签里已经不在、变成禁用的指标取消选择，其余换成新的记录（名称、ID、状态可能随条件变化）
  watch(query.data, data => {
    const current = params.value;
    if (data === undefined || current === null || !sameParams(data.params, current)) {
      return;
    }
    const leaves = new Map(indicatorLeaves(data.nodes).map(leaf => [leaf.code, leaf]));
    const next = new Map<string, Pick>();
    let changed = false;
    for (const [code, pick] of picks.value) {
      if (pick.category !== current.category) {
        next.set(code, pick);
        continue;
      }
      const leaf = leaves.get(code);
      if (leaf === undefined || leaf.disabled) {
        changed = true;
        continue;
      }
      changed ||= leaf !== pick.leaf;
      next.set(code, { leaf, category: pick.category });
    }
    if (changed) {
      replace(next);
    }
  });

  const clear = () => {
    if (picks.value.size > 0) {
      replace(new Map());
    }
  };

  // 展示的选择属于当时的条件：换年份或监测范围后清空，在新的树上重新选
  if (mode === 'single') {
    watch([conditions.year, () => conditions.region.value?.code], clear);
  }

  return {
    mode,
    category: shallowReadonly(category),
    setCategory: value => (category.value = value),
    state,
    checked: computed(() => new Set(visiblePicks.value.map(pick => pick.leaf.code))),
    picked: computed(() => visiblePicks.value.map(pick => pick.leaf)),
    toggle,
    toggleAll,
    clear,
    // refetch 不看 enabled，条件不全时不调用
    refresh: () => {
      if (params.value !== null) {
        void query.refetch();
      }
    }
  };
}
