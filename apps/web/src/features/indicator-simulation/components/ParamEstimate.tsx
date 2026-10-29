import { computed, defineComponent, type PropType } from 'vue';
import type { SimulationModel } from '../composables/useSimulationModel';
import { formatDelta, formatValue } from '../format';
import { indicatorResult } from '../model/analysis';
import { simulationIndicator } from '../model/indicators';
import type { SimulationConditions, SimulationParams } from '../model/params';
import styles from './ParamEstimate.module.scss';

// 最多列出几项指标
const ROWS = 4;
// 变化小于这个值算不变
const FLAT = 0.005;

/** 改参数时的即时预估：最新年度全省的值和达标的市，改前 → 改后 */
export const ParamEstimate = defineComponent({
  name: 'ParamEstimate',
  props: {
    model: { type: Object as PropType<SimulationModel>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    base: { type: Object as PropType<SimulationParams>, required: true },
    draft: { type: Object as PropType<SimulationParams>, required: true },
    /** 预估下方的说明，如参数在什么时候生效 */
    note: { type: String, required: true }
  },
  setup(props) {
    const year = computed(() => Math.max(...props.conditions.years));

    const rows = computed(() => {
      const { model, conditions, base, draft } = props;
      if (model.status !== 'ready') {
        return [];
      }
      const before = model.calculator.computeYear(conditions, base, year.value).indicators;
      const after = model.calculator.computeYear(conditions, draft, year.value).indicators;
      return conditions.indicatorIds.slice(0, ROWS).map(id => {
        const a = indicatorResult(before, id);
        const b = indicatorResult(after, id);
        return { indicator: simulationIndicator(id), a, b, delta: b.value - a.value };
      });
    });

    const renderRows = () => {
      const { model, conditions } = props;
      if (model.status === 'loading') {
        return <p class={styles.status}>区县数据加载中，稍后显示预估</p>;
      }
      if (model.status === 'failed') {
        return <p class={styles.status}>区县数据加载失败，无法预估</p>;
      }
      const more = conditions.indicatorIds.length - ROWS;
      return (
        <>
          {rows.value.map(({ indicator, a, b, delta }) => {
            const tone = Math.abs(delta) < FLAT ? 'flat' : delta > 0 ? 'up' : 'down';
            return (
              <div key={indicator.id} class={styles.row}>
                <span class={styles.name}>{indicator.name}</span>
                <span class={styles.pass}>
                  达标 {a.passCount} → {b.passCount} 市
                </span>
                <span class={styles.values}>
                  <span>{formatValue(a.value, indicator)}</span>
                  <span>→</span>
                  <b>{formatValue(b.value, indicator)}</b>
                  <span class={styles[tone]}>{tone === 'flat' ? '不变' : formatDelta(delta, indicator)}</span>
                </span>
              </div>
            );
          })}
          {more > 0 && <p class={styles.note}>另有 {more} 项指标同步预估</p>}
        </>
      );
    };

    return () => (
      <div class={styles.root} aria-live="polite">
        <div class={styles.head}>{year.value} 年全省预估</div>
        {renderRows()}
        <p class={styles.note}>{props.note}</p>
      </div>
    );
  }
});
