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
  /**
   * 图层里能不能有三维模型：二三维共用一套时总是能（二维里模型行变淡）；二维、三维各一套时只有三维的能，二维的列表只有资源
   * （ADR 0169），面板的目录这时也不列出模型
   */
  readonly holdsModels: ComputedRef<boolean>;
  /** 画在模型上面的资源：排在最上面那个模型上面的，从上到下；没有模型时没有 */
  readonly overModels: ComputedRef<readonly string[]>;
  /** 图层里有显示着的模型："盖住模型"只在这时出现 */
  readonly shownModel: ComputedRef<boolean>;
  /**
   * 加入：不论模型还是资源，整批放在最上面，批内保持给出的先后（用户 2026-11-17，ADR 0167）；已经在的不动。
   * 不能有模型时给了模型的键抛错（ADR 0169）
   */
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

type ResourceOwner = Pick<ResourceLayers, 'perDimension' | 'currentSet' | 'forSet'>;
type ModelOwner = Pick<SceneModels, 'models' | 'restored' | 'added' | 'hidden' | 'add' | 'remove' | 'moveModel'>;

/**
 * 记下的图层顺序（ADR 0167）：资源和模型的键，从上到下，不重复。记的总是有模型的那一套怎样穿插：二三维共用时是共用的，
 * 各一套时是三维的（ADR 0169），二维的列表只有资源、先后在资源的拥有者里
 */
export const storedCurrentLayersSchema = z
  .object({ order: z.array(z.string().regex(/^(resource|model):.+$/)) })
  .refine(({ order }) => new Set(order).size === order.length, { message: '图层的顺序里有重复的行' });

/**
 * 图层的平铺列表（ADR 0161、0167）：资源之间的先后在资源的拥有者里，模型之间的先后在模型的拥有者里，两者怎样穿插记在这里；
 * 三者都按账号记住。顺序在加入、移出、移动时记下，恢复和目录到达引起的变化不算用户的操作；都到齐以后丢掉没有了的行
 * 也写回去。二维、三维各一套时（ADR 0169）二维里换成只有资源的列表，穿插只对着三维的那一套，不管当前是哪一维
 */
export function useCurrentLayers(
  resources: ResourceOwner,
  models: ModelOwner,
  { preferences = null }: CurrentLayersOptions = {}
): CurrentLayers {
  // 有模型的那一套：不分开时是共用的，分开时是三维的。穿插的合并、清理都只读它，在二维里也不会删掉三维才有的资源
  const scene = resources.forSet(resources.perDimension ? '3d' : 'shared');
  // 分开时二维的那一套：列表只有资源
  const flat = resources.perDimension ? resources.forSet('2d') : null;
  const flatShown = computed(() => flat !== null && resources.currentSet.value === '2d');

  const layerKeys = computed(() => currentLayers(scene.state.value).map(layer => resourceKey(layer.code)));
  // 模型清单里还有的（清单刷新后没有了的不显示）
  const modelKeys = computed(() => {
    const known = new Set(models.models.value.map(model => model.id));
    return models.added.value.flatMap(id => (known.has(id) ? [modelKey(id)] : []));
  });
  const present = computed(() => new Set([...layerKeys.value, ...modelKeys.value]));
  // 资源目录和模型清单都到了、记下的也都恢复了：这之后顺序里还没出现的就是没有了，不再留位置
  const ready = computed(() => scene.state.value.catalog !== null && models.restored.value);
  // 记下的顺序：只用它的穿插，内容按拥有者合并（mergedOrder）；还没到的项留着位置
  const settled = shallowRef<readonly string[]>([]);
  const sceneKeys = computed(() => mergedOrder(settled.value, layerKeys.value, modelKeys.value));
  // 现在的顺序加上还没到的项：操作都在它上面做，免得目录、清单没到时一操作就把它们的位置丢了
  const fullOrder = () => (ready.value ? sceneKeys.value : withPending(sceneKeys.value, settled.value, present.value));
  const flatKeys = computed(() => (flat ? currentLayers(flat.state.value).map(layer => resourceKey(layer.code)) : []));
  const keys = computed(() => (flatShown.value ? flatKeys.value : sceneKeys.value));

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

  const addToScene = (added: readonly string[]) => {
    // 已经在的按拥有者里真有的行判断：记下的顺序里还没到的（目录、清单没到，或那一项的记录没了）照样能加入
    const fresh = [...new Set(added)].filter(
      key => !present.value.has(key) && (resourceCodeOfKey(key) !== null || modelIdOfKey(key) !== null)
    );
    if (fresh.length === 0) {
      return;
    }
    const ids = fresh.flatMap(key => modelIdOfKey(key) ?? []);
    const codes = fresh.flatMap(key => resourceCodeOfKey(key) ?? []);
    const before = fullOrder().filter(key => !fresh.includes(key));
    if (ids.length > 0) {
      models.add(ids);
    }
    if (codes.length > 0) {
      scene.add(codes, 0);
    }
    // 后加入的压在最上面：拥有者里也都放在最前，和列表的先后一致
    settled.value = [...fresh.filter(key => present.value.has(key)), ...before];
  };

  const removeFromScene = (removed: readonly string[]) => {
    const gone = new Set(removed);
    const before = fullOrder();
    scene.remove(removed.flatMap(key => resourceCodeOfKey(key) ?? []));
    models.remove(removed.flatMap(key => modelIdOfKey(key) ?? []));
    settled.value = before.filter(key => !gone.has(key));
  };

  // 资源、模型各自的先后交给拥有者：一行挪动只改变它在同类里的位置
  const moveInScene = (key: string, to: number, visible: readonly string[]) => {
    const next = movedOrder(sceneKeys.value, visible, key, to);
    if (!next) {
      return;
    }
    settled.value = ready.value ? next : withPending(next, settled.value, present.value);
    const code = resourceCodeOfKey(key);
    const id = modelIdOfKey(key);
    if (code !== null) {
      scene.moveLayer(code, next.filter(item => resourceCodeOfKey(item) !== null).indexOf(key));
    } else if (id !== null) {
      models.moveModel(id, next.filter(item => modelIdOfKey(item) !== null).indexOf(key));
    }
  };

  return {
    keys,
    holdsModels: computed(() => !flatShown.value),
    overModels: computed(() => layersAboveModels(keys.value).flatMap(key => resourceCodeOfKey(key) ?? [])),
    shownModel: computed(
      () =>
        !flatShown.value &&
        modelKeys.value.some(key => {
          const id = modelIdOfKey(key);
          return id !== null && !models.hidden.value.has(id);
        })
    ),
    add: added => {
      if (!flat || !flatShown.value) {
        addToScene(added);
        return;
      }
      if (added.some(key => modelIdOfKey(key) !== null)) {
        throw new Error('二维的图层里只有资源，三维模型在三维里加入（ADR 0169）');
      }
      // 后加入的压在最上面，同共用一套时
      flat.add(added.flatMap(key => resourceCodeOfKey(key) ?? []), 0);
    },
    remove: removed => {
      if (!flat || !flatShown.value) {
        removeFromScene(removed);
        return;
      }
      flat.remove(removed.flatMap(key => resourceCodeOfKey(key) ?? []));
    },
    move: (key, to, visible = keys.value) => {
      if (!flat || !flatShown.value) {
        moveInScene(key, to, visible);
        return;
      }
      const next = movedOrder(flatKeys.value, visible, key, to);
      const code = resourceCodeOfKey(key);
      if (next && code !== null) {
        flat.moveLayer(code, next.indexOf(key));
      }
    }
  };
}
