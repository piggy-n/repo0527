import { Back, Operation, Share } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElMessage } from 'element-plus';
import { computed, defineComponent, onBeforeUnmount, type PropType, ref, watch } from 'vue';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import type { SimulationMap } from '../composables/useSimulationMap';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { SimulationResult } from '../composables/useSimulationResult';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { ApplyOutcome } from '../engine/engine';
import { InterventionPanel } from './InterventionPanel';
import { ResultMapTools } from './ResultMapTools';
import { ResultsPanel } from './ResultsPanel';
import { RunConditions, RunVersions } from './RunOverview';
import styles from './ResultStage.module.scss';
import { SimulationMapOverlay } from './SimulationMapOverlay';
import { StageStepper } from './StageStepper';

const APPLIED_MESSAGES: Readonly<Record<ApplyOutcome, string | null>> = {
  unchanged: null,
  saved: '参数已保存，执行到对应步骤时生效',
  rerun: '已按调整重新推演'
};

/**
 * 结果展示：浮在地图上的左侧推演概览（条件、版本）、右侧推演结果、顶部阶段条（回看推演流程、人工干预、重新编排），
 * 以及地图的着色工具与图例；人工干预基于正在看的一版，改参数时地图预览达标会变的区县
 */
export const ResultStage = defineComponent({
  name: 'ResultStage',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    simulationMap: { type: Object as PropType<SimulationMap>, required: true },
    result: { type: Object as PropType<SimulationResult>, required: true }
  },
  emits: {
    /** 回到推演流程图 */
    showFlow: () => true
  },
  setup(props, { emit }) {
    const { run, result } = props;
    const state = run.state;
    const overviewCollapsed = ref(false);
    const intervening = ref(false);

    // 贴边的面板登记给地图，镜头定位时避开（ADR 0029）
    const leftPanel = ref<HTMLElement>();
    const rightPanel = ref<HTMLElement>();
    const bar = ref<HTMLElement>();
    useMapOverlay(leftPanel, 'left');
    useMapOverlay(rightPanel, 'right');
    useMapOverlay(bar, 'top');
    // 阶段条放不下一行时换行，人工干预的面板排在它下面
    const { height: barHeight } = useShownElementSize(bar, { width: 0, height: 40 });

    const conditions = computed(() => state.value.conditions);
    // 窄屏时左右只显示最后操作的一边（ADR 0053 第 8 节），另一边显示成窄条或胶囊
    const sides = useSideExclusion({
      leftExpanded: () => !overviewCollapsed.value,
      rightOpen: () => true
    });

    // 打开人工干预时暂停（结果阶段干预后重算时用得上），关闭后继续
    let release: (() => void) | null = null;
    watch(intervening, open => {
      release?.();
      release = open ? run.pause() : null;
    });
    onBeforeUnmount(() => release?.());

    const closeIntervene = () => {
      intervening.value = false;
      result.setPreview(null);
    };

    const onApplied = (outcome: ApplyOutcome) => {
      closeIntervene();
      const message = APPLIED_MESSAGES[outcome];
      if (message !== null) {
        ElMessage.success(message);
      }
    };

    const renderOverview = () => {
      const selection = result.selection.value;
      if (!sides.left.value) {
        return (
          <button
            key="strip"
            type="button"
            class={styles.strip}
            aria-label="展开推演概览"
            onClick={() => {
              overviewCollapsed.value = false;
              sides.activate('left');
            }}
          >
            <SvgIcon name="panel-expand" />
            <span class={styles.stripLabel}>推演概览</span>
          </button>
        );
      }
      return (
        <div key="overview" ref={leftPanel} class={styles.left}>
          <MxPanel class={styles.overview} title="推演概览">
            {{
              actions: () => (
                <button type="button" class={styles.collapse} aria-label="收起推演概览" onClick={() => (overviewCollapsed.value = true)}>
                  <SvgIcon name="panel-collapse" />
                </button>
              ),
              default: () =>
                conditions.value && [
                  <RunConditions key="conditions" conditions={conditions.value} />,
                  selection && (
                    <RunVersions
                      key="versions"
                      versions={state.value.versions}
                      conditions={conditions.value}
                      viewing={selection.viewIndex}
                      onView={index => result.viewVersion(index)}
                    />
                  ),
                  <ElButton key="flow" class={styles.flowButton} icon={Share} onClick={() => emit('showFlow')}>
                    回看推演流程
                  </ElButton>
                ]
            }}
          </MxPanel>
        </div>
      );
    };

    const renderResults = () => {
      if (!conditions.value) {
        return null;
      }
      if (!sides.right.value) {
        return (
          <button key="pill" type="button" class={styles.pill} aria-label="展开推演结果" onClick={() => sides.activate('right')}>
            <SvgIcon name="simulation-indicator" />
            <span class={styles.pillText}>推演结果</span>
          </button>
        );
      }
      return (
        <div key="results" ref={rightPanel} class={styles.right}>
          <ResultsPanel result={result} conditions={conditions.value} versions={state.value.versions} />
        </div>
      );
    };

    return () => (
      <div
        class={[styles.root, !sides.left.value && styles.stepsCollapsed, !sides.right.value && styles.detailCollapsed]}
        style={{ '--bar-height': `${barHeight.value}px` }}
      >
        <SimulationMapOverlay simulationMap={props.simulationMap} />
        {conditions.value && <ResultMapTools key="tools" result={result} conditions={conditions.value} />}
        {renderOverview()}
        {renderResults()}
        <div ref={bar} class={styles.bar}>
          <div class={styles.stepper}>
            <StageStepper phase="result" />
          </div>
          <ElButton
            class={styles.barButton}
            icon={Operation}
            type={intervening.value ? 'primary' : 'default'}
            aria-pressed={intervening.value}
            onClick={() => (intervening.value = !intervening.value)}
          >
            人工干预
          </ElButton>
          <ElButton class={styles.barButton} icon={Back} onClick={() => run.stop()}>
            重新编排
          </ElButton>
        </div>
        {intervening.value && (
          <div key="intervene" class={styles.intervene}>
            <InterventionPanel
              run={run}
              model={props.model}
              baseIndex={result.selection.value?.viewIndex}
              onApplied={onApplied}
              onPreview={draft => result.setPreview(draft)}
              onClose={closeIntervene}
            />
          </div>
        )}
      </div>
    );
  }
});
