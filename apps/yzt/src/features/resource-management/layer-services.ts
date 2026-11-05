/** 资源的两类附属记录：地图服务、数据接口。后端暂无接口，和旧页面一样只存在前端内存里 */
export type LayerServiceKind = 'map' | 'interface';
export type MapServiceType = 'WMS' | 'WMTS' | 'MVT' | 'XYZ';
export type DataInterfaceType = 'JSON' | 'RESTful';
export type LayerServiceStatus = 'enabled' | 'disabled';

export interface LayerServiceDraft {
  name: string;
  type: MapServiceType | DataInterfaceType;
  url: string;
  status: LayerServiceStatus;
}

export interface LayerServiceRecord extends LayerServiceDraft {
  id: string;
}

export const LAYER_SERVICE_LABELS: Record<LayerServiceKind, string> = {
  map: '地图服务',
  interface: '数据接口'
};

export const LAYER_SERVICE_TYPES: Record<LayerServiceKind, readonly LayerServiceDraft['type'][]> = {
  map: ['WMS', 'WMTS', 'MVT', 'XYZ'],
  interface: ['JSON', 'RESTful']
};

// 旧页面按类型写死的坐标系和格式，只用于展示，不代表探测过服务（WMTS 的格式文案沿用旧值）
const MAP_SERVICE_META: Record<MapServiceType, { crs: string; format: string }> = {
  WMS: { crs: 'EPSG:4490', format: 'PNG' },
  WMTS: { crs: 'EPSG:4490', format: 'WebMercator' },
  MVT: { crs: 'EPSG:3857', format: 'PBF' },
  XYZ: { crs: 'EPSG:3857', format: 'PNG' }
};

/** 地图服务按类型得到坐标系和格式；数据接口没有这两项 */
export function mapServiceMeta(type: LayerServiceDraft['type']): { crs: string; format: string } | null {
  return type === 'JSON' || type === 'RESTful' ? null : MAP_SERVICE_META[type];
}

/** 新增时的空白表单，类型默认取该类的第一项 */
export function emptyLayerServiceDraft(kind: LayerServiceKind): LayerServiceDraft {
  return { name: '', type: LAYER_SERVICE_TYPES[kind][0], url: '', status: 'enabled' };
}
