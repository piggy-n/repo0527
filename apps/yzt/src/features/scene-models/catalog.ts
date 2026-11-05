import { RoutePath } from '@yzt/map-core';
import { findRegion } from '@/shared/map/region/region-catalog';
import type { ManifestModel, SceneManifest } from './api';

export type ModelKind = ManifestModel['kind'];

export const MODEL_KIND_LABELS: Readonly<Record<ModelKind, string>> = {
  oblique: '倾斜摄影',
  white: '白膜',
  indoor: '室内'
};

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
  /** 白膜的各种效果；其他模型只有一种，id 为空串 */
  readonly effects: readonly ModelEffect[];
  /** 默认的效果：白膜的第一种 */
  readonly defaultEffect: string;
  readonly spawn: ManifestModel['spawn'];
  readonly routes: readonly ModelRoute[];
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

/** 清单换成目录：地址按清单的地址解析成绝对地址（ADR 0081 第 1 节） */
export function buildModelCatalog(manifest: SceneManifest, manifestUrl: string): readonly SceneModel[] {
  const resolve = (path: string) => new URL(path, manifestUrl).href;
  return manifest.models.map(model => ({
    id: model.id,
    name: model.name,
    cityCode: model.cityCode,
    cityName: cityNameOf(model.cityCode),
    kind: model.kind,
    underground: model.underground,
    effects:
      model.kind === 'white'
        ? model.effects.map(({ id, label, tileset }) => ({ id, label, url: resolve(tileset) }))
        : [{ id: '', label: '', url: resolve(model.tileset) }],
    defaultEffect: model.kind === 'white' ? model.effects[0].id : '',
    spawn: model.spawn,
    routes: (model.routes ?? []).map(({ id, name, path }) => ({ id, name, path, length: new RoutePath(path).total }))
  }));
}

/** 按市分组，市和组内都按清单里第一次出现的先后；关键字匹配模型名或市名 */
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
  return [...cities.values()];
}
