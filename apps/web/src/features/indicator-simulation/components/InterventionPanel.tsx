import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, shallowRef } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { ApplyOutcome, MissingPopulation } from '../engine/engine';
import { stepDefinition, type StepId } from '../engine/steps';
import { inProgress, planText } from '../run/run-view';
import type { ParamKey, SimulationParams } from '../model/params';
import styles from './InterventionPanel.module.scss';
import { ParamEstimate } from './ParamEstimate';
import { ParamFields } from './ParamFields';

// 参数按用到它的步骤分组，顺序同推演
const GROUPS: readonly { readonly step: StepId; readonly keys: readonly ParamKey[] }[] = [
  { step: 'pop', keys: ['popCaliber'] },
  { step: 'qc', keys: ['missing'] },
  { step: 'spatial', keys: ['walkSpeed', 'facilityScope', 'newFacilities'] },
  { step: 'evaluate', keys: ['targets'] }
];

const BUTTON_LABELS: Readonly<Record<ApplyOutcome, string>> = {
  unchanged: '应用',
  saved: '保存',
  resolved: '确定',
  rerun: '应用并重算'
};

/** 人工干预：推演中打开时暂停，改参数时即时预估，按引擎的规则保存、作为确认或重算 */
export const InterventionPanel = defineComponent({
  name: 'InterventionPanel',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    /** 最新年度缺失人口的区县：数据核查决定过以后才能在这里改 */
    missing: { type: Array as PropType<readonly MissingPopulation[]>, default: () => [] }
  },
  emits: {
    applied: (outcome: ApplyOutcome) => typeof outcome === 'string',
    close: () => true
  },
  setup(props, { emit }) {
    // 打开时的参数是基准，关闭时卸载、草稿丢弃
    const base = props.run.state.value.params;
    const draft = shallowRef<SimulationParams>(base);
    const plan = computed(() => props.run.planApply(draft.value));

    const apply = () => {
      const outcome = props.run.apply(draft.value);
      emit('applied', outcome);
    };

    return () => {
      const { state } = props.run;
      const conditions = state.value.conditions;
      if (!conditions) {
        return null;
      }
      return (
        <MxPanel class={styles.panel} title="人工干预" headerTone="muted" floating>
          {{
            icon: () => <SvgIcon name="simulation-tune" />,
            actions: () => (
              <button type="button" class={styles.close} aria-label="关闭人工干预" onClick={() => emit('close')}>
                <SvgIcon name="close" />
              </button>
            ),
            default: () => (
              <div class={styles.body}>
                <ParamEstimate
                  model={props.model}
                  conditions={conditions}
                  base={base}
                  draft={draft.value}
                  note={planText(plan.value)}
                />
                {GROUPS.map(group => (
                  <section key={group.step} class={styles.group}>
                    <h4>{stepDefinition(group.step).name}</h4>
                    <ParamFields
                      keys={group.keys}
                      conditions={conditions}
                      missing={state.value.decided.qc ? props.missing : []}
                      modelValue={draft.value}
                      onUpdate:modelValue={params => (draft.value = params)}
                    />
                  </section>
                ))}
              </div>
            ),
            footer: () => [
              <span key="hint" class={styles.hint}>
                {inProgress(state.value.status) ? '推演已暂停，关闭后继续' : '基于最新一版调整，生成新版本'}
              </span>,
              <ElButton key="cancel" onClick={() => emit('close')}>
                取消
              </ElButton>,
              <ElButton key="apply" type="primary" disabled={plan.value.outcome === 'unchanged'} onClick={apply}>
                {BUTTON_LABELS[plan.value.outcome]}
              </ElButton>
            ]
          }}
        </MxPanel>
      );
    };
  }
});
