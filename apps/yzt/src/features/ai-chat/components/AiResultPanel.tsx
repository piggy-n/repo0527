import { ArrowDown, ArrowUp, Download, FullScreen, ScaleToOriginal } from '@element-plus/icons-vue';
import { MxPanel, MxTitle } from '@yzt/ui';
import { ElButton, ElIcon, ElTable, ElTableColumn } from 'element-plus';
import { computed, defineComponent, type PropType } from 'vue';
import { excelDownloadUrl } from '../api';
import { type ChatChart, type ChatTable, formatCell, hasPanelContent, statsText } from '../chat-result';
import type { LatestAnswer } from '../composables/useAiChat';
import styles from './AiResultPanel.module.scss';
import { ResultChart } from './ResultChart';

// 列名较长时加宽（沿用旧项目）
const columnWidth = (column: string) => (column.length > 6 ? 150 : 110);

function renderChart(chart: ChatChart) {
  return (
    <section class={styles.block}>
      <MxTitle class={styles.blockTitle}>{chart.title || '图表数据'}</MxTitle>
      <ResultChart chart={chart} />
    </section>
  );
}

/** AI 查询结果：标题栏显示用量和下载入口；有图表或表格时可以展开、最大化，地图结果画在页面的地图上 */
export const AiResultPanel = defineComponent({
  name: 'AiResultPanel',
  props: {
    latest: { type: Object as PropType<LatestAnswer | null>, default: null },
    expanded: { type: Boolean, required: true },
    maximized: { type: Boolean, required: true }
  },
  emits: {
    'update:expanded': (value: boolean) => typeof value === 'boolean',
    'update:maximized': (value: boolean) => typeof value === 'boolean'
  },
  setup(props, { emit }) {
    const result = computed(() => props.latest?.result ?? null);
    const description = computed(() => {
      if (!result.value) {
        return undefined;
      }
      const parts = [statsText(result.value.stats), result.value.layerTag ?? ''].filter(text => text !== '');
      return parts.length > 0 ? parts.join(' · ') : undefined;
    });
    // ElTable 要可变数组；结果换了才重新复制
    const rows = computed(() => (result.value?.table ? [...result.value.table.rows] : []));

    const toggle = () => {
      emit('update:expanded', !props.expanded);
      if (props.expanded) {
        emit('update:maximized', false);
      }
    };

    const renderActions = () => {
      const current = result.value;
      const actions = [];
      if (current?.excelUrl) {
        actions.push(
          <a class={styles.download} href={excelDownloadUrl(current.excelUrl)} target="_blank" rel="noreferrer">
            <ElIcon>
              <Download />
            </ElIcon>
            下载 Excel
          </a>
        );
      }
      if (hasPanelContent(current)) {
        if (props.expanded) {
          actions.push(
            <ElButton
              link
              icon={props.maximized ? ScaleToOriginal : FullScreen}
              onClick={() => emit('update:maximized', !props.maximized)}
            >
              {props.maximized ? '还原' : '最大化'}
            </ElButton>
          );
        }
        actions.push(
          <ElButton link icon={props.expanded ? ArrowDown : ArrowUp} aria-expanded={props.expanded} onClick={toggle}>
            {props.expanded ? '收起' : '展开'}
          </ElButton>
        );
      }
      return actions;
    };

    const renderTable = (table: ChatTable) => (
      <section class={styles.block}>
        <MxTitle class={styles.blockTitle}>
          {{
            default: () => '表格数据',
            extra: () => [<span class={styles.count}>{table.rows.length} 条</span>]
          }}
        </MxTitle>
        <ElTable class={styles.table} data={rows.value} height="100%">
          {table.columns.map(column => (
            <ElTableColumn key={column} prop={column} label={column} minWidth={columnWidth(column)} showOverflowTooltip>
              {{
                // 空值什么都不渲染，由表格的全局样式显示"-"
                default: ({ row }: { row: Readonly<Record<string, unknown>> }) => {
                  const text = formatCell(row[column]);
                  return text === '' ? [] : [text];
                }
              }}
            </ElTableColumn>
          ))}
        </ElTable>
      </section>
    );

    const renderBody = () => {
      const current = result.value;
      if (!props.expanded || !current || !hasPanelContent(current)) {
        return [];
      }
      const both = current.chart !== null && current.table !== null;
      return [
        <div class={[styles.body, both && styles.both]}>
          {current.chart && renderChart(current.chart)}
          {current.table && renderTable(current.table)}
        </div>
      ];
    };

    return () => (
      <MxPanel headerTone="muted" flush title="AI 查询结果" description={description.value}>
        {{ actions: renderActions, default: renderBody }}
      </MxPanel>
    );
  }
});
