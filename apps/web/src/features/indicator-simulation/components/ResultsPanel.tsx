import { usePreferredReducedMotion } from '@vueuse/core';
import { MxPanel, MxSection } from '@yzt/ui';
import { ElButton, ElOption, ElSelect } from 'element-plus';
import { computed, defineComponent, type PropType, ref, watch } from 'vue';
import { SvgIcon } from '@/shared/icons/SvgIcon';
import type { SimulationResult } from '../composables/useSimulationResult';
import type { SimulationVersion } from '../engine/engine';
import { formatDelta } from '../format';
import { indicatorResult } from '../model/analysis';
import { simulationIndicator } from '../model/indicators';
import { PARAM_LABELS, type SimulationConditions } from '../model/params';
import { citiesOption, sensitivityOption, yearsOption } from '../result/chart-options';
import { RichText } from './RichText';
import styles from './ResultsPanel.module.scss';
import { SimulationChart } from './SimulationChart';

// 选中的页签整个露出来：只滚动页签条，不用 scrollIntoView（它会连带滚动外层 overflow: hidden 的容器）
function revealSelected(list: HTMLElement): void {
  const tab = list.querySelector('[aria-selected="true"]');
  if (!tab) {
    return;
  }
  const padding = Number.parseFloat(getComputedStyle(list).paddingLeft);
  const bounds = list.getBoundingClientRect();
  const { left, right } = tab.getBoundingClientRect();
  if (left < bounds.left + padding) {
    list.scrollLeft -= bounds.left + padding - left;
  } else if (right > bounds.right - padding) {
    list.scrollLeft += right - (bounds.right - padding);
  }
}

/** 推演结果：指标页签、关键数字、AI 结论与建议情景、多年度对比、城市对比、敏感性、变化归因 */
export const ResultsPanel = defineComponent({
  name: 'ResultsPanel',
  props: {
    result: { type: Object as PropType<SimulationResult>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    versions: { type: Array as PropType<readonly SimulationVersion[]>, required: true }
  },
  emits: {
    suggest: () => true
  },
  setup(props, { emit }) {
    const motion = usePreferredReducedMotion();
    const animation = computed(() => motion.value !== 'reduce');
    const tablist = ref<HTMLElement>();
    watch(
      () => props.result.selection.value?.indicatorId,
      () => {
        if (tablist.value) {
          revealSelected(tablist.value);
        }
      },
      { flush: 'post' }
    );

    const charts = computed(() => {
      const { result, conditions } = props;
      const selection = result.selection.value;
      const version = result.version.value;
      const comparison = result.comparison.value;
      const summary = result.summary.value;
      if (!selection || !version || !comparison || !summary) {
        return null;
      }
      const { indicatorId, year } = selection;
      const indicator = simulationIndicator(indicatorId);
      const target = version.params.targets[indicatorId] ?? summary.current.target;
      const years = conditions.years.toSorted((a, b) => a - b);
      const valuesOf = (source: typeof version.result) => years.map(item => indicatorResult(source[item]?.indicators ?? {}, indicatorId).value);
      return {
        years:
          years.length > 1
            ? yearsOption(
                indicator,
                years,
                { label: version.label, values: valuesOf(version.result) },
                { label: comparison.label, values: valuesOf(comparison.result) },
                year,
                target,
                animation.value
              )
            : null,
        cities: citiesOption(
          indicator,
          summary.current.cities,
          new Map(summary.base.cities.map(city => [city.code, city.value])),
          { view: version.label, compare: comparison.label },
          target,
          animation.value
        ),
        sensitivity: sensitivityOption(indicator, summary.sensitivity, target, animation.value)
      };
    });

    return () => {
      const { result, conditions, versions } = props;
      const selection = result.selection.value;
      const version = result.version.value;
      const comparison = result.comparison.value;
      const summary = result.summary.value;
      const options = charts.value;
      if (!selection || !version || !comparison || !summary || !options) {
        return null;
      }
      const indicator = simulationIndicator(selection.indicatorId);
      const yearsChart = options.years;
      return (
        <MxPanel class={styles.panel} title="推演结果" headerTone="muted" floating flush>
          {{
            icon: () => <SvgIcon name="simulation-indicator" />,
            actions: () => (
              <label class={styles.compare}>
                对比
                <ElSelect
                  class={styles.select}
                  size="small"
                  modelValue={selection.compare}
                  aria-label="对比的版本"
                  onUpdate:modelValue={(value: number | 'default') => result.select({ compare: value })}
                >
                  <ElOption value="default" label="默认参数" />
                  {versions
                    .filter(item => item.index !== selection.viewIndex)
                    .map(item => (
                      <ElOption key={item.index} value={item.index} label={item.label} />
                    ))}
                </ElSelect>
              </label>
            ),
            default: () => (
              <div class={styles.body}>
                <div ref={tablist} class={styles.tabs} role="tablist" aria-label="指标">
                  {conditions.indicatorIds.map(id => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      class={styles.tab}
                      aria-selected={id === selection.indicatorId}
                      title={simulationIndicator(id).name}
                      onClick={() => result.select({ indicatorId: id })}
                    >
                      {simulationIndicator(id).short}
                    </button>
                  ))}
                </div>
                <div class={styles.kpis}>
                  {summary.kpis.map(kpi => (
                    <div key={kpi.label} class={styles.kpi}>
                      <div class={styles.kpiLabel}>{kpi.label}</div>
                      <div class={[styles.kpiValue, kpi.label.startsWith('较') && styles[kpi.tone]]}>
                        {kpi.value}
                        {kpi.unit !== '' && <small>{kpi.unit}</small>}
                      </div>
                      <div class={[styles.kpiDelta, styles[kpi.tone]]} title={`与${comparison.label}相比`}>
                        {kpi.delta}
                      </div>
                    </div>
                  ))}
                </div>
                <div class={styles.insight}>
                  <div class={styles.insightTitle}>
                    <SvgIcon name="simulation-ai" />
                    AI 结论
                  </div>
                  {summary.insight.map((paragraph, index) => (
                    <p key={index}>
                      <RichText text={paragraph} />
                    </p>
                  ))}
                  {summary.idea && (
                    <ElButton size="small" onClick={() => emit('suggest')}>
                      按此情景再推演
                    </ElButton>
                  )}
                </div>
                {yearsChart && (
                  <MxSection title="多年度对比">
                    {{
                      extra: () => (
                        <span class={styles.extra}>
                          全省 · {comparison.label} / {version.label}
                        </span>
                      ),
                      default: () => <SimulationChart option={yearsChart} height={150} label="多年度对比" />
                    }}
                  </MxSection>
                )}
                <MxSection title="城市对比">
                  {{
                    extra: () => (
                      <span class={styles.extra}>
                        {selection.year} 年 · {comparison.label} → {version.label}
                      </span>
                    ),
                    default: () => (
                      <SimulationChart
                        option={options.cities}
                        height={Math.max(160, summary.current.cities.length * 20 + 60)}
                        label="城市对比"
                      />
                    )
                  }}
                </MxSection>
                <MxSection title="参数敏感性">
                  {{
                    extra: () => (
                      <span class={styles.extra}>{summary.sensitivity.key === 'walkSpeed' ? '随步行速度变化' : '随规划新增变化'}</span>
                    ),
                    default: () => <SimulationChart option={options.sensitivity} height={150} label="参数敏感性" />
                  }}
                </MxSection>
                <MxSection title="变化归因">
                  {{
                    extra: () => (
                      <span class={styles.extra}>
                        {comparison.label} → {version.label}
                      </span>
                    ),
                    default: () =>
                      summary.attribution.length === 0 ? (
                        <p class={styles.empty}>两个版本的参数相同。点"人工干预"调整参数后再推演，这里会列出每项改动带来的变化。</p>
                      ) : (
                        <ul class={styles.attribution}>
                          {summary.attribution.map(item => {
                            const tone = Math.abs(item.delta) < 0.005 ? 'flat' : item.delta > 0 ? 'up' : 'down';
                            return (
                              <li key={item.key}>
                                <b>{PARAM_LABELS[item.key]}</b>
                                <span class={styles[tone]}>{item.key === 'targets' ? '数值不变' : formatDelta(item.delta, indicator)}</span>
                                <span>
                                  {item.from} → {item.to}
                                </span>
                                <span>
                                  达标 {item.passDelta >= 0 ? '+' : '−'}
                                  {Math.abs(item.passDelta)} 市
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )
                  }}
                </MxSection>
              </div>
            )
          }}
        </MxPanel>
      );
    };
  }
});
