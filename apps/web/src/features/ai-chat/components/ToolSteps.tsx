import { Check, CloseBold, Loading } from '@element-plus/icons-vue';
import { ElIcon } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import {
  stepDescription,
  stepErrorJson,
  stepsRunning,
  stepsSummary,
  stepStatusText,
  stepTitle,
  type ToolStep
} from '../tool-steps';
import styles from './ToolSteps.module.scss';

const STATUS_ICONS = { running: Loading, succeeded: Check, failed: CloseBold };

function renderMarker(status: ToolStep['status']) {
  const Icon = STATUS_ICONS[status];
  return (
    <span class={[styles.marker, styles[status]]}>
      <ElIcon class={status === 'running' ? styles.spin : undefined}>
        <Icon />
      </ElIcon>
    </span>
  );
}

/** 回答过程中的查询步骤：摘要一行，展开后是时间线，失败的步骤附上排查用的 JSON */
export const ToolSteps = defineComponent({
  name: 'ToolSteps',
  props: {
    steps: { type: Array as PropType<readonly ToolStep[]>, required: true },
    expanded: { type: Boolean, required: true }
  },
  emits: {
    'update:expanded': (value: boolean) => typeof value === 'boolean'
  },
  setup(props, { emit }) {
    return () => {
      const running = stepsRunning(props.steps);
      return (
        <div class={styles.root}>
          <button
            type="button"
            class={styles.summary}
            aria-expanded={props.expanded}
            onClick={() => emit('update:expanded', !props.expanded)}
          >
            {renderMarker(running ? 'running' : 'succeeded')}
            <span class={styles.summaryText}>{stepsSummary(props.steps)}</span>
            <span class={styles.toggle}>{props.expanded ? '收起' : '展开'}</span>
          </button>
          {props.expanded && (
            <ol class={styles.list}>
              {props.steps.map((step, index) => (
                <li key={index} class={styles.step}>
                  {renderMarker(step.status)}
                  <div class={styles.content}>
                    <div class={styles.header}>
                      <span class={styles.name}>{stepTitle(step.name)}</span>
                      <span class={[styles.state, styles[step.status]]}>{stepStatusText(step)}</span>
                    </div>
                    {step.status === 'failed' ? (
                      <pre class={styles.json}>{stepErrorJson(step)}</pre>
                    ) : (
                      <p class={styles.description}>{stepDescription(step)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      );
    };
  }
});
