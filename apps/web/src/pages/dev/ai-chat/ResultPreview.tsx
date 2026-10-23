import { MxTitle } from '@yzt/ui';
import { ElTable, ElTableColumn } from 'element-plus';
import { defineComponent } from 'vue';
import { results } from './preview-data';
import styles from './preview.module.scss';

/** 旧版结果按表格、图表纵向展示，共用外层面板的滚动区域 */
export const ResultPreview = defineComponent({
  name: 'DevAiResultPreview',
  setup() {
    return () => (
      <div class={styles.resultContent}>
        <section class={styles.resultSection}>
          <div class={styles.sectionHeader}>
            <MxTitle level="section">表格数据</MxTitle>
            <span class={styles.hint}>5 条 · 演示数据</span>
          </div>
          <ElTable data={results}>
            <ElTableColumn prop="name" label="行政区划" minWidth="110" />
            <ElTableColumn prop="area" label="耕地面积（公顷）" minWidth="160" align="right" />
          </ElTable>
        </section>
        <section class={styles.resultSection}>
          <MxTitle level="section">各市耕地面积（公顷）</MxTitle>
          <div class={styles.chart} aria-label="各市耕地面积图表">
            {results.map(row => (
              <div class={styles.barRow} key={row.name}>
                <span>{row.name}</span>
                <span class={styles.barTrack}>
                  <span class={styles.bar} style={{ width: `${row.area / 550000 * 100}%` }} />
                </span>
                <span>{row.area.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }
});
