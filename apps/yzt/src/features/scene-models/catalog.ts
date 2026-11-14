import { RoutePath, type SplatSource } from '@mx/map-core';
import { findRegion } from '@/shared/map/region/region-catalog';
import type { ManifestModel, SceneManifest } from './api';

export type ModelKind = ManifestModel['kind'];


export const MODEL_KIND_LABELS: Readonly<Record<ModelKind, string>> = {
  oblique: '倾斜摄影',
  white: '白膜',
  indoor: '室内',
  splat: '高斯泼溅'
};

/** 漫游时界面上对模型里空间的叫法 */
export interface RoamPlace {
  /** 建导航网格时分析的是什么："正在分析{space}" */
  readonly space: string;
  readonly entering: string;
  readonly noSpawn: string;
  /** 完整地图的标题 */
  readonly map: string;
  readonly minimap: string;
}

const STATION_PLACE: RoamPlace = {
  space: '站内空间',
  entering: '正在进入站内…',
  noSpawn: '附近没有找到可以站立的室内位置',
  map: '站内地图',
  minimap: '站内小地图'
};

// 高斯泼溅多是墓、保护厅、露天的入口，不叫"站内"（ADR 0156）
const SCAN_PLACE: RoamPlace = {
  space: '可行走的空间',
  entering: '正在进入…',
  noSpawn: '附近没有找到可以站立的位置',
  map: '平面图',
  minimap: '小地图'
};

/** 漫游时的叫法：瓦片集按站点（ADR 0086、0087 确认的说法），高斯泼溅用不限于室内的说法 */
export function roamPlaceOf(model: Pick<SceneModel, 'kind'>): RoamPlace {
  return model.kind === 'splat' ? SCAN_PLACE : STATION_PLACE;
}

export interface ModelEffect {
  readonly id: string;
  readonly label: string;
  /** tileset.json 的绝对地址 */
  readonly url: string;
}

/** 预置的漫游路线（ADR 0083 第 1 节）：path 是脚下地板的 [经度, 纬度, 椭球高]，length 是三维长度（米） */
export interface ModelRoute {
  readonly id: string;
  readonly name: string;
  readonly path: NonNullable<ManifestModel['routes']>[number]['path'];
  readonly length: number;
}

/** 目录里的一个模型：地址都是绝对地址，带上市名 */
export interface SceneModel {
  readonly id: string;
  readonly name: string;
  readonly cityCode: string;
  readonly cityName: string;
  readonly kind: ModelKind;
  readonly underground: boolean;
  /** 清单给的屏幕误差上限；没给的用默认值 */
  readonly maximumScreenSpaceError?: number;
  /** 白膜的各种效果；倾斜摄影、室内只有一种，id 为空串；高斯泼溅没有瓦片集，为空 */
  readonly effects: readonly ModelEffect[];
  /** 默认的效果：白膜的第一种 */
  readonly defaultEffect: string;
  readonly spawn: ManifestModel['spawn'];
  readonly routes: readonly ModelRoute[];
  /** 高斯泼溅（ADR 0149）的索引地址和摆放；其他模型为 null */
  readonly splat: SplatSource | null;
}

/** 按市分组的目录 */
export interface ModelCity {
  readonly cityCode: string;
  readonly cityName: string;
  readonly models: readonly SceneModel[];
}

// 清单的 schema 已经保证市代码在目录里
function cityNameOf(code: string): string {
  const region = findRegion(code);
  if (!region) {
    throw new Error(`区划目录里没有 ${code}`);
  }
  return region.name;
}

// 路线带上长度（三维，楼梯的高差也算）
const routesOf = ({ routes = [] }: ManifestModel): ModelRoute[] =>
  routes.map(({ id, name, path }) => ({ id, name, path, length: new RoutePath(path).total }));

/** 清单换成目录：地址按清单的地址解析成绝对地址（ADR 0081 第 1 节） */
export function buildModelCatalog(manifest: SceneManifest, manifestUrl: string): readonly SceneModel[] {
  const resolve = (path: string) => new URL(path, manifestUrl).href;
  return manifest.models.map(model => {
    const shared = {
      id: model.id,
      name: model.name,
      cityCode: model.cityCode,
      cityName: cityNameOf(model.cityCode),
      kind: model.kind,
      underground: model.underground
    };
    if (model.kind === 'splat') {
      const splat = { url: resolve(model.lcc2), placement: model.placement };
      return { ...shared, effects: [], defaultEffect: '', spawn: model.spawn, routes: routesOf(model), splat };
    }
    return {
      ...shared,
      ...(model.maximumScreenSpaceError === undefined ? {} : { maximumScreenSpaceError: model.maximumScreenSpaceError }),
      effects:
        model.kind === 'white'
          ? model.effects.map(({ id, label, tileset }) => ({ id, label, url: resolve(tileset) }))
          : [{ id: '', label: '', url: resolve(model.tileset) }],
      defaultEffect: model.kind === 'white' ? model.effects[0].id : '',
      spawn: model.spawn,
      routes: routesOf(model),
      splat: null
    };
  });
}

/** 按市分组，只有市一级、没有模型的市不出现；市按区划代码排，组内按清单的先后；关键字匹配模型名或市名 */
export function groupByCity(models: readonly SceneModel[], keyword: string): readonly ModelCity[] {
  const text = keyword.trim();
  const cities = new Map<string, { cityCode: string; cityName: string; models: SceneModel[] }>();
  for (const model of models) {
    if (text !== '' && !model.name.includes(text) && !model.cityName.includes(text)) {
      continue;
    }
    const city = cities.get(model.cityCode);
    if (city) {
      city.models.push(model);
    } else {
      cities.set(model.cityCode, { cityCode: model.cityCode, cityName: model.cityName, models: [model] });
    }
  }
  return [...cities.values()].toSorted((a, b) => a.cityCode.localeCompare(b.cityCode));
}
