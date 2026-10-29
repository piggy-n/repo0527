import { MapCanvas, provideMap } from '@yzt/map-vue';
import { defineComponent } from 'vue';
import { ComposeStage } from '@/features/indicator-simulation/components/ComposeStage';
import { RunStage } from '@/features/indicator-simulation/components/RunStage';
import { useComposition } from '@/features/indicator-simulation/composables/useComposition';
import { usePauseWhileInactive } from '@/features/indicator-simulation/composables/usePauseWhileInactive';
import { useSimulationMap } from '@/features/indicator-simulation/composables/useSimulationMap';
import { useSimulationModel } from '@/features/indicator-simulation/composables/useSimulationModel';
import { useSimulationResult } from '@/features/indicator-simulation/composables/useSimulationResult';
import { useSimulationRun } from '@/features/indicator-simulation/composables/useSimulationRun';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { usePageActive } from '@/shared/composables/usePageActive';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import styles from './IndicatorSimulationPage.module.scss';

/**
 * 指标智能推演（ADR 0102）：条件编排 → AI 推演 → 结果展示，全部是确定性的模拟数据，不请求后端。
 * 地图一直在下层，条件编排时隐藏；推演阶段的面板浮在地图上。地图不读写偏好，显示省界和市界。
 * 完成后右侧是推演结果，可以换版本、对比、换年度和着色；切到别的页面时缓存，推演暂停（docs/modules/indicator-simulation.md）
 */
export const IndicatorSimulationPage = defineComponent({
  name: 'IndicatorSimulationPage',
  setup() {
    const composition = useComposition();
    const { model, retry } = useSimulationModel();
    const run = useSimulationRun();
    const result = useSimulationResult(run);
    usePauseWhileInactive(run, usePageActive());

    // 区县的填充在底图之上、注记之下；遮罩盖住范围外，边界在上面，描边最上
    const map = provideMap({
      groups: [
        'basemap',
        'simulation-districts',
        'simulation-mask',
        'simulation-facilities',
        'basemap-labels',
        'boundaries',
        'simulation-alerts'
      ],
      camera: JIANGSU_CAMERA
    });
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    boundaries.setVisible('city', true);
    const simulationMap = useSimulationMap(run, map, result);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      boundaries: boundaries.deriveGroup,
      'simulation-districts': simulationMap.deriveDistricts,
      'simulation-mask': simulationMap.deriveMask,
      'simulation-facilities': simulationMap.deriveFacilities,
      'simulation-alerts': simulationMap.deriveAlerts
    });

    const start = () => {
      const current = model.value;
      if (current.status === 'ready') {
        run.start(composition.state.value, current.calculator);
      }
    };

    return () => {
      const composing = run.state.value.status === 'idle';
      return (
        <div class={styles.root}>
          {/* 用户自己拖动、缩放地图后，镜头不再跟随推演 */}
          <div
            class={[styles.map, composing && styles.hidden]}
            onPointerdown={simulationMap.stopFollowing}
            onWheel={simulationMap.stopFollowing}
          >
            <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
            <MapStatusNotice />
          </div>
          {composing ? (
            <ComposeStage key="compose" composition={composition} model={model.value} onStart={start} onRetry={retry} />
          ) : (
            <RunStage key="run" run={run} model={model.value} simulationMap={simulationMap} result={result} />
          )}
        </div>
      );
    };
  }
});
