import { defineComponent, type PropType } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import styles from './StageStepper.module.scss';

/** 页面的三个阶段 */
export type SimulationPhase = 'compose' | 'running' | 'result';

const STAGES: readonly { readonly id: SimulationPhase; readonly name: string }[] = [
  { id: 'compose', name: '条件配置' },
  { id: 'running', name: 'AI计算' },
  { id: 'result', name: '结果展示' }
];

/** 阶段条：条件配置 → AI计算 → 结果展示 */
export const StageStepper = defineComponent({
  name: 'StageStepper',
  props: {
    phase: { type: String as PropType<SimulationPhase>, required: true }
  },
  setup(props) {
    return () => {
      const current = STAGES.findIndex(stage => stage.id === props.phase);
      return (
        <ol class={styles.root} aria-label="计算阶段">
          {STAGES.map((stage, index) => {
            const state = index < current ? 'done' : index === current ? 'current' : 'todo';
            return (
              <li key={stage.id} class={styles[state]} aria-current={state === 'current' ? 'step' : undefined}>
                <i class={styles.mark}>{state === 'done' ? <SvgIcon name="check" /> : index + 1}</i>
                {stage.name}
              </li>
            );
          })}
        </ol>
      );
    };
  }
});
