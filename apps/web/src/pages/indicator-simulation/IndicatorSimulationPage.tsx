import { MapCanvas, provideMap } from '@yzt/map-vue';
import { computed, defineComponent, ref, Transition, watch } from 'vue';
import { AiDock } from '@/features/indicator-simulation/components/AiDock';
import { ComposeStage } from '@/features/indicator-simulation/components/ComposeStage';
import { ResultStage } from '@/features/indicator-simulation/components/ResultStage';
import { RunStage } from '@/features/indicator-simulation/components/RunStage';
import { useComposition } from '@/features/indicator-simulation/composables/useComposition';
import { usePauseWhileInactive } from '@/features/indicator-simulation/composables/usePauseWhileInactive';
import { usePromptComposer } from '@/features/indicator-simulation/composables/usePromptComposer';
import { useReasoningLog } from '@/features/indicator-simulation/composables/useReasoningLog';
import { useRunConversation } from '@/features/indicator-simulation/composables/useRunConversation';
import { useRunFlow } from '@/features/indicator-simulation/composables/useRunFlow';
import { useSimulationMap } from '@/features/indicator-simulation/composables/useSimulationMap';
import { useSimulationModel } from '@/features/indicator-simulation/composables/useSimulationModel';
import { useSimulationResult } from '@/features/indicator-simulation/composables/useSimulationResult';
import { useSimulationRun } from '@/features/indicator-simulation/composables/useSimulationRun';
import { useUserPause } from '@/features/indicator-simulation/composables/useUserPause';
import { reducedMotion, STILL_CLASS } from '@/features/indicator-simulation/motion';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { usePageActive } from '@/shared/composables/usePageActive';
import { JIANGSU_CAMERA, JIANGSU_ZOOM_RANGE } from '@/shared/map/jiangsu';
import { MapStatusNotice } from '@/shared/map/MapStatusNotice';
import { SCROLL_ZOOM_RATES } from '@/shared/map/view-controls/zoom';
import styles from './IndicatorSimulationPage.module.scss';

/**
 * 指标智能推演（ADR 0105、0106）：条件编排 → AI 推演 → 结果展示，全部是确定性的模拟数据，不请求后端。
 * 打开时编排是空的，由底部对话栏的推演指令或手动点选编排；AI 按指令逐个节点编排完成后自动开始推演。
 * AI 推演阶段左侧是 AI 推理，右侧是推演流程图；完成后点"查看结果"进入结果展示，地图只在结果展示时显示，不读写偏好。
 * 阶段之间淡入淡出；切到别的页面时缓存，推演暂停（docs/modules/indicator-simulation.md）
 */
export const IndicatorSimulationPage = defineComponent({
  name: 'IndicatorSimulationPage',
  setup() {
    const composition = useComposition();
    const { model, retry } = useSimulationModel();
    const run = useSimulationRun();
    const result = useSimulationResult(run);
    const flow = useRunFlow(run);
    const log = useReasoningLog(run);
    const userPause = useUserPause(run);
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

    // 推演完成后看结果；重新推演时回到流程图
    const showingResult = ref(false);
    watch(
      () => run.state.value.status,
      status => {
        if (status !== 'done') {
          showingResult.value = false;
        }
      }
    );
    const view = computed(() => {
      const { status } = run.state.value;
      if (status === 'idle') {
        return 'compose';
      }
      return status === 'done' && showingResult.value ? 'result' : 'run';
    });

    // 开始推演：按指令编排完成的，时间线先写上这句指令
    const startWith = (instruction: string | null) => {
      const current = model.value;
      if (current.status === 'ready') {
        log.begin(instruction);
        run.start(composition.state.value, current.calculator);
      }
    };
    // 指令的文字在推演后回到编排时还在；AI 编排完成后直接开始推演（区县数据还没好时停在编排图，由用户点开始）
    const composer = usePromptComposer(composition, { still: reducedMotion, onComposed: () => startWith(composer.text.value) });
    // 推演和结果阶段的对话：暂停、继续、停止，改参数或条件
    const conversation = useRunConversation(run, composition, userPause, log);

    const renderStage = () => {
      switch (view.value) {
        case 'compose':
          return (
            <ComposeStage
              key="compose"
              composition={composition}
              composer={composer}
              model={model.value}
              onStart={() => startWith(null)}
              onRetry={retry}
            />
          );
        case 'run':
          return (
            <RunStage
              key="run"
              run={run}
              model={model.value}
              flow={flow}
              log={log}
              userPause={userPause}
              onShowResult={() => (showingResult.value = true)}
            />
          );
        case 'result':
          break;
      }
      return (
        <ResultStage
          key="result"
          run={run}
          model={model.value}
          simulationMap={simulationMap}
          result={result}
          onShowFlow={() => (showingResult.value = false)}
        />
      );
    };

    return () => (
      <div class={[styles.root, reducedMotion() && STILL_CLASS]}>
        <div class={styles.stages}>
          {/* 地图只在结果展示时显示；隐藏时保留尺寸，回到结果时不用重新排版 */}
          <div class={[styles.map, view.value !== 'result' && styles.hidden]}>
            <MapCanvas mapOptions={JIANGSU_ZOOM_RANGE} scrollZoomRates={SCROLL_ZOOM_RATES} />
            <MapStatusNotice />
          </div>
          <Transition
            enterFromClass={styles.stageEnterFrom}
            enterActiveClass={styles.stageEnterActive}
            leaveActiveClass={styles.stageLeaveActive}
            leaveToClass={styles.stageLeaveTo}
          >
            {renderStage()}
          </Transition>
        </div>
        <AiDock composer={composer} conversation={view.value === 'compose' ? null : conversation} />
      </div>
    );
  }
});
