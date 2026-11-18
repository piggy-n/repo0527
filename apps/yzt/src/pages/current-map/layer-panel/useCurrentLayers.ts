import { computed, type ComputedRef, shallowRef, watch } from 'vue';
import { z } from 'zod';
import type { ResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { currentLayers, resourceCodeOfKey, resourceKey } from '@/features/resource-map/layer-panel';
import type { SceneModels } from '@/features/scene-models/composables/useSceneModels';
import { modelIdOfKey, modelKey } from '@/features/scene-models/layer-panel';
import type { PreferenceScope } from '@/shared/storage/preference-scope';
import { usePreference } from '@/shared/storage/use-preference';
import { layersAboveModels, mergedOrder, movedOrder, withPending } from './current-list';

/** 图层里平铺的二维资源和三维模型（ADR 0161）：页面创建，面板显示和操作，地图按它放模型层、点选按它取锚点 */
export interface CurrentLayers {
  /** 图层里的行，从上到下就是叠放：资源和模型的键 */
  readonly keys: ComputedRef<readonly string[]>;
  /** 画在模型上面的资源：排在最上面那个模型上面的，从上到下；没有模型时没有 */
  readonly overModels: ComputedRef<readonly string[]>;
  /** 图层里有显示着的模型："盖住模型"只在这时出现 */
  readonly shownModel: ComputedRef<boolean>;
  /** 加入：不论模型还是资源，整批放在最上面，批内保持给出的先后（用户 2026-11-17，ADR 0167）；已经在的不动 */
  readonly add: (keys: readonly string[]) => void;
  /** 移出，设置留在各自的拥有者里 */
  readonly remove: (keys: readonly string[]) => void;
  /** 把一行挪到看得见的行（默认全部）的第 to 位，看不见的行不动（见 movedOrder）；位置越界时抛错 */
  readonly move: (key: string, to: number, visible?: readonly string[]) => void;
}

export interface CurrentLayersOptions {
  /** 偏好范围：给了就按账号记住列表的顺序（ADR 0167）；开发页不传 */
  readonly preferences?: PreferenceScope | null;
}

type ResourceOwner = Pick<ResourceLayers, 'state' | 'add' | 'remove' | 'moveLayer'>;
type ModelOwner = Pick<SceneModels, 'models' | 'restored' | 'added' | 'hidden' | 'add' | 'remove' | 'moveModel'>;

/** 记下的图层顺序（ADR 0167）：资源和模型的键，从上到下，不重复 */
export const storedCurrentLayersSchema = z
  .object({ order: z.array(z.string().regex(/^(resource|model):.+$/)) })
  .refine(({ order }) => new Set(order).size === order.length, { message: '图层的顺序里有重复的行' });

/**
 * 图层的平铺列表（ADR 0161、0167）：资源之间的先后在资源的拥有者里，模型之间的先后在模型的拥有者里，两者怎样穿插记在这里；
 * 三者都按账号记住。只在加入、移出、移动时记下顺序，恢复和目录到达引起的变化不算用户的操作
 */
export function useCurrentLayers(
  resources: ResourceOwner,
  models: ModelOwner,
  { preferences = null }: CurrentLayersOptions = {}
): CurrentLayers {
  const layerKeys = computed(() => currentLayers(resources.state.value).map(layer => resourceKey(layer.code)));
  // 模型清单里还有的（清单刷新后没有了的不显示）
  const modelKeys = computed(() => {
    const known = new Set(models.models.value.map(model => model.id));
    return models.added.value.flatMap(id => (known.has(id) ? [modelKey(id)] : []));
  });
  const present = computed(() => new Set([...layerKeys.value, ...modelKeys.value]));
  // 资源目录和模型清单都到了、记下的也都恢复了：这之后顺序里还没出现的就是没有了，不再留位置
  const ready = computed(() => resources.state.value.catalog !== null && models.restored.value);
  // 记下的顺序：只用它的穿插，内容按拥有者合并（mergedOrder）；还没到的项留着位置
  const settled = shallowRef<readonly string[]>([]);
  const keys = computed(() => mergedOrder(settled.value, layerKeys.value, modelKeys.value));
  // 现在的顺序加上还没到的项：操作都在它上面做，免得目录、清单没到时一操作就把它们的位置丢了
  const fullOrder = () => (ready.value ? keys.value : withPending(keys.value, settled.value, present.value));

  if (preferences) {
    usePreference(preferences, {
      name: 'current-layers',
      version: 1,
      schema: storedCurrentLayersSchema,
      snapshot: () => ({ order: [...settled.value] }),
      restore: stored => {
        if (stored) {
          settled.value = stored.order;
        }
      }
    });
  }
  // 都到齐以后丢掉没有了的项（换了服务器、目录里删了）
  watch(
    () => [ready.value, settled.value] as const,
    ([isReady, order]) => {
      if (isReady && order.some(key => !present.value.has(key))) {
        settled.value = order.filter(key => present.value.has(key));
      }
    },
    { immediate: true }
  );

  const add = (added: readonly string[]) => {
    const before = fullOrder();
    const fresh = [...new Set(added)].filter(
      key => !before.includes(key) && (resourceCodeOfKey(key) !== null || modelIdOfKey(key) !== null)
    );
    if (fresh.length === 0) {
      return;
    }
    const ids = fresh.flatMap(key => modelIdOfKey(key) ?? []);
    const codes = fresh.flatMap(key => resourceCodeOfKey(key) ?? []);
    if (ids.length > 0) {
      models.add(ids);
    }
    if (codes.length > 0) {
      resources.add(codes, 0);
    }
    // 后加入的压在最上面：拥有者里也都放在最前，和列表的先后一致
    settled.value = [...fresh.filter(key => present.value.has(key)), ...before];
  };

  const remove = (removed: readonly string[]) => {
    const gone = new Set(removed);
    const before = fullOrder();
    resources.remove(removed.flatMap(key => resourceCodeOfKey(key) ?? []));
    models.remove(removed.flatMap(key => modelIdOfKey(key) ?? []));
    settled.value = before.filter(key => !gone.has(key));
  };

  // 资源、模型各自的先后交给拥有者：一行挪动只改变它在同类里的位置
  const move = (key: string, to: number, visible: readonly string[] = keys.value) => {
    const next = movedOrder(keys.value, visible, key, to);
    if (!next) {
      return;
    }
    settled.value = ready.value ? next : withPending(next, settled.value, present.value);
    const code = resourceCodeOfKey(key);
    const id = modelIdOfKey(key);
    if (code !== null) {
      resources.moveLayer(code, next.filter(item => resourceCodeOfKey(item) !== null).indexOf(key));
    } else if (id !== null) {
      models.moveModel(id, next.filter(item => modelIdOfKey(item) !== null).indexOf(key));
    }
  };

  return {
    keys,
    overModels: computed(() => layersAboveModels(keys.value).flatMap(key => resourceCodeOfKey(key) ?? [])),
    shownModel: computed(() =>
      modelKeys.value.some(key => {
        const id = modelIdOfKey(key);
        return id !== null && !models.hidden.value.has(id);
      })
    ),
    add,
    remove,
    move
  };
}
