import type {
  FilterSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  SourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleCommand } from '../style/diff-style';

/** 应用样式命令用到的地图方法；MapLibre 的 Map 满足这个接口（见测试中的类型检查） */
export interface StyleTarget {
  addSource(id: string, source: SourceSpecification): void;
  removeSource(id: string): void;
  getSource(id: string): unknown;
  addLayer(layer: LayerSpecification, beforeId?: string): void;
  removeLayer(id: string): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setFilter(layerId: string, filter?: FilterSpecification | null): void;
  setLayerZoomRange(layerId: string, minzoom: number, maxzoom: number): void;
}

interface GeoJsonSourceLike {
  readonly type: 'geojson';
  setData(data: GeoJSONSourceSpecification['data']): Promise<void>;
}

function isGeoJsonSource(source: unknown): source is GeoJsonSourceLike {
  return (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    source.type === 'geojson' &&
    'setData' in source &&
    typeof source.setData === 'function'
  );
}

/**
 * 把一条样式命令应用到地图；返回 false 表示不支持，由调用方用当前快照整体重建
 * GeoJSON 数据在 Worker 里异步处理，失败交给 onAsyncError
 */
export function applyStyleCommand(
  map: StyleTarget,
  command: StyleCommand,
  onAsyncError: (error: unknown) => void
): boolean {
  switch (command.command) {
    case 'addSource':
      map.addSource(...command.args);
      return true;
    case 'removeSource':
      map.removeSource(...command.args);
      return true;
    case 'setGeoJSONSourceData': {
      const [id, data] = command.args;
      const source = map.getSource(id);
      if (!isGeoJsonSource(source)) {
        throw new Error(`数据源 "${id}" 不存在或不是 GeoJSON 数据源`);
      }
      source.setData(data).catch(onAsyncError);
      return true;
    }
    case 'addLayer':
      map.addLayer(...command.args);
      return true;
    case 'removeLayer':
      map.removeLayer(...command.args);
      return true;
    case 'setPaintProperty':
      map.setPaintProperty(...command.args);
      return true;
    case 'setLayoutProperty':
      map.setLayoutProperty(...command.args);
      return true;
    case 'setFilter':
      map.setFilter(...command.args);
      return true;
    case 'setLayerZoomRange':
      // 参数里的 undefined 表示"保持不设"；去掉已有缩放范围的情况，diffStyle 已改写成删除再添加
      map.setLayerZoomRange(...command.args);
      return true;
    // diff 失败的退路、没有公开方法的命令、样式根属性：都很少出现，整体重建
    case 'setStyle':
    case 'setLayerProperty':
    case 'setTransition':
    case 'setSprite':
    case 'setGlyphs':
    case 'setFontFaces':
    case 'setLight':
    case 'setTerrain':
    case 'setSky':
    case 'setProjection':
    case 'setGlobalState':
    // 相机归 CameraModel，样式根属性里不会有，出现了说明状态不对
    case 'setCenter':
    case 'setCenterAltitude':
    case 'setZoom':
    case 'setBearing':
    case 'setPitch':
    case 'setRoll':
      break;
  }
  return false;
}
