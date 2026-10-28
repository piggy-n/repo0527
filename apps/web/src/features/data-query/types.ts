import type { Polygon } from 'geojson';

export type QueryModule = 'land' | 'city' | 'forest' | 'water';
export type QueryMode = 'attribute' | 'spatial' | 'natural' | 'advanced';
export type SpatialMethod = 'rectangle' | 'polygon' | 'shp';
export type FieldValue = string | number | string[];
export type ExportFormat = 'excel' | 'shp' | 'gdb';

/** 配置描述业务字段；表单值由查询拥有者单独维护 */
export interface QueryField {
  code: string;
  label: string;
  type: 'input' | 'singleSelect' | 'multipleSelect' | 'datetime';
  options?: readonly { code: string; name: string }[];
  operators?: readonly string[];
  numeric?: boolean;
  initial?: FieldValue;
  shown?: boolean;
}

export interface QueryLayer {
  code: string;
  label: string;
  sourceLayer: string;
  geometry: 'point' | 'polygon';
  fields: readonly QueryField[];
}

/** 文件对象保留在快照中，分页和重试不读取后来选中的文件 */
export type QueryScope =
  | { kind: 'region'; code: string }
  | { kind: 'geometry'; geometry: Polygon }
  | { kind: 'shp'; file: File };

/** 一次查询的不可变参数；id 只用作缓存身份，不用于比较请求先后 */
export interface QuerySnapshot {
  id: string;
  layer: QueryLayer;
  mode: QueryMode;
  conditions: string;
  scope: QueryScope;
  signature: string;
}

export interface QueryCondition {
  code: string;
  value: FieldValue;
  operator: string;
}
