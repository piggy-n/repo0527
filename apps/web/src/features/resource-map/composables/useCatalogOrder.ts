import { type ShallowRef, shallowRef } from 'vue';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import { type CatalogOrder, EMPTY_CATALOG_ORDER, moveInCatalog, storedCatalogOrderSchema } from '../catalog-order';

/** 目录的展示顺序的拥有者（ADR 0053 第 6 节）：只管面板上的树怎么排，和叠放顺序互不影响 */
export interface CatalogOrderOwner {
  readonly order: Readonly<ShallowRef<CatalogOrder>>;
  /** 把 parentId 下的第 from 个子节点移到第 to 位；keys 是面板上这个父节点下的子节点，按当前的展示顺序。位置越界时抛错 */
  readonly move: (parentId: string, keys: readonly string[], from: number, to: number) => void;
}

export interface UseCatalogOrderOptions {
  /** 页面提供时按账号记住（ADR 0042）；不提供时不读不写 */
  readonly preferences?: PreferenceScope | null;
}

/** 创建目录顺序的拥有者，在页面的 setup 中调用；存下的顺序读到后替换，和最新目录的合并在推导面板的树时做 */
export function useCatalogOrder({ preferences }: UseCatalogOrderOptions = {}): CatalogOrderOwner {
  const order = shallowRef<CatalogOrder>(EMPTY_CATALOG_ORDER);

  if (preferences) {
    usePreference(preferences, {
      name: 'resource-catalog-order',
      version: 1,
      schema: storedCatalogOrderSchema,
      snapshot: () => order.value,
      restore: stored => {
        if (stored) {
          order.value = stored;
        }
      }
    });
  }

  return {
    order,
    move: (parentId, keys, from, to) => {
      order.value = moveInCatalog(order.value, parentId, keys, from, to);
    }
  };
}
