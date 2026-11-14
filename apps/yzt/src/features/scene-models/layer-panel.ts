import type { CatalogNode } from '@/shared/map/layer-panel/catalog-tree';
import { groupByCity, MODEL_KIND_LABELS, type SceneModel } from './catalog';

// 三维模型在资源图层面板上的数据（ADR 0157）：目录最后一个分类"三维模型"，下面按市分组；当前图层里的模型组

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
 * 资源目录最后的"三维模型"分类：下面按市分组（市按区划代码排），模型名后面是类型。
 * 关键字匹配模型名、市名，或者"三维模型"本身（这时列出全部）；没有模型时没有这个分类
 */
export function modelCatalogNodes(
  models: readonly SceneModel[],
  added: readonly string[],
  keyword = ''
): CatalogNode[] {
  const needle = keyword.trim();
  const cities = groupByCity(models, needle !== '' && ROOT_LABEL.includes(needle) ? '' : needle);
  if (cities.length === 0) {
    return [];
  }
  const addedSet = new Set(added);
  return [
    {
      kind: 'branch',
      key: ROOT_KEY,
      label: ROOT_LABEL,
      children: cities.map(city => ({
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
      }))
    }
  ];
}
