import { MxTitle } from '@yzt/ui';
import { computed, defineComponent, type PropType } from 'vue';
import type { SimulationModel } from '../composables/useSimulationModel';
import { formatEstimate, formatEstimateDelta, roundEstimate } from '../format';
import { indicatorResult } from '../model/analysis';
import { simulationIndicator } from '../model/indicators';
import type { SimulationConditions, SimulationParams } from '../model/params';
import styles from './ParamEstimate.module.scss';

// 最多列出几项指标
const ROWS = 4;

/** 改参数时的即时预估：最新年度全省的值，改前 → 改后；上升红色、下降绿色 */
export const ParamEstimate = defineComponent({
  name: 'ParamEstimate',
  props: {
    model: { type: Object as PropType<SimulationModel>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    base: { type: Object as PropType<SimulationParams>, required: true },
    draft: { type: Object as PropType<SimulationParams>, required: true },
    /** 预估下方的说明，如人工干预会从哪一步重算；没有时不显示 */
    note: String
  },
  setup(props) {
    // 预估的年度：所选的最新一年；还没选年度时没有
    const year = computed(() => (props.conditions.years.length === 0 ? null : Math.max(...props.conditions.years)));
    // 选了几个年度时只预估最新的一个，写明是哪一年
    const scope = computed(() => {
      if (year.value === null) {
        return undefined;
      }
      return props.conditions.years.length > 1 ? `全省 · 最新年度 ${year.value} 年` : `全省 · ${year.value} 年`;
    });

    const rows = computed(() => {
      const { model, conditions, base, draft } = props;
      if (model.status !== 'ready' || year.value === null) {
        return [];
      }
      const before = model.calculator.computeYear(conditions, base, year.value).indicators;
      const after = model.calculator.computeYear(conditions, draft, year.value).indicators;
      return conditions.indicatorIds.slice(0, ROWS).map(id => {
        const indicator = simulationIndicator(id);
        const a = indicatorResult(before, id);
        const b = indicatorResult(after, id);
        // 按显示的精度取整后相减，变化量和改前改后的数对得上
        const delta = roundEstimate(roundEstimate(b.value, indicator) - roundEstimate(a.value, indicator), indicator);
        return { indicator, a, b, delta };
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
      if (year.value === null) {
        return <p class={styles.status}>选择监测年份后显示预估</p>;
      }
      const more = conditions.indicatorIds.length - ROWS;
      return (
        <>
          {rows.value.map(({ indicator, a, b, delta }) => {
            const tone = delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
            return (
              <div key={indicator.id} class={styles.row}>
                <span class={styles.name} title={indicator.name}>
                  {indicator.name}
                </span>
                <span class={styles.values}>
                  <span>{formatEstimate(a.value, indicator)}</span>
                  <span>→</span>
                  <b>{formatEstimate(b.value, indicator)}</b>
                  <span class={styles[tone]}>{tone === 'flat' ? '不变' : formatEstimateDelta(delta, indicator)}</span>
                </span>
              </div>
            );
          })}
          {more > 0 && <p class={styles.note}>另有 {more} 项指标同步预估</p>}
        </>
      );
    };

    return () => (
      <div class={styles.root}>
        <MxTitle description={scope.value}>{{ default: () => '指标预估结果' }}</MxTitle>
        <div class={styles.panel} aria-live="polite">
          {renderRows()}
          {props.note && <p class={styles.note}>{props.note}</p>}
        </div>
      </div>
    );
  }
});
