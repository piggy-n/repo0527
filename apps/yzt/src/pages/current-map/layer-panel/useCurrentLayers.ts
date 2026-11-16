import { computed, type ComputedRef, shallowRef } from 'vue';
import type { ResourceLayers } from '@/features/resource-map/composables/useResourceLayers';
import { currentLayers, resourceCodeOfKey, resourceKey } from '@/features/resource-map/layer-panel';
import type { SceneModels } from '@/features/scene-models/composables/useSceneModels';
import { modelIdOfKey, modelKey } from '@/features/scene-models/layer-panel';
import { layerInsertIndex, layersAboveModels, mergedOrder, movedOrder } from './current-list';

/** 图层里平铺的二维资源和三维模型（ADR 0161）：页面创建，面板显示和操作，地图按它放模型层、点选按它取锚点 */
export interface CurrentLayers {
  /** 图层里的行，从上到下就是叠放：资源和模型的键 */
  readonly keys: ComputedRef<readonly string[]>;
  /** 画在模型上面的资源：排在最上面那个模型上面的，从上到下；没有模型时没有 */
  readonly overModels: ComputedRef<readonly string[]>;
  /** 图层里有显示着的模型："盖住模型"和斜着看时的提示只在这时出现 */
  readonly shownModel: ComputedRef<boolean>;
  /** 加入：模型放在最上面，资源放在最上面那个模型的下面（没有模型时在最上面）；各自保持给出的先后 */
  readonly add: (keys: readonly string[]) => void;
  /** 移出，设置留在各自的拥有者里 */
  readonly remove: (keys: readonly string[]) => void;
  /** 把一行挪到看得见的行（默认全部）的第 to 位，看不见的行不动（见 movedOrder）；位置越界时抛错 */
  readonly move: (key: string, to: number, visible?: readonly string[]) => void;
}

type ResourceOwner = Pick<ResourceLayers, 'state' | 'add' | 'remove' | 'moveLayer'>;
type ModelOwner = Pick<SceneModels, 'models' | 'added' | 'hidden' | 'add' | 'remove' | 'moveModel'>;

/**
 * 图层的平铺列表（ADR 0161）：资源之间的先后在资源的拥有者里（记在偏好里），模型之间的先后在模型的拥有者里（不持久化），
 * 两者怎样穿插记在这里，不持久化；进页面时没有模型，列表就是资源的先后
 */
export function useCurrentLayers(resources: ResourceOwner, models: ModelOwner): CurrentLayers {
  const layerKeys = computed(() => currentLayers(resources.state.value).map(layer => resourceKey(layer.code)));
  // 模型清单里还有的（清单刷新后没有了的不显示）
  const modelKeys = computed(() => {
    const known = new Set(models.models.value.map(model => model.id));
    return models.added.value.flatMap(id => (known.has(id) ? [modelKey(id)] : []));
  });
  // 上次操作以后的顺序：只用它的穿插，内容按拥有者合并（mergedOrder）
  const settled = shallowRef<readonly string[]>([]);
  const keys = computed(() => mergedOrder(settled.value, layerKeys.value, modelKeys.value));
  // 操作前后记下合并的结果：之后再来新的模型，之前由合并放下的行不跟着换位置
  const settle = () => {
    settled.value = keys.value;
  };

  const add = (added: readonly string[]) => {
    const codes = added.flatMap(key => resourceCodeOfKey(key) ?? []);
    const ids = added.flatMap(key => modelIdOfKey(key) ?? []);
    settle();
    // 先加模型：同一批里的资源放在新的最上面那个模型下面
    if (ids.length > 0) {
      models.add(ids);
      settle();
    }
    if (codes.length > 0) {
      resources.add(codes, layerInsertIndex(keys.value));
      settle();
    }
  };

  const remove = (removed: readonly string[]) => {
    resources.remove(removed.flatMap(key => resourceCodeOfKey(key) ?? []));
    models.remove(removed.flatMap(key => modelIdOfKey(key) ?? []));
    settle();
  };

  // 资源、模型各自的先后交给拥有者：一行挪动只改变它在同类里的位置
  const move = (key: string, to: number, visible: readonly string[] = keys.value) => {
    const next = movedOrder(keys.value, visible, key, to);
    if (!next) {
      return;
    }
    settled.value = next;
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
