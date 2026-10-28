import { RefreshRight, WarningFilled } from '@element-plus/icons-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton, ElIcon } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { StatisticsOverview } from '../composables/useStatisticsOverview';
import type { ReportCriteria } from '../report';
import { AREA_LEVELS, type OverviewCell, type OverviewRow, type TableLevel } from '../statistics';
import styles from './StatisticsOverviewPanel.module.scss';

/** 报表统计计算总览：行是报表，列是四个等级；点有状态的格子切过去查看，当前查看的格子描边 */
export const StatisticsOverviewPanel = defineComponent({
  name: 'StatisticsOverviewPanel',
  props: {
    overview: { type: Object as PropType<StatisticsOverview>, required: true },
    criteria: { type: Object as PropType<ReportCriteria>, required: true }
  },
  emits: {
    select: (target: TableLevel) => typeof target === 'object'
  },
  setup(props, { emit }) {
    const renderCell = (row: OverviewRow, cell: OverviewCell) => {
      if (cell.kind === 'unsupported') {
        return <span class={[styles.chip, styles.none]}>/</span>;
      }
      if (cell.kind === 'disabled') {
        return <span class={[styles.chip, styles.off]}>暂未开放</span>;
      }
      const current = props.criteria.table === row.table && props.criteria.level === cell.level;
      return (
        <button
          type="button"
          class={[styles.chip, styles.action, styles[cell.kind], current && styles.current]}
          aria-pressed={current}
          onClick={() => emit('select', { table: row.table, level: cell.level })}
        >
          {cell.text}
        </button>
      );
    };

    return () => {
      const { overview } = props;
      const error = overview.error.value;
      return (
        <MxPanel title={`${props.criteria.year}年报表统计计算总览`}>
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
                        <tr key={row.table} class={row.disabled && styles.disabledRow}>
                          <th scope="row" title={row.name}>
                            {row.name}
                          </th>
                          {row.cells.map(cell => (
                            <td key={cell.level}>{renderCell(row, cell)}</td>
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
