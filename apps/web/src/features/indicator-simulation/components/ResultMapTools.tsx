import { Back } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import type { SimulationResult } from '../composables/useSimulationResult';
import { serviceMeters, type SimulationConditions } from '../model/params';
import { simulationIndicator } from '../model/indicators';
import { FACILITY_COLOR } from '../map/colors';
import styles from './ResultMapTools.module.scss';

const pick = <T,>(options: readonly T[], value: unknown): T | undefined => options.find(option => option === value);

/** 结果地图左下的一张卡片：年度切换（多年度时）和图例；放大到一个市时左上是"返回计算范围" */
export const ResultMapTools = defineComponent({
  name: 'ResultMapTools',
  props: {
    result: { type: Object as PropType<SimulationResult>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true }
  },
  setup(props) {
    // 镜头定位时避开（ADR 0029）
    const legend = ref<HTMLElement>();
    const back = ref<HTMLElement>();
    useMapOverlay(legend, 'left');
    useMapOverlay(back, 'top');

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
      const meters = serviceMeters(selection.indicatorId, version.params);
      return (
        <div class={styles.root}>
          {selection.cityCode !== null && (
            <div key="back" ref={back} class={styles.back}>
              <ElButton icon={Back} onClick={() => result.select({ cityCode: null })}>
                返回计算范围
              </ElButton>
            </div>
          )}
          <div ref={legend} class={styles.card}>
            {years.length > 1 && (
              <div key="tools" class={styles.tools}>
                <ElRadioGroup
                  size="small"
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
              </div>
            )}
            <div key="legend" class={styles.legend} aria-label="图例">
              <div class={styles.title}>{coloring.legend.title}</div>
              <div class={styles.subtitle}>{coloring.legend.subtitle}</div>
              {coloring.legend.entries.map(entry => (
                <div key={entry.text} class={styles.row}>
                  <span class={styles.block} style={{ background: entry.color }} />
                  {entry.text}
                </div>
              ))}
              <div class={[styles.row, styles.gap]}>
                <span class={styles.dot} style={{ background: FACILITY_COLOR }} />
                {indicator.facility}
              </div>
              {meters !== null && (
                <div class={styles.row}>
                  <span class={styles.ring} />
                  服务范围 {meters} 米
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };
  }
});
