import type { CatalogNode } from '@/shared/map/layer-panel/catalog-tree';
import type { RequestSource } from '@/shared/map/request-status/request-status';
import { groupByCity, MODEL_KIND_LABELS, type SceneModel } from './catalog';
import type { SceneModels } from './composables/useSceneModels';

// 三维模型在资源图层面板上的数据（ADR 0157）：二维里是目录最后一个分类"三维模型"，下面按市分组；三维里是目录的"三维模型"页，
// 直接按市分组（用户 2026-11-15 选的方案乙）；当前图层里的模型组

const MODEL_PREFIX = 'model:';
const ROOT_KEY = 'model-root';
const CITY_PREFIX = 'model-city:';
const ROOT_LABEL = '三维模型';

/** 模型在面板上的键：目录的项、当前图层的行都用它 */
export function modelKey(id: string): string {
  return `${MODEL_PREFIX}${id}`;
}

/** 键对应的模型；不是模型的键时为 null */
export function modelIdOfKey(key: string): string | null {
  return key.startsWith(MODEL_PREFIX) ? key.slice(MODEL_PREFIX.length) : null;
}

/** 能漫游：清单里有出生点或路线（ADR 0097 第 1 节、0156） */
export function canRoamModel(model: Pick<SceneModel, 'spawn' | 'routes'>): boolean {
  return model.spawn !== undefined || model.routes.length > 0;
}

/**
 * 按市分组的模型（市按区划代码排），模型名后面是类型；关键字匹配模型名或市名，kind 不为 null 时只留这一类。
 * 三维里目录的"三维模型"页直接列这些市（用户 2026-11-15 选的方案乙）
 */
export function modelCityNodes(
  models: readonly SceneModel[],
  added: readonly string[],
  keyword = '',
  kind: string | null = null
): CatalogNode[] {
  const addedSet = new Set(added);
  const shown = kind === null ? models : models.filter(model => model.kind === kind);
  return groupByCity(shown, keyword).map(city => ({
    kind: 'branch',
    key: `${CITY_PREFIX}${city.cityCode}`,
    label: city.cityName,
    children: city.models.map(model => ({
      kind: 'leaf',
      key: modelKey(model.id),
      label: model.name,
      icon: 'model-3d',
      note: MODEL_KIND_LABELS[model.kind],
      added: addedSet.has(model.id)
    }))
  }));
}

/**
 * 二维里资源目录最后的"三维模型"分类，下面是 modelCityNodes。
 * 关键字匹配模型名、市名，或者"三维模型"本身（这时列出全部）；没有模型时没有这个分类
 */
export function modelCatalogNodes(
  models: readonly SceneModel[],
  added: readonly string[],
  keyword = ''
): CatalogNode[] {
  const needle = keyword.trim();
  const cities = modelCityNodes(models, added, needle !== '' && ROOT_LABEL.includes(needle) ? '' : needle);
  return cities.length === 0 ? [] : [{ kind: 'branch', key: ROOT_KEY, label: ROOT_LABEL, children: cities }];
}

/** 类型筛选的选项：清单里有的类型，按 MODEL_KIND_LABELS 的先后 */
export function modelKindOptions(models: readonly SceneModel[]): { readonly kind: string; readonly label: string }[] {
  return Object.entries(MODEL_KIND_LABELS).flatMap(([kind, label]) =>
    models.some(model => model.kind === kind) ? [{ kind, label }] : []
  );
}

/**
 * 请求状态里的模型（ADR 0158）：三维里加入、显示着的，按当前图层的先后；只有加载中、就绪、失败，"细节还剩几块"往后放。
 * 键同当前图层的行
 */
export function modelRequests(models: Pick<SceneModels, 'models' | 'added' | 'hidden' | 'stateOf'>): RequestSource[] {
  return models.added.value.flatMap(id => {
    const model = models.models.value.find(item => item.id === id);
    if (!model || models.hidden.value.has(id)) {
      return [];
    }
    return [{ kind: 'model', key: modelKey(id), name: model.name, icon: 'model-3d', state: models.stateOf(id) }];
  });
}
