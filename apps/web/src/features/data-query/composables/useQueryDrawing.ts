import { type LngLat, PolygonDrawTool, type StyleGroup } from '@yzt/map-core';
import type { MapContext } from '@yzt/map-vue';
import type { FeatureCollection, Polygon } from 'geojson';
import { computed, onScopeDispose, shallowRef } from 'vue';
import { currentPanKey } from '@/shared/map/pan-key';

const RECTANGLE = 'query-rectangle';
const POLYGON = 'query-polygon';

/** 页面登记工具和范围样式，查询表单只调用绘制入口 */
export function useQueryDrawing(map: MapContext) {
  const draft = shallowRef<readonly LngLat[]>([]);
  const geometry = shallowRef<Polygon | null>(null);
  const error = shallowRef('');
  const active = computed(() => map.activeTool.value === RECTANGLE || map.activeTool.value === POLYGON);

  function stop() {
    map.releaseTool(RECTANGLE);
    map.releaseTool(POLYGON);
  }

  const tool = (kind: 'rectangle' | 'polygon') => new PolygonDrawTool({
    kind,
    panModifier: currentPanKey().modifier,
    change: points => (draft.value = points),
    invalid: message => (error.value = message),
    complete: shape => {
      geometry.value = shape;
      error.value = '';
      stop();
    }
  });
  const tools = { [RECTANGLE]: tool('rectangle'), [POLYGON]: tool('polygon') };
  onScopeDispose(stop);

  function clear() {
    stop();
    draft.value = [];
    geometry.value = null;
    error.value = '';
  }

  function start(kind: 'rectangle' | 'polygon') {
    clear();
    map.activateTool(kind === 'rectangle' ? RECTANGLE : POLYGON);
  }

  function deriveGroup(): StyleGroup {
    const points = draft.value.map(([lng, lat]) => [lng, lat]);
    const data: FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (geometry.value) {
      data.features.push({ type: 'Feature', geometry: geometry.value, properties: {} });
    }
    if (points.length > 1) {
      data.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: {} });
    }
    return {
      sources: { 'query-draw-source': { type: 'geojson', data } },
      layers: [
        { id: 'query-draw-fill', source: 'query-draw-source', type: 'fill',
          filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#577CFF', 'fill-opacity': 0.12 } },
        { id: 'query-draw-line', source: 'query-draw-source', type: 'line',
          paint: { 'line-color': '#577CFF', 'line-width': 2, 'line-dasharray': [3, 2] } }
      ]
    };
  }

  return { tools, geometry, error, active, start, stop, clear, deriveGroup };
}

export type QueryDrawing = ReturnType<typeof useQueryDrawing>;
