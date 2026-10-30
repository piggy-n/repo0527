import { Back } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { SimulationResult } from '../composables/useSimulationResult';
import { scopeText } from '../flow/plan';
import { formatValue } from '../format';
import { simulationIndicator } from '../model/indicators';
import type { SimulationConditions } from '../model/params';
import type { Rank, RankRow, ResultItem } from '../result/result-view';
import styles from './ResultList.module.scss';

/**
 * 结果展示的左侧（第五版原型）：每项指标一条，写结果、目标和达标；选中的一条展开各市（一个市时是各区县），
 * 悬停一行时地图描出这个市，点一行放大到它；条上的竖线是目标。底部是整行的"调整条件"
 */
export const ResultList = defineComponent({
  name: 'ResultList',
  props: {
    result: { type: Object as PropType<SimulationResult>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true }
  },
  emits: {
    recompose: () => true
  },
  setup(props, { emit }) {
    const renderRow = (row: RankRow, rank: Rank, unit: string) => {
      const { result } = props;
      const content = [
        <span key="name" class={styles.rankName}>
          {row.name}
        </span>,
        <span key="bar" class={styles.bar}>
          <i class={styles[row.state]} style={{ width: `${((row.value / rank.max) * 100).toFixed(1)}%` }} />
        </span>,
        <b key="value" class={styles.rankValue}>
          {formatValue(row.value, { unit })}
        </b>
      ];
      const { cityCode } = row;
      if (cityCode === null) {
        return (
          <li key={row.key} class={styles.row}>
            {content}
          </li>
        );
      }
      return (
        <li key={row.key}>
          <button
            type="button"
            class={[styles.row, result.hoverCity.value === cityCode && styles.lit]}
            aria-label={`放大到${row.name}`}
            onMouseenter={() => result.setHoverCity(cityCode)}
            onClick={() => result.select({ cityCode })}
          >
            {content}
          </button>
        </li>
      );
    };

    const renderRank = (rank: Rank, unit: string) => (
      <div class={styles.detail}>
        <div class={styles.rankHead}>{rank.level === 'city' ? '各市' : '各区县'}</div>
        <ol
          class={styles.rank}
          style={{ '--target': `${((rank.target / rank.max) * 100).toFixed(1)}%` }}
          onMouseleave={() => props.result.setHoverCity(null)}
        >
          {rank.rows.map(row => renderRow(row, rank, unit))}
        </ol>
      </div>
    );

    const renderItem = (item: ResultItem) => {
      const { result } = props;
      const selected = result.selection.value?.indicatorId === item.id;
      const indicator = simulationIndicator(item.id);
      const rank = selected ? result.rank.value : null;
      return (
        <li key={item.id} class={[styles.item, selected && styles.selected]}>
          <button
            type="button"
            class={styles.head}
            aria-expanded={selected}
            onClick={() => result.select({ indicatorId: item.id })}
          >
            <span class={styles.name}>
              <span title={item.name}>{item.short}</span>
              {item.scenario && <span class={styles.scenario}>自定义口径</span>}
            </span>
            <b class={styles.value}>{formatValue(item.value, indicator)}</b>
            <span class={styles.meta}>
              <span>目标 ≥ {formatValue(item.target, indicator)}</span>
              <span class={[styles.verdict, styles[item.state]]}>
                <i />
                {item.verdict}
              </span>
            </span>
          </button>
          {rank && renderRank(rank, indicator.unit)}
        </li>
      );
    };

    return () => {
      const year = props.result.selection.value?.year;
      return (
        <MxPanel class={styles.panel} title="计算结果" headerTone="muted" flush>
          {{
            actions: () => (
              <span class={styles.scope}>
                {year} 年 · {scopeText(props.conditions.cityCodes)}
              </span>
            ),
            default: () => <ol class={styles.list}>{props.result.items.value.map(renderItem)}</ol>,
            footer: () => (
              <ElButton
                class={['button-xl', styles.recompose]}
                type="primary"
                icon={Back}
                onClick={() => emit('recompose')}
              >
                调整条件
              </ElButton>
            )
          }}
        </MxPanel>
      );
    };
  }
});
