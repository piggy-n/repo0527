import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { QueryPanel } from '@/features/data-query/components/QueryPanel';
import { notifySubmit } from '@/features/data-query/components/query-messages';
import { QueryResultPanel, type ResultView } from '@/features/data-query/components/QueryResultPanel';
import { useDataQuery } from '@/features/data-query/composables/useDataQuery';
import { PREVIEW_GROUP, RESULT_GROUP } from '@/features/data-query/result-layers';
import { QUERY_TOPICS, type QueryTopic, type TopicId } from '@/features/data-query/topics';
import { BasemapCard } from '@/shared/map/basemap/BasemapCard';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { BoxSelectOverlay } from '@/shared/map/box-select/BoxSelectOverlay';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import styles from './DataQueryPage.module.scss';

// 一个专题的查询页：左边查询面板，中间底部查询结果，右边地图控制和底图卡（同指标页的网格，ADR 0053）
const DataQueryView = defineComponent({
  name: 'DataQueryView',
  props: {
    topic: { type: Object as PropType<QueryTopic>, required: true }
  },
  setup(props) {
    // 预览压在注记下面，结果和画的范围在边界上面（同旧页面）
    const map = provideMap({
      groups: ['basemap', PREVIEW_GROUP, 'basemap-labels', 'boundaries', RESULT_GROUP, 'draw'],
      camera: JIANGSU_CAMERA
    });
    const { goToDefaultView } = useDefaultView(map);
    // 底图和行政区不记偏好，不影响现状底图记住的选择；行政区默认只显示省界（同旧页面）
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    const query = useDataQuery({ topic: props.topic, map, onDrawSubmit: notifySubmit });

    map.registerTools(query.spatial.draw.tools);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      [PREVIEW_GROUP]: query.derivePreview,
      'basemap-labels': basemap.deriveLabelsGroup,
      boundaries: boundaries.deriveGroup,
      [RESULT_GROUP]: query.result.deriveGroup,
      draw: query.spatial.draw.deriveGroup
    });

    const collapsed = ref(false);
    const basemapOpen = ref(false);
    const resultView = ref<ResultView>('expanded');
    // 窄屏时查询面板和其余的（结果、底图）只显示最后操作的一边
    const sides = useSideExclusion({
      leftExpanded: () => !collapsed.value,
      rightOpen: () => basemapOpen.value || query.result.request.value !== null
    });

    // 每次查询都展开结果（同旧页面），窄屏时显示结果
    watch(
      () => query.result.request.value,
      request => {
        if (request !== null) {
          resultView.value = 'expanded';
          sides.activate('right');
        }
      }
    );

    const changeCollapsed = (value: boolean) => {
      collapsed.value = value;
      if (value) {
        query.spatial.draw.stop();
      } else {
        sides.activate('left');
      }
    };
    const changeBasemapOpen = (open: boolean) => {
      basemapOpen.value = open;
      if (open) {
        sides.activate('right');
      }
    };

    const renderBasemapCard = () => (
      <div key="cards" class={styles.cards}>
        <BasemapCard
          basemap={basemap}
          open={basemapOpen.value}
          visible={sides.right.value}
          onUpdate:open={changeBasemapOpen}
        />
      </div>
    );

    return () => (
      <div class={styles.root} data-data-query-page={props.topic.id}>
        <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
        <BoxSelectOverlay pick={query.spatial.draw} />
        <div class={styles.overlay}>
          <div key="left" class={styles.left}>
            <QueryPanel query={query} collapsed={!sides.left.value} onUpdate:collapsed={changeCollapsed} />
          </div>
          {query.result.request.value !== null && (
            <div key="results" class={styles.results} v-show={sides.right.value}>
              <QueryResultPanel
                result={query.result}
                exporter={query.exporter}
                view={resultView.value}
                onUpdate:view={(view: ResultView) => (resultView.value = view)}
              />
            </div>
          )}
          <div key="controls" class={styles.controls}>
            <MapViewControls goToDefaultView={goToDefaultView} zoomRange={JIANGSU_ZOOM_RANGE} />
          </div>
          {renderBasemapCard()}
        </div>
        <MapStatusNotice />
      </div>
    );
  }
});

/**
 * 数据查询（查询统计菜单下的四个页面共用，专题由路由的 props 给出）。专题变了按专题加 key 整页重建，条件、结果、
 * 地图都不带过去（同旧页面的 resetQueryModuleState）；四个路由各自经 withMapRuntime 包一层，切路由本来就重建，实测页换专题靠这个 key
 */
export const DataQueryPage = defineComponent({
  name: 'DataQueryPage',
  props: {
    topic: { type: String as PropType<TopicId>, required: true }
  },
  setup(props) {
    return () => <DataQueryView key={props.topic} topic={QUERY_TOPICS[props.topic]} />;
  }
});
