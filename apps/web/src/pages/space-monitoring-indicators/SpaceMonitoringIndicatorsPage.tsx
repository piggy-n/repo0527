import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent, type PropType, ref, watch } from 'vue';
import { type IndicatorApi, indicatorApi } from '@/features/monitoring-indicators/api';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { CalculationProgressPanel } from '@/features/monitoring-indicators/components/CalculationProgressPanel';
import { IndicatorPanel, type IndicatorTab } from '@/features/monitoring-indicators/components/IndicatorPanel';
import { IndicatorResultPanel } from '@/features/monitoring-indicators/components/IndicatorResultPanel';
import { useIndicatorCalculation } from '@/features/monitoring-indicators/composables/useIndicatorCalculation';
import { useIndicatorConditions } from '@/features/monitoring-indicators/composables/useIndicatorConditions';
import { useIndicatorResult } from '@/features/monitoring-indicators/composables/useIndicatorResult';
import { useIndicatorTree } from '@/features/monitoring-indicators/composables/useIndicatorTree';
import { RESULT_GROUP } from '@/features/monitoring-indicators/result-layers';
import { BasemapCard } from '@/shared/map/basemap/BasemapCard';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { MapViewControls } from '@/shared/map/view-controls/MapViewControls';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import styles from './SpaceMonitoringIndicatorsPage.module.scss';

/**
 * 城市国土空间监测指标：左边选条件和指标，计算页签在地图底部看进度，展示页签在右上看一个指标的成果。
 * 不进页面缓存：离开时停止查进度，回来时计算树上的状态标签就是各指标的进度
 */
export const SpaceMonitoringIndicatorsPage = defineComponent({
  name: 'SpaceMonitoringIndicatorsPage',
  props: {
    /** 默认是真实接口；组件样例传入固定数据的实现 */
    api: { type: Object as PropType<IndicatorApi>, default: () => indicatorApi },
    /** 默认按登录会话核对写操作；组件样例不登录，传入总是有效的核对 */
    sessionGuard: { type: Object as PropType<SessionGuard>, default: undefined }
  },
  setup(props) {
    // 注记、边界压在成果上面：成果里的区划范围是不透明的面，地名和边界不被盖住（同现状底图的叠放，ADR 0033）
    const map = provideMap({
      groups: ['basemap', RESULT_GROUP, 'basemap-labels', 'boundaries'],
      camera: JIANGSU_CAMERA
    });
    const { goToDefaultView } = useDefaultView(map);
    // 底图和行政区不记偏好，不影响现状底图记住的选择；行政区默认省、市、县界都显示（同旧页面）
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    boundaries.setVisible('city', true);
    boundaries.setVisible('county', true);

    const { api } = props;
    const tab = ref<IndicatorTab>('calculation');
    const conditions = useIndicatorConditions();
    const calculationTree = useIndicatorTree({ api, source: 'calculation', mode: 'multiple', conditions });
    const resultTree = useIndicatorTree({ api, source: 'result', mode: 'single', conditions });
    const calculation = useIndicatorCalculation({ api, sessionGuard: props.sessionGuard });
    const result = useIndicatorResult({
      api,
      indicator: () => resultTree.picked.value[0] ?? null,
      region: () => conditions.region.value,
      map
    });

    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      [RESULT_GROUP]: result.deriveGroup,
      boundaries: boundaries.deriveGroup
    });

    const collapsed = ref(false);
    const basemapOpen = ref(false);
    // 窄屏时指标面板和其余的面板（底图、成果、进度）只显示最后操作的一边
    const sides = useSideExclusion({
      leftExpanded: () => !collapsed.value,
      rightOpen: () =>
        basemapOpen.value ||
        (tab.value === 'result' && result.state.value.kind !== 'none') ||
        (tab.value === 'calculation' && calculation.task.value !== null)
    });

    // 切换页签时展示回到没有选择的状态，再进展示页签要重新选（同旧页面）
    const changeTab = (value: IndicatorTab) => {
      if (value !== tab.value) {
        resultTree.clear();
        tab.value = value;
      }
    };
    // 展开左侧面板算操作左边：窄屏时右边让出来
    const changeCollapsed = (value: boolean) => {
      collapsed.value = value;
      if (!value) {
        sides.activate('left');
      }
    };
    const changeBasemapOpen = (open: boolean) => {
      basemapOpen.value = open;
      if (open) {
        sides.activate('right');
      }
    };
    // 选了指标看成果、开始一次计算都算操作右边：窄屏时成果、进度显示出来
    watch(
      () => resultTree.picked.value[0]?.code,
      code => {
        if (code !== undefined) {
          sides.activate('right');
        }
      }
    );
    watch(
      () => calculation.task.value?.request,
      request => {
        if (request !== undefined) {
          sides.activate('right');
        }
      }
    );

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
      <div class={styles.root} data-indicators-page>
        <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
        <div class={styles.overlay}>
          <div key="left" class={styles.left}>
            <IndicatorPanel
              tab={tab.value}
              conditions={conditions}
              calculationTree={calculationTree}
              resultTree={resultTree}
              calculation={calculation}
              collapsed={!sides.left.value}
              onUpdate:tab={changeTab}
              onUpdate:collapsed={changeCollapsed}
            />
          </div>
          {tab.value === 'result' && (
            <div key="lane" class={styles.lane}>
              <IndicatorResultPanel result={result} boundaries={boundaries} visible={sides.right.value} />
            </div>
          )}
          {tab.value === 'calculation' && (
            <div key="progress" class={styles.progress} v-show={sides.right.value}>
              <CalculationProgressPanel calculation={calculation} />
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
