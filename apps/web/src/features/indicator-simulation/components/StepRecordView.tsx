import { defineComponent, type PropType } from 'vue';
import { stepDefinition, type StepId } from '../engine/steps';
import type { Metric, NarrativeLine, StepRecord } from '../run/narrative';
import { RichText } from './RichText';
import styles from './StepRecordView.module.scss';

// 打字的速度、数字滚动的时长（毫秒，按步骤自己的时间算，暂停时一起停）
const CHAR_MS = 26;
const COUNT_MS = 900;

const length = (line: NarrativeLine): number =>
  line.text.reduce((sum, part) => sum + (typeof part === 'string' ? part : part.em).length, 0);

/** 一步的记录：分析过程按进度逐句打出，数字滚动出现；动效全部由步骤的进度算出，暂停、回看、恢复页面时都对得上 */
export const StepRecordView = defineComponent({
  name: 'StepRecordView',
  props: {
    record: { type: Object as PropType<StepRecord>, required: true },
    /** 步骤的进度 0～1 */
    progress: { type: Function as PropType<(step: StepId) => number>, required: true },
    /** 步骤是否已经开始（进行、完成、复用） */
    started: { type: Function as PropType<(step: StepId) => boolean>, required: true },
    /** 减少动画：直接显示完整的文字和数字 */
    still: Boolean,
    /** 干预后重算的说明，写在分析过程的最前面 */
    note: { type: String as PropType<string | null>, default: null }
  },
  setup(props) {
    // 进度过了 at 以后经过的毫秒数
    const elapsed = (step: StepId, at: number) => (props.progress(step) - at) * stepDefinition(step).duration;

    const renderLine = (line: NarrativeLine, index: number) => {
      const total = length(line);
      const typed = props.still ? total : Math.floor(elapsed(line.step, line.at) / CHAR_MS);
      return (
        <p key={index} class={[styles.line, typed < total && styles.typing]}>
          <RichText text={line.text} limit={typed} />
        </p>
      );
    };

    const metricText = (metric: Metric) => {
      const progress = props.progress(metric.step);
      if (props.still || progress >= 1) {
        return metric.format(metric.value);
      }
      const t = Math.min(1, Math.max(0, elapsed(metric.step, metric.at) / COUNT_MS));
      return metric.format(metric.value * (1 - (1 - t) ** 3));
    };

    return () => {
      const { record, progress, started, note } = props;
      const steps = new Set<StepId>(record.blocks.flatMap(block => block.lines.map(line => line.step)));
      const anyStarted =
        [...steps].some(started) || record.blocks.some(block => block.tools.some(tool => started(tool.step)));
      if (!anyStarted) {
        return <p class={styles.empty}>{note === null ? '等待开始' : '参数已调整，等待重算'}</p>;
      }
      const metrics = record.metrics.filter(metric => progress(metric.step) >= metric.at);
      return (
        <div class={styles.root}>
          <section class={styles.block}>
            <h4>分析过程</h4>
            {note !== null && <div class={styles.note}>{note}</div>}
            {record.blocks.map((block, index) => {
              const tools = block.tools.filter(tool => started(tool.step));
              const lines = block.lines.filter(line => progress(line.step) >= line.at);
              if (tools.length === 0 && lines.length === 0) {
                return null;
              }
              return (
                <div key={block.label ?? index} class={styles.analysis}>
                  {block.label !== null && <div class={styles.label}>{block.label}</div>}
                  <div class={styles.tools}>
                    {tools.map(tool => (
                      <span key={tool.label} class={[styles.tool, progress(tool.step) >= tool.doneAt && styles.done]}>
                        {tool.label}
                      </span>
                    ))}
                  </div>
                  {lines.map(renderLine)}
                </div>
              );
            })}
          </section>
          {metrics.length > 0 && (
            <section class={styles.block}>
              <h4>数据</h4>
              <div class={styles.metrics}>
                {metrics.map(metric => (
                  <div key={metric.label} class={styles.metric}>
                    <span>{metric.label}</span>
                    <b>{metricText(metric)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}
          {record.basis.length > 0 && (
            <section class={styles.block}>
              <h4>计算依据</h4>
              {record.basis.map((line, index) => (
                <div key={index} class={styles.basis}>
                  <RichText text={line} />
                </div>
              ))}
            </section>
          )}
          {record.params.length > 0 && (
            <section class={styles.block}>
              <h4>参数</h4>
              <div class={styles.params}>
                {record.params.map(chip => (
                  <span key={chip.label} class={[styles.param, chip.from !== null && styles.changed]}>
                    <span>{chip.label}</span>
                    <b>{chip.from === null ? chip.value : `${chip.from} → ${chip.value}`}</b>
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      );
    };
  }
});
