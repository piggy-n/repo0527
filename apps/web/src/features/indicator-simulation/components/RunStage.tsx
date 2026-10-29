import { Back, CircleClose, Operation } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { ElButton, ElMessage, ElPopconfirm } from 'element-plus';
import { computed, type ComputedRef, defineComponent, onBeforeUnmount, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { SimulationMap } from '../composables/useSimulationMap';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { ApplyOutcome, MissingPopulation } from '../engine/engine';
import { STEP_GROUPS, type StepGroupId } from '../engine/steps';
import { describeChanges, type NarrativeInput, type StepRecord, stepRecord } from '../run/narrative';
import { currentGroup, doneCount, groupStatus, inProgress, stepGroup } from '../run/run-view';
import { DetailPanel } from './DetailPanel';
import { InterventionPanel } from './InterventionPanel';
import styles from './RunStage.module.scss';
import { SimulationMapOverlay } from './SimulationMapOverlay';
import { StageStepper } from './StageStepper';
import { StepsPanel } from './StepsPanel';

const APPLIED_MESSAGES: Readonly<Record<ApplyOutcome, string | null>> = {
  unchanged: null,
  saved: '参数已保存，执行到对应步骤时生效',
  resolved: '已按调整确认，接着推演',
  rerun: '已按调整重新推演'
};

/** AI 推演阶段：浮在地图上的左侧步骤、右上当前步骤、顶部阶段条和人工干预，以及地图上的扫描带和标注 */
export const RunStage = defineComponent({
  name: 'RunStage',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    /** 推演的地图；页面在地图上层放这个阶段 */
    simulationMap: { type: Object as PropType<SimulationMap>, required: true }
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

    // 叙述只随这些变化，状态里其余的变化（步骤推进）不重新生成
    const conditions = computed(() => state.value.conditions);
    const params = computed(() => state.value.params);
    const baseParams = computed(() => state.value.baseParams);
    const decided = computed(() => state.value.decided);
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
        decided: decided.value,
        version: version.value
      };
    });
    // 每行一个计算属性：只在用到时生成
    const records = Object.fromEntries(
      STEP_GROUPS.map(group => [group.id, computed(() => (input.value ? stepRecord(group.id, input.value) : null))])
    ) as Record<StepGroupId, ComputedRef<StepRecord | null>>;
    const recordOf = (group: StepGroupId) => records[group].value;

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

    // 人工干预里缺失处理的区县：按当前的人口口径插补
    const missing = computed((): MissingPopulation[] => {
      const calculator = run.calculator.value;
      if (!calculator || !conditions.value) {
        return [];
      }
      const year = Math.max(...conditions.value.years);
      return calculator.missingDistricts(year, conditions.value.cityCodes).map(district => ({
        district,
        imputed: calculator.imputedPopulation(district, year, params.value.popCaliber)
      }));
    });

    // 需要确认时右上自动展开，回到当前
    watch(
      () => state.value.checkpoint,
      checkpoint => {
        if (checkpoint) {
          detailCollapsed.value = false;
          pinned.value = null;
        }
      }
    );

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

    const onApplied = (outcome: ApplyOutcome) => {
      intervening.value = false;
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

    const renderSteps = () =>
      stepsCollapsed.value ? (
        <button
          key="strip"
          type="button"
          class={styles.strip}
          aria-label="展开推演步骤"
          onClick={() => (stepsCollapsed.value = false)}
        >
          <SvgIcon name="panel-expand" />
          <span class={styles.stripLabel}>AI 推演</span>
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
            selected={shown.value}
            onSelect={group => {
              pinned.value = group === current.value ? null : group;
              detailCollapsed.value = false;
            }}
            onCollapse={() => (stepsCollapsed.value = true)}
          />
        </div>
      );

    const renderDetail = () => {
      const checkpoint = state.value.checkpoint !== null;
      if (detailCollapsed.value) {
        return (
          <button
            key="pill"
            type="button"
            class={[styles.pill, checkpoint && styles.attention]}
            aria-label="展开当前步骤"
            onClick={() => (detailCollapsed.value = false)}
          >
            <span class={styles.pulse} />
            <span class={styles.pillText}>当前步骤 · {stepGroup(shown.value).name}</span>
          </button>
        );
      }
      return (
        <div key="detail" ref={rightPanel} class={styles.right}>
          <DetailPanel
            state={state.value}
            progress={run.progress}
            group={shown.value}
            record={recordOf(shown.value)}
            reviewing={reviewing.value}
            note={note.value}
            onResolve={decision => run.resolveCheckpoint(decision)}
            onAdjust={() => (intervening.value = true)}
            onBack={() => (pinned.value = null)}
            onCollapse={() => (detailCollapsed.value = true)}
          />
        </div>
      );
    };

    return () => (
      <div
        class={[
          styles.root,
          stepsCollapsed.value && styles.stepsCollapsed,
          detailCollapsed.value && styles.detailCollapsed
        ]}
        data-status={state.value.status}
        data-current={current.value === null ? undefined : groupStatus(current.value, state.value.steps)}
      >
        <SimulationMapOverlay simulationMap={props.simulationMap} running={inProgress(state.value.status)} />
        {renderSteps()}
        {renderDetail()}
        {renderBar()}
        {intervening.value && (
          <div key="intervene" class={styles.intervene}>
            <InterventionPanel
              run={run}
              model={props.model}
              missing={missing.value}
              onApplied={onApplied}
              onClose={() => (intervening.value = false)}
            />
          </div>
        )}
      </div>
    );
  }
});
