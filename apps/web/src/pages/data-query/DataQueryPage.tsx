import { provideMap } from '@yzt/map-vue';
import { computed, defineComponent, type PropType, toRef } from 'vue';
import { useDataQuery } from '@/features/data-query/composables/useDataQuery';
import { useQueryDetail } from '@/features/data-query/composables/useQueryDetail';
import { useQueryDrawing } from '@/features/data-query/composables/useQueryDrawing';
import { geometryGroup, queryLayerGroup } from '@/features/data-query/map-style';
import type { QueryModule } from '@/features/data-query/types';
import { appConfig } from '@/shared/config/app-config';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { useLocationPoint } from '@/shared/map/location/useLocationPoint';
import { useMeasure } from '@/shared/map/measure/useMeasure';
import { useRegionLocate } from '@/shared/map/region/useRegionLocate';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { QueryWorkspace } from './QueryWorkspace';

/** 四个数据查询入口共用地图装配，未配置的模块只显示已确认的地图壳 */
export const DataQueryPage = defineComponent({
  name: 'DataQueryPage',
  props: { module: { type: String as PropType<QueryModule>, required: true } },
  setup(props) {
    const map = provideMap({
      groups: ['basemap', 'query-layer', 'query-results', 'query-selection', 'basemap-labels',
        'boundaries', 'region', 'query-draw', 'measure'],
      camera: JIANGSU_CAMERA
    });
    const { goToDefaultView } = useDefaultView(map);
    // 查询页不改写现状底图的持久化偏好
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    const region = useRegionLocate(map, { goToDefaultView });
    const location = useLocationPoint(map);
    const measure = useMeasure();
    const drawing = useQueryDrawing(map);
    const model = useDataQuery(toRef(props, 'module'), drawing);
    const detail = useQueryDetail(map, model);
    const apiBase = new URL(appConfig.apiBaseUrl, window.location.origin).href.replace(/\/$/, '');
    const selectedShapes = computed(() => detail.geometry.value ? [detail.geometry.value] : []);
    map.registerTools(drawing.tools);
    map.registerTools(location.tools);
    map.registerTools(measure.tools);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      boundaries: boundaries.deriveGroup,
      region: region.deriveGroup,
      measure: measure.deriveGroup,
      'query-draw': drawing.deriveGroup,
      'query-layer': () => queryLayerGroup(model.layer.value, model.submitted.value, apiBase),
      'query-results': () => geometryGroup('query-results', model.shapes.value?.map(row => row.geom) ?? [], '#577CFF'),
      'query-selection': () => geometryGroup('query-selection', selectedShapes.value, '#FF9C40')
    });
    const mapTools = { basemap, boundaries, region, location, measure, goToDefaultView };
    return () => (
      <QueryWorkspace module={props.module} model={model} drawing={drawing} detail={detail} tools={mapTools} />
    );
  }
});
