// shpjs 6 不带类型声明，这里只写用到的函数（docs/modules/shared-map.md 的"自定义范围"）
declare module 'shpjs' {
  import type { Geometry } from 'geojson';

  /** 解析 .shp 的要素；prj 是 .prj 的 WKT，认得出时把坐标转换为 WGS84 经纬度，认不出时原样返回。空要素为 null */
  export function parseShp(shp: ArrayBuffer | ArrayBufferView, prj?: string): (Geometry | null)[];
}
