import { defineComponent, type PropType } from 'vue';
import { JIANGSU_CITIES, shortRegionName } from '@/shared/map/region/region-catalog';
import type { SimulationVersion } from '../engine/engine';
import { simulationIndicator } from '../model/indicators';
import type { SimulationConditions } from '../model/params';
import { versionText } from '../result/result-view';
import styles from './RunOverview.module.scss';

/** 推演概览的条件：年度、范围、指标 */
export const RunConditions = defineComponent({
  name: 'RunConditions',
  props: {
    conditions: { type: Object as PropType<SimulationConditions>, required: true }
  },
  setup(props) {
    return () => {
      const { years, cityCodes, indicatorIds } = props.conditions;
      const scope =
        cityCodes.length === JIANGSU_CITIES.length
          ? `全省 ${cityCodes.length} 市`
          : cityCodes.length <= 3
            ? cityCodes.map(code => shortRegionName(JIANGSU_CITIES.find(city => city.code === code)?.name ?? code)).join('、')
            : `${cityCodes.length} 个市`;
      return (
        <div class={styles.block}>
          <div class={styles.label}>推演条件</div>
          <div class={styles.tags}>
            <span class={styles.tag}>{years.toSorted((a, b) => a - b).join('、')} 年</span>
            <span class={styles.tag}>{scope}</span>
            {indicatorIds.map(id => (
              <span key={id} class={styles.tag} title={simulationIndicator(id).name}>
                {simulationIndicator(id).short}
              </span>
            ))}
          </div>
        </div>
      );
    };
  }
});

/** 推演概览的版本：点一版查看，写出它相对所基于的版本改了什么 */
export const RunVersions = defineComponent({
  name: 'RunVersions',
  props: {
    versions: { type: Array as PropType<readonly SimulationVersion[]>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    viewing: { type: Number, required: true }
  },
  emits: {
    view: (index: number) => Number.isInteger(index)
  },
  setup(props, { emit }) {
    return () => (
      <div class={styles.block}>
        <div class={styles.label}>版本 · 点击查看</div>
        {props.versions.map(version => (
          <button
            key={version.index}
            type="button"
            class={styles.version}
            aria-pressed={version.index === props.viewing}
            onClick={() => emit('view', version.index)}
          >
            <b>{version.label}</b>
            <span title={versionText(version, props.conditions)}>{versionText(version, props.conditions)}</span>
          </button>
        ))}
      </div>
    );
  }
});
