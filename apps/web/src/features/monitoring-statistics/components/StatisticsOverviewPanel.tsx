import { RefreshRight, WarningFilled } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElIcon } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { StatisticsOverview } from '../composables/useStatisticsOverview';
import type { ReportCriteria } from '../report';
import {
  AREA_LEVELS,
  BASE_YEAR_KINDS,
  BASE_YEAR_LABELS,
  type BaseYears,
  levelLabel,
  type OverviewCell,
  type OverviewRow,
  type TableLevel
} from '../statistics';
import styles from './StatisticsOverviewPanel.module.scss';

// 变化类报表的状态按哪个本底年份：两个相同时写一个
const baseYearsText = (baseYears: BaseYears) =>
  baseYears.change === baseYears.water
    ? `变化类报表按本底 ${baseYears.change} 年`
    : BASE_YEAR_KINDS.map(kind => `${BASE_YEAR_LABELS[kind]} ${baseYears[kind]} 年`).join(' · ');

/**
 * 报表统计计算总览：行是报表，列是四个等级，水路网报表的区县级占区级、县级两列；点有状态的格子切过去查看，
 * 当前查看的格子描边。标题下写变化类报表按哪个本底年份
 */
export const StatisticsOverviewPanel = defineComponent({
  name: 'StatisticsOverviewPanel',
  props: {
    overview: { type: Object as PropType<StatisticsOverview>, required: true },
    criteria: { type: Object as PropType<ReportCriteria>, required: true },
    baseYears: { type: Object as PropType<BaseYears>, required: true }
  },
  emits: {
    select: (target: TableLevel) => typeof target === 'object'
  },
  setup(props, { emit }) {
    const renderCell = (row: OverviewRow, cell: OverviewCell) => {
      if (cell.kind === 'unsupported') {
        return <span class={[styles.chip, styles.none]}>/</span>;
      }
      const current = props.criteria.table === row.table && props.criteria.level === cell.level;
      const chip = (
        <button
          type="button"
          class={[styles.chip, styles.action, styles[cell.kind], current && styles.current]}
          aria-pressed={current}
          aria-label={cell.merged ? `${levelLabel(cell.level, row.table)}：${cell.text}` : undefined}
          onClick={() => emit('select', { table: row.table, level: cell.level })}
        >
          {cell.text}
        </button>
      );
      return cell.merged ? (
        <span class={styles.merged}>
          <span class={styles.mergedLabel}>{levelLabel(cell.level, row.table)}</span>
          {chip}
        </span>
      ) : (
        chip
      );
    };

    return () => {
      const { overview } = props;
      const error = overview.error.value;
      return (
        <MxPanel title={`${props.criteria.year}年报表统计计算总览`} description={baseYearsText(props.baseYears)}>
          {{
            actions: () => [
              overview.loading.value ? (
                <span class={styles.meta}>正在刷新...</span>
              ) : (
                overview.updatedAt.value !== null && <span class={styles.meta}>{overview.updatedAt.value} 更新</span>
              ),
              <ElButton icon={RefreshRight} onClick={overview.refresh}>
                {error === null ? '刷新' : '重试'}
              </ElButton>
            ],
            default: () =>
              error === null ? (
                <div class={styles.scroll}>
                  <table class={styles.matrix}>
                    <thead>
                      <tr>
                        <th scope="col">报表类型</th>
                        {AREA_LEVELS.map(level => (
                          <th key={level.id} scope="col">
                            {level.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overview.rows.value.map(row => (
                        <tr key={row.table}>
                          <th scope="row" title={row.name}>
                            {row.name}
                          </th>
                          {row.cells.map(cell => (
                            <td key={cell.level} colspan={cell.kind !== 'unsupported' && cell.merged ? 2 : undefined}>
                              {renderCell(row, cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class={styles.error}>
                  <ElIcon>
                    <WarningFilled />
                  </ElIcon>
                  {error}
                </div>
              )
          }}
        </MxPanel>
      );
    };
  }
});
