import { Back, CircleClose, Operation } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { ElButton, ElMessage, ElPopconfirm } from 'element-plus';
import { computed, type ComputedRef, defineComponent, onBeforeUnmount, type PropType, ref, watch } from 'vue';
import { useShownElementSize } from '@/shared/composables/useShownElementSize';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import { useSideExclusion } from '@/shared/map/panel-group/useSideExclusion';
import type { SimulationMap } from '../composables/useSimulationMap';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { SimulationResult } from '../composables/useSimulationResult';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { ApplyOutcome } from '../engine/engine';
import { STEP_GROUPS, type StepGroupId } from '../engine/steps';
import { describeChanges, type NarrativeInput, type StepRecord, stepRecord } from '../run/narrative';
import { currentGroup, doneCount, groupStatus, inProgress, stepGroup } from '../run/run-view';
import { DetailPanel } from './DetailPanel';
import { InterventionPanel } from './InterventionPanel';
import { ResultMapTools } from './ResultMapTools';
import { ResultsPanel } from './ResultsPanel';
import { RunConditions, RunVersions } from './RunOverview';
import styles from './RunStage.module.scss';
import { SimulationMapOverlay } from './SimulationMapOverlay';
import { StageStepper } from './StageStepper';
import { StepsPanel } from './StepsPanel';

const APPLIED_MESSAGES: Readonly<Record<ApplyOutcome, string | null>> = {
  unchanged: null,
  saved: '参数已保存，执行到对应步骤时生效',
  rerun: '已按调整重新推演'
};

/**
 * AI 推演与结果阶段：浮在地图上的左侧步骤（完成后是推演概览）、右上当前步骤（完成后是推演结果）、顶部阶段条和人工干预，
 * 以及地图上的扫描带、标注和结果地图的工具与图例
 */
export const RunStage = defineComponent({
  name: 'RunStage',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    /** 推演的地图；页面在地图上层放这个阶段 */
    simulationMap: { type: Object as PropType<SimulationMap>, required: true },
    result: { type: Object as PropType<SimulationResult>, required: true }
  },
  setup(props) {
    const { run } = props;
    const state = run.state;
    const stepsCollapsed = ref(false);
    const detailCollapsed = ref(false);
    // 点左侧回看的一行；null 是跟随当前
    const pinned = ref<StepGroupId | null>(null);
    const intervening = ref(false);

    // 贴边的面板登记给地图，镜头定位时避开（ADR 0029）
    const leftPanel = ref<HTMLElement>();
    const rightPanel = ref<HTMLElement>();
    const bar = ref<HTMLElement>();
    useMapOverlay(leftPanel, 'left');
    useMapOverlay(rightPanel, 'right');
    useMapOverlay(bar, 'top');
    // 阶段条放不下一行时换行，人工干预和回看的面板排在它下面
    const { height: barHeight } = useShownElementSize(bar, { width: 0, height: 40 });

    // 叙述只随这些变化，状态里其余的变化（步骤推进）不重新生成
    const conditions = computed(() => state.value.conditions);
    const params = computed(() => state.value.params);
    const baseParams = computed(() => state.value.baseParams);
    // 完成时这一轮的版本已经加进去了
    const version = computed(() => state.value.versions.length + (state.value.status === 'done' ? 0 : 1));
    const input = computed((): NarrativeInput | null => {
      const calculator = run.calculator.value;
      if (!calculator || !conditions.value) {
        return null;
      }
      return {
        calculator,
        conditions: conditions.value,
        params: params.value,
        baseParams: baseParams.value,
        version: version.value
      };
    });
    // 每行一个计算属性：只在用到时生成
    const records = Object.fromEntries(
      STEP_GROUPS.map(group => [group.id, computed(() => (input.value ? stepRecord(group.id, input.value) : null))])
    ) as Record<StepGroupId, ComputedRef<StepRecord | null>>;
    const recordOf = (group: StepGroupId) => records[group].value;

    // 完成且有了结果的选择：右侧换成推演结果，左侧换成推演概览
    const resultPhase = computed(() => state.value.status === 'done' && props.result.selection.value !== null);
    // 窄屏时左右只显示最后操作的一边（ADR 0053 第 8 节），另一边显示成窄条或胶囊；不改两边各自的收起状态
    const sides = useSideExclusion({
      leftExpanded: () => !stepsCollapsed.value,
      rightOpen: () => resultPhase.value || !detailCollapsed.value
    });
    const expandSteps = () => {
      stepsCollapsed.value = false;
      sides.activate('left');
    };
    const expandRight = () => {
      detailCollapsed.value = false;
      sides.activate('right');
    };
    const current = computed(() => currentGroup(state.value));
    const shown = computed(() => pinned.value ?? current.value ?? 'parse');
    const reviewing = computed(() => pinned.value !== null && pinned.value !== current.value);

    // 干预后重算的行：分析过程最前面写这次改了什么
    const note = computed(() => {
      const { adjustment, steps } = state.value;
      const group = stepGroup(shown.value);
      const rerun = group.steps.some(step => steps[step].status !== 'reused');
      if (adjustment === null || adjustment.changes.length === 0 || !rerun || !conditions.value) {
        return null;
      }
      const changes = describeChanges(adjustment.changes, adjustment.from, params.value, conditions.value);
      return `调整后重算：${changes.join('；')}`;
    });

    // 打开人工干预时暂停，关闭后继续
    let release: (() => void) | null = null;
    watch(intervening, open => {
      release?.();
      release = open ? run.pause() : null;
    });
    onBeforeUnmount(() => release?.());

    const stop = () => {
      intervening.value = false;
      run.stop();
      ElMessage.success('已停止推演，编排的条件已保留');
    };

    const closeIntervene = () => {
      intervening.value = false;
      props.result.setPreview(null);
    };

    const onApplied = (outcome: ApplyOutcome) => {
      closeIntervene();
      // 重算时跟随当前步骤，不停在回看的那一行
      if (outcome === 'rerun') {
        pinned.value = null;
      }
      const message = APPLIED_MESSAGES[outcome];
      if (message !== null) {
        ElMessage.success(message);
      }
    };

    const renderBar = () => {
      const running = inProgress(state.value.status);
      return (
        <div ref={bar} class={styles.bar}>
          <div class={styles.stepper}>
            <StageStepper phase={state.value.status === 'done' ? 'result' : 'running'} />
          </div>
          <ElButton
            class={styles.barButton}
            icon={Operation}
            type={intervening.value ? 'primary' : 'default'}
            disabled={!running && state.value.status !== 'done'}
            aria-pressed={intervening.value}
            onClick={() => (intervening.value = !intervening.value)}
          >
            人工干预
          </ElButton>
          {running ? (
            <ElPopconfirm
              key="stop"
              title="停止推演？编排的条件会保留"
              confirmButtonText="停止"
              cancelButtonText="继续"
              onConfirm={stop}
            >
              {{
                reference: () => (
                  <ElButton class={styles.barButton} icon={CircleClose}>
                    停止
                  </ElButton>
                )
              }}
            </ElPopconfirm>
          ) : (
            <ElButton key="recompose" class={styles.barButton} icon={Back} onClick={() => run.stop()}>
              重新编排
            </ElButton>
          )}
        </div>
      );
    };

    // 推演概览的条件和版本：只在结果阶段
    const renderConditions = () =>
      resultPhase.value && conditions.value ? <RunConditions conditions={conditions.value} /> : null;
    const renderVersions = () => {
      const selection = props.result.selection.value;
      if (!resultPhase.value || !conditions.value || !selection) {
        return null;
      }
      return (
        <RunVersions
          versions={state.value.versions}
          conditions={conditions.value}
          viewing={selection.viewIndex}
          onView={index => props.result.viewVersion(index)}
        />
      );
    };

    const renderSteps = () =>
      !sides.left.value ? (
        <button key="strip" type="button" class={styles.strip} aria-label="展开推演步骤" onClick={expandSteps}>
          <SvgIcon name="panel-expand" />
          <span class={styles.stripLabel}>{resultPhase.value ? '推演概览' : 'AI 推演'}</span>
          <span class={styles.stripCount}>
            {doneCount(state.value)}/{STEP_GROUPS.length}
          </span>
        </button>
      ) : (
        <div key="steps" ref={leftPanel} class={styles.left}>
          <StepsPanel
            state={state.value}
            progress={run.progress}
            recordOf={recordOf}
            selected={resultPhase.value ? pinned.value : shown.value}
            title={resultPhase.value ? '推演概览' : 'AI 推演'}
            compact={resultPhase.value}
            onSelect={group => {
              // 结果阶段点一行回看，再点一次收起；推演中点当前行回到跟随
              if (resultPhase.value) {
                pinned.value = pinned.value === group ? null : group;
              } else {
                pinned.value = group === current.value ? null : group;
              }
              expandRight();
            }}
            onCollapse={() => (stepsCollapsed.value = true)}
          >
            {{ before: renderConditions, after: renderVersions }}
          </StepsPanel>
        </div>
      );

    const renderDetailPanel = (group: StepGroupId) => (
      <DetailPanel
        state={state.value}
        progress={run.progress}
        group={group}
        record={recordOf(group)}
        reviewing={reviewing.value || resultPhase.value}
        note={note.value}
        onBack={() => (pinned.value = null)}
        onCollapse={() => {
          if (resultPhase.value) {
            pinned.value = null;
          } else {
            detailCollapsed.value = true;
          }
        }}
      />
    );

    // 结果阶段：右侧是推演结果，回看某一步时详情在它左边
    const renderResult = () => {
      if (!conditions.value) {
        return null;
      }
      return [
        <div key="results" ref={rightPanel} class={styles.right}>
          <ResultsPanel
            result={props.result}
            conditions={conditions.value}
            versions={state.value.versions}
          />
        </div>,
        pinned.value !== null && (
          <div key="review" class={styles.review}>
            {renderDetailPanel(pinned.value)}
          </div>
        )
      ];
    };

    const renderDetail = () => {
      if (resultPhase.value && !sides.right.value) {
        return (
          <button key="results-pill" type="button" class={styles.pill} aria-label="展开推演结果" onClick={expandRight}>
            <SvgIcon name="simulation-indicator" />
            <span class={styles.pillText}>推演结果</span>
          </button>
        );
      }
      if (resultPhase.value) {
        return renderResult();
      }
      if (!sides.right.value) {
        return (
          <button key="pill" type="button" class={styles.pill} aria-label="展开当前步骤" onClick={expandRight}>
            <span class={styles.pulse} />
            <span class={styles.pillText}>当前步骤 · {stepGroup(shown.value).name}</span>
          </button>
        );
      }
      return (
        <div key="detail" ref={rightPanel} class={styles.right}>
          {renderDetailPanel(shown.value)}
        </div>
      );
    };

    return () => (
      <div
        class={[
          styles.root,
          !sides.left.value && styles.stepsCollapsed,
          !sides.right.value && styles.detailCollapsed
        ]}
        style={{ '--bar-height': `${barHeight.value}px` }}
        data-status={state.value.status}
        data-current={current.value === null ? undefined : groupStatus(current.value, state.value.steps)}
      >
        <SimulationMapOverlay simulationMap={props.simulationMap} running={inProgress(state.value.status)} />
        {resultPhase.value && conditions.value && (
          <ResultMapTools key="tools" result={props.result} conditions={conditions.value} />
        )}
        {renderSteps()}
        {renderDetail()}
        {renderBar()}
        {intervening.value && (
          <div key="intervene" class={styles.intervene}>
            <InterventionPanel
              run={run}
              model={props.model}
              baseIndex={resultPhase.value ? props.result.selection.value?.viewIndex : undefined}
              onApplied={onApplied}
              onPreview={draft => {
                if (resultPhase.value) {
                  props.result.setPreview(draft);
                }
              }}
              onClose={closeIntervene}
            />
          </div>
        )}
      </div>
    );
  }
});
