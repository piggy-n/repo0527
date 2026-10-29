import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { computed, defineComponent, type PropType, shallowRef } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { SimulationRun } from '../composables/useSimulationRun';
import type { SimulationModel } from '../composables/useSimulationModel';
import type { ApplyOutcome } from '../engine/engine';
import { PARAM_STEP, stepDefinition, type StepId } from '../engine/steps';
import { inProgress, planText } from '../run/run-view';
import { type ParamKey, paramsOf, type SimulationParams } from '../model/params';
import styles from './InterventionPanel.module.scss';
import { ParamEstimate } from './ParamEstimate';
import { ParamFields } from './ParamFields';

const BUTTON_LABELS: Readonly<Record<ApplyOutcome, string>> = {
  unchanged: '应用',
  saved: '保存',
  rerun: '应用并重算'
};

// 所选指标用得上的参数，按用到它的步骤分组，顺序同推演
function groupsOf(indicatorIds: readonly string[]): { readonly step: StepId; readonly keys: ParamKey[] }[] {
  const groups = new Map<StepId, ParamKey[]>();
  for (const key of paramsOf(indicatorIds)) {
    const step = PARAM_STEP[key];
    groups.set(step, [...(groups.get(step) ?? []), key]);
  }
  return [...groups].map(([step, keys]) => ({ step, keys }));
}

/** 人工干预：推演中打开时暂停，改参数时即时预估，按引擎的规则保存或重算 */
export const InterventionPanel = defineComponent({
  name: 'InterventionPanel',
  props: {
    run: { type: Object as PropType<SimulationRun>, required: true },
    model: { type: Object as PropType<SimulationModel>, required: true },
    /** 结果阶段基于哪一版调整；推演中不传，基于当前参数 */
    baseIndex: { type: Number, default: undefined }
  },
  emits: {
    applied: (outcome: ApplyOutcome) => typeof outcome === 'string',
    /** 草稿变了：结果阶段在地图上预览达标会变的区县 */
    preview: (draft: SimulationParams) => typeof draft === 'object',
    close: () => true
  },
  setup(props, { emit }) {
    // 打开时的参数是基准（结果阶段是所基于那一版的参数），关闭时卸载、草稿丢弃
    const { versions, params } = props.run.state.value;
    const base = props.baseIndex === undefined ? params : (versions[props.baseIndex]?.params ?? params);
    const draft = shallowRef<SimulationParams>(base);
    const options = () => (props.baseIndex === undefined ? {} : { baseIndex: props.baseIndex });
    const plan = computed(() => props.run.planApply(draft.value, options()));
    const update = (next: SimulationParams) => {
      draft.value = next;
      emit('preview', next);
    };

    const apply = () => {
      const outcome = props.run.apply(draft.value, options());
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
                {groupsOf(conditions.indicatorIds).map(group => (
                  <section key={group.step} class={styles.group}>
                    <h4>{stepDefinition(group.step).name}</h4>
                    <ParamFields
                      keys={group.keys}
                      conditions={conditions}
                      modelValue={draft.value}
                      onUpdate:modelValue={update}
                    />
                  </section>
                ))}
              </div>
            ),
            footer: () => [
              <span key="hint" class={styles.hint}>
                {inProgress(state.value.status)
                  ? '推演已暂停，关闭后继续'
                  : `基于 ${state.value.versions[props.baseIndex ?? state.value.versions.length - 1]?.label ?? '最新一版'} 调整，生成新版本`}
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
