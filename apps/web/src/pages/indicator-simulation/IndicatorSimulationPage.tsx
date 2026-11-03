import { provideMap } from '@yzt/map-vue';
import { ElMessage } from 'element-plus';
import { computed, defineComponent, ref, Transition, watch } from 'vue';
import { AiDock } from '@/features/indicator-simulation/components/AiDock';
import { ComposeStage } from '@/features/indicator-simulation/components/ComposeStage';
import { RunStage } from '@/features/indicator-simulation/components/RunStage';
import { ScopeAreaDialog } from '@/features/indicator-simulation/components/ScopeAreaDialog';
import { useComposition } from '@/features/indicator-simulation/composables/useComposition';
import { useCanvasHolder } from '@/features/indicator-simulation/composables/useCanvasHolder';
import { usePauseWhileInactive } from '@/features/indicator-simulation/composables/usePauseWhileInactive';
import { usePromptComposer } from '@/features/indicator-simulation/composables/usePromptComposer';
import { useReasoningLog } from '@/features/indicator-simulation/composables/useReasoningLog';
import { useRunConversation } from '@/features/indicator-simulation/composables/useRunConversation';
import { useRunFlow } from '@/features/indicator-simulation/composables/useRunFlow';
import { useScopeEditor } from '@/features/indicator-simulation/composables/useScopeEditor';
import { useSimulationMap } from '@/features/indicator-simulation/composables/useSimulationMap';
import { useSimulationModel } from '@/features/indicator-simulation/composables/useSimulationModel';
import { useSimulationResult } from '@/features/indicator-simulation/composables/useSimulationResult';
import { useSimulationRun } from '@/features/indicator-simulation/composables/useSimulationRun';
import { useUserPause } from '@/features/indicator-simulation/composables/useUserPause';
import type { DialogueLine } from '@/features/indicator-simulation/compose/guide';
import { areaLabel, areaScope } from '@/features/indicator-simulation/model/scope';
import { reducedMotion, STILL_CLASS } from '@/features/indicator-simulation/motion';
import type { RunView } from '@/features/indicator-simulation/result/result-view';
import { useBasemap } from '@/shared/map/basemap/useBasemap';
import { useDefaultView } from '@/shared/map/useDefaultView';
import { useBoundaries } from '@/shared/map/boundary/useBoundaries';
import { usePageActive } from '@/shared/composables/usePageActive';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import styles from './IndicatorSimulationPage.module.scss';

/**
 * 指标智能推演（ADR 0105～0108）：条件编排 → AI 推演 → 结果展示，全部是确定性的本地数据，不请求后端。
 * 打开时编排是空的，由底部对话栏的推演指令或手动点选编排；AI 按指令逐个节点编排完成后自动开始推演，
 * 缺范围或有冲突时停在条件配置问用户，补齐后继续（ADR 0129）。
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

    // 区县的填充在底图之上、注记之下；遮罩盖住范围外，边界在上面，悬停的市描边最上。
    // 自定义范围的弹窗（ADR 0121）：覆盖的部分在注记之下，范围、绘制、编辑的手柄在最上
    const map = provideMap({
      groups: [
        'basemap',
        'simulation-districts',
        'simulation-mask',
        'simulation-facilities',
        'scope-cover',
        'basemap-labels',
        'boundaries',
        'simulation-highlight',
        'scope-area',
        'draw',
        'shape-edit'
      ],
      camera: JIANGSU_CAMERA
    });
    const { goToDefaultView } = useDefaultView(map);
    const basemap = useBasemap();
    const boundaries = useBoundaries();
    boundaries.setVisible('city', true);
    const composing = computed(() => run.state.value.status === 'idle');
    const scopeEditor = useScopeEditor(map, {
      model,
      goToDefaultView,
      // 计算和结果阶段：从条件解析重算；等范围时：补上并继续；纯手动配置：换上范围
      onConfirm: area => {
        if (!composing.value) {
          conversation.applyArea(area);
        } else if (composer.asking.value) {
          composer.supplyScope(areaScope(area), `${area.source === 'upload' ? '上传' : '绘制'}范围「${area.name}」`);
        } else {
          composition.setArea(area);
          ElMessage.success(`已使用${areaLabel(area)}`);
        }
      }
    });
    // 弹窗开着时结果地图让开、计算暂停，关上后恢复（ADR 0129）
    const canvasHolder = useCanvasHolder(scopeEditor.open);
    // 轮到弹窗放画布时才定位：换手之前的定位会落在要卸下的结果地图上（ADR 0131）
    watch(canvasHolder, holder => {
      if (holder === 'scope') {
        scopeEditor.frame();
      }
    });
    usePauseWhileInactive(run, computed(() => !scopeEditor.open.value));
    const simulationMap = useSimulationMap(run, map, result, () => scopeEditor.open.value);
    map.registerTools(scopeEditor.tools);
    map.bindStyle({
      basemap: basemap.deriveGroup,
      'basemap-labels': basemap.deriveLabelsGroup,
      boundaries: boundaries.deriveGroup,
      'simulation-districts': simulationMap.deriveDistricts,
      'simulation-mask': simulationMap.deriveMask,
      'simulation-facilities': simulationMap.deriveFacilities,
      'simulation-highlight': simulationMap.deriveHighlight,
      'scope-cover': scopeEditor.deriveCover,
      'scope-area': scopeEditor.deriveArea,
      draw: scopeEditor.draw.deriveGroup,
      'shape-edit': scopeEditor.edit.deriveGroup
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

    // 开始推演：按指令编排完成的，时间线先写上计算之前的对话
    const startWith = (dialogue: readonly DialogueLine[]) => {
      const current = model.value;
      if (current.status === 'ready') {
        log.begin(dialogue);
        run.start(composition.state.value, current.calculator);
      }
    };
    // 指令的文字在推演后回到编排时还在；AI 编排完成后直接开始推演（区县数据还没好时停在编排图，由用户点开始）；
    // 开始按钮、自动开始都经 composer 做执行校验
    const composer = usePromptComposer(composition, { onComposed: () => startWith(composer.dialogue.value) });
    // 推演和结果阶段的对话：暂停、继续、停止，改参数或条件；完成后还能看结果
    const conversation = useRunConversation(
      run,
      composition,
      userPause,
      log,
      {
        selection: result.selection,
        view: runView,
        select: result.select,
        show: view => {
          runView.value = view;
        }
      },
      { onScopeRemoved: said => composer.awaitScope(said) }
    );

    const renderStage = () =>
      composing.value ? (
        <ComposeStage
          key="compose"
          composition={composition}
          composer={composer}
          model={model.value}
          editor={scopeEditor}
          onStart={() => composer.start()}
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
          boundaries={boundaries}
          goToDefaultView={goToDefaultView}
          mapAvailable={canvasHolder.value === 'result'}
          scopeEditing={scopeEditor.open.value}
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
        <AiDock
          composer={composer}
          conversation={composing.value ? null : conversation}
          scope={{ composition, editor: scopeEditor }}
        />
        {/* 弹窗里的地图画布和结果的画布不能同时存在，由 canvasHolder 换手 */}
        <ScopeAreaDialog editor={scopeEditor} boundaries={boundaries} canvasReady={canvasHolder.value === 'scope'} />
      </div>
    );
  }
});
