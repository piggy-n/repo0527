import { provideMap } from '@yzt/map-vue';
import { computed, defineComponent, ref, Transition, watch } from 'vue';
import { AiDock } from '@/features/indicator-simulation/components/AiDock';
import { ComposeStage } from '@/features/indicator-simulation/components/ComposeStage';
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
import type { RunView } from '@/features/indicator-simulation/result/result-view';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { usePageActive } from '@/shared/composables/usePageActive';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import styles from './IndicatorSimulationPage.module.scss';

/**
 * 指标智能推演（ADR 0105～0108）：条件编排 → AI 推演 → 结果展示，全部是确定性的模拟数据，不请求后端。
 * 打开时编排是空的，由底部对话栏的推演指令或手动点选编排；AI 按指令逐个节点编排完成后自动开始推演。
 * AI 推演阶段左侧是 AI 推理，主区是推演流程图；完成后"查看结果"在同一布局里换成左侧推演结果、主区地图，不读写偏好。
 * 编排和推演之间淡入淡出；切到别的页面时缓存，推演暂停（docs/modules/indicator-simulation.md）
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

    // 区县的填充在底图之上、注记之下；遮罩盖住范围外，边界在上面，悬停的市描边最上
    const map = provideMap({
      groups: [
        'basemap',
        'simulation-districts',
        'simulation-mask',
        'simulation-facilities',
        'basemap-labels',
        'boundaries',
        'simulation-highlight'
      ],
      camera: JIANGSU_CAMERA
    });
    const { goToDefaultView } = useDefaultView(map);
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
      'simulation-highlight': simulationMap.deriveHighlight
    });

    // 推演完成后主区看流程还是结果；重新推演时回到流程图
    const runView = ref<RunView>('flow');
    watch(
      () => run.state.value.status,
      status => {
        if (status !== 'done') {
          runView.value = 'flow';
        }
      }
    );
    const composing = computed(() => run.state.value.status === 'idle');

    // 开始推演：按指令编排完成的，时间线先写上这句指令
    const startWith = (instruction: string | null) => {
      const current = model.value;
      if (current.status === 'ready') {
        log.begin(instruction);
        run.start(composition.state.value, current.calculator);
      }
    };
    // 指令的文字在推演后回到编排时还在；AI 编排完成后直接开始推演（区县数据还没好时停在编排图，由用户点开始）
    const composer = usePromptComposer(composition, { onComposed: () => startWith(composer.text.value) });
    // 推演和结果阶段的对话：暂停、继续、停止，改参数或条件；完成后还能看结果
    const conversation = useRunConversation(run, composition, userPause, log, {
      selection: result.selection,
      view: runView,
      select: result.select,
      show: view => {
        runView.value = view;
      }
    });

    const renderStage = () =>
      composing.value ? (
        <ComposeStage
          key="compose"
          composition={composition}
          composer={composer}
          model={model.value}
          onStart={() => startWith(null)}
          onRetry={retry}
        />
      ) : (
        <RunStage
          key="run"
          run={run}
          model={model.value}
          flow={flow}
          log={log}
          userPause={userPause}
          result={result}
          simulationMap={simulationMap}
          basemap={basemap}
          goToDefaultView={goToDefaultView}
          view={runView.value}
          onUpdate:view={view => (runView.value = view)}
        />
      );

    return () => (
      <div class={[styles.root, reducedMotion() && STILL_CLASS]}>
        <div class={styles.stages}>
          <Transition
            enterFromClass={styles.stageEnterFrom}
            enterActiveClass={styles.stageEnterActive}
            leaveActiveClass={styles.stageLeaveActive}
            leaveToClass={styles.stageLeaveTo}
          >
            {renderStage()}
          </Transition>
        </div>
        <AiDock composer={composer} conversation={composing.value ? null : conversation} />
      </div>
    );
  }
});
