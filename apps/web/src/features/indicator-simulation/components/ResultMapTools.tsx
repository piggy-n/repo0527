import { ElRadioButton, ElRadioGroup } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { SimulationResult } from '../composables/useSimulationResult';
import { inScenario, type SimulationConditions } from '../model/params';
import { reachMeters, simulationIndicator } from '../model/indicators';
import { FACILITY_COLOR, PLANNED_COLOR } from '../map/colors';
import type { MapMode } from '../result/result-view';
import styles from './ResultMapTools.module.scss';

const MODES: readonly { readonly value: MapMode; readonly label: string }[] = [
  { value: 'value', label: '数值' },
  { value: 'pass', label: '达标' },
  { value: 'diff', label: '差值' }
];

const pick = <T,>(options: readonly T[], value: unknown): T | undefined => options.find(option => option === value);

/** 结果地图的着色、年度切换和图例 */
export const ResultMapTools = defineComponent({
  name: 'ResultMapTools',
  props: {
    result: { type: Object as PropType<SimulationResult>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true }
  },
  setup(props) {
    return () => {
      const { result, conditions } = props;
      const selection = result.selection.value;
      const coloring = result.coloring.value;
      const version = result.version.value;
      if (!selection || !coloring || !version) {
        return null;
      }
      const years = conditions.years.toSorted((a, b) => a - b);
      const indicator = simulationIndicator(selection.indicatorId);
      const meters = reachMeters(indicator, version.params.walkSpeed);
      const planned = version.params.newFacilities > 0 && inScenario(version.params, selection.indicatorId);
      const { legend } = coloring;
      return (
        <div class={styles.root}>
          <div class={styles.tools}>
            <ElRadioGroup
              modelValue={selection.mode}
              aria-label="地图着色"
              onUpdate:modelValue={value => {
                const mode = pick(MODES.map(item => item.value), value);
                if (mode) {
                  result.select({ mode });
                }
              }}
            >
              {MODES.map(mode => (
                <ElRadioButton key={mode.value} value={mode.value}>
                  {mode.label}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
            {years.length > 1 && (
              <ElRadioGroup
                modelValue={selection.year}
                aria-label="年度"
                onUpdate:modelValue={value => {
                  const year = pick(years, value);
                  if (year !== undefined) {
                    result.select({ year });
                  }
                }}
              >
                {years.map(year => (
                  <ElRadioButton key={year} value={year}>
                    {year}
                  </ElRadioButton>
                ))}
              </ElRadioGroup>
            )}
          </div>
          <div class={styles.legend} aria-label="图例">
            <div class={styles.title}>{legend.title}</div>
            {legend.entries.map(entry => (
              <div key={entry.text} class={styles.row}>
                <span class={styles.block} style={{ background: entry.color }} />
                {entry.text}
              </div>
            ))}
            {legend.note !== null && <div class={styles.note}>{legend.note}</div>}
            <div class={[styles.row, styles.gap]}>
              <span class={styles.dot} style={{ background: FACILITY_COLOR }} />
              {indicator.facility}
            </div>
            {planned && (
              <div class={styles.row}>
                <span class={styles.dot} style={{ background: PLANNED_COLOR }} />
                规划新增 {version.params.newFacilities}%
              </div>
            )}
            {meters !== null && (
              <>
                <div class={styles.row}>
                  <span class={styles.ring} />
                  服务圈 {meters} 米
                </div>
                <div class={styles.note}>放大到区县查看设施与服务圈</div>
              </>
            )}
          </div>
        </div>
      );
    };
  }
});
