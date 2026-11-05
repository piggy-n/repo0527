import { Back } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElTooltip } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { SimulationResult } from '../composables/useSimulationResult';
import { scopeText } from '../flow/plan';
import { formatValue } from '../format';
import { simulationIndicator } from '../model/indicators';
import type { SimulationConditions } from '../model/params';
import type { Rank, RankRow, ResultItem } from '../result/result-view';
import { formatRatio } from '../scope/area-tree';
import styles from './ResultList.module.scss';

// 覆盖占比的提示：结果只算范围内的部分；市的行再写各覆盖几个区县
function coverTitle({ name, share, cover }: RankRow): string {
  const base = `${name}有 ${formatRatio(share ?? 1)} 的面积在范围内，结果只算这部分`;
  if (!cover) {
    return base;
  }
  const parts = [cover.full > 0 && `完整覆盖 ${cover.full} 个`, cover.partial > 0 && `部分覆盖 ${cover.partial} 个`];
  return `${base}；${cover.total} 个区县里，${parts.filter(Boolean).join('、')}`;
}

/**
 * 结果展示的左侧（第五版原型）：每项指标一条，写结果；选中的一条展开各市（一个市时是各区县），
 * 悬停一行时地图描出这个市，点一行放大到它。底部是整行的"调整条件"
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
    const renderRow = (row: RankRow, rank: Rank, unit: string, covering: boolean) => {
      const { result } = props;
      const content = [
        <span key="name" class={styles.rankName}>
          {row.name}
        </span>,
        // 自定义范围里有部分覆盖的行时多一列覆盖占比（ADR 0131）：部分覆盖是橙色，占满是灰色、没有提示
        covering && (
          <ElTooltip {...MAP_TOOLTIP_PROPS} key="cover" content={coverTitle(row)} placement="top" disabled={!row.partial}>
            <span class={[styles.ratio, row.partial && styles.ratioPartial]}>
              {row.share !== null && formatRatio(row.share)}
            </span>
          </ElTooltip>
        ),
        <span key="bar" class={styles.bar}>
          <i style={{ width: `${((row.value / rank.max) * 100).toFixed(1)}%` }} />
        </span>,
        <b key="value" class={styles.rankValue}>
          {formatValue(row.value, { unit })}
        </b>
      ];
      const { cityCode } = row;
      if (cityCode === null) {
        return (
          <li key={row.key} class={[styles.row, covering && styles.covering]}>
            {content}
          </li>
        );
      }
      return (
        <li key={row.key}>
          <button
            type="button"
            class={[styles.row, covering && styles.covering, result.hoverCity.value === cityCode && styles.lit]}
            aria-label={`放大到${row.name}`}
            onMouseenter={() => result.setHoverCity(cityCode)}
            onClick={() => result.select({ cityCode })}
          >
            {content}
          </button>
        </li>
      );
    };

    const renderRank = (rank: Rank, unit: string) => {
      const covering = rank.rows.some(row => row.partial);
      return (
        <div class={styles.detail}>
          {/* 有覆盖占比时和下面的行共用一套列：结果也可能是百分数，要看得出这一列是什么 */}
          <div class={[styles.rankHead, covering && styles.covering]}>
            <span>{rank.level === 'city' ? '各市' : '各区县'}</span>
            {covering && <span class={styles.rankColumn}>覆盖占比</span>}
          </div>
          <ol class={styles.rank} onMouseleave={() => props.result.setHoverCity(null)}>
            {rank.rows.map(row => renderRow(row, rank, unit, covering))}
          </ol>
        </div>
      );
    };

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
              <span class={styles.scope} title={scopeText(props.conditions.scope)}>
                {year} 年 · {scopeText(props.conditions.scope)}
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
