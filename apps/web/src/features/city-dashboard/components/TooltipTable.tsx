import { defineComponent, type PropType } from 'vue';
import type { ChartType, City, Comparison, Indicator } from '../model';
import { yearColor } from '../charts/colors';
import { formatValue } from '../calculations';
import styles from './DashboardCharts.module.scss';

/** Vue 文本节点显示外部名称，避免拼接 HTML 带来的注入风险 */
export const TooltipTable = defineComponent({
  name: 'DashboardTooltipTable',
  props: {
    indicator: { type: Object as PropType<Indicator>, required: true },
    comparison: { type: Array as PropType<readonly Comparison[]>, required: true },
    cities: { type: Array as PropType<readonly City[]>, required: true },
    city: { type: Object as PropType<City>, required: true },
    activeYear: { type: Number as PropType<number | null>, default: null },
    chartType: { type: String as PropType<ChartType>, default: 'bar' },
    legend: { type: Object as PropType<Readonly<Record<string, boolean>>>, required: true }
  },
  setup(props) {
    return () => {
      const index = props.cities.findIndex(city => city.code === props.city.code);
      const rows = props.comparison.filter(item => props.legend[String(item.year)] ?? true).toReversed();
      const current = props.comparison.find(item => item.year === props.activeYear);
      // 均值至少保留一位小数，整数指标的均值也能看出差别
      const averagePrecision = Math.max(1, props.indicator.precision);
      let emptyMessage = '';
      if (index < 0) {
        emptyMessage = '该城市未纳入当前筛选';
      } else if (!rows.length) {
        emptyMessage = '暂无可见年份，请检查年份选择与图例';
      }
      return (
        <div class={styles.tooltip} role="status">
          <div class={styles.tooltipCity}>
            <strong>{props.city.name}</strong>
            {current && index >= 0 && (
              <strong class={styles.currentValue}>
                当前 {current.year}年 · {formatValue(current.values[index], props.indicator)}
              </strong>
            )}
          </div>
          <p class={styles.tooltipIndicator}>
            {props.indicator.name}（{props.indicator.unit}）
          </p>
          {emptyMessage ? (
            <p>{emptyMessage}</p>
          ) : (
            <div class={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">年份</th>
                    <th scope="col">城市值</th>
                    <th scope="col">均值</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(item => (
                    <tr key={item.year} aria-current={item.year === props.activeYear ? 'true' : undefined}>
                      <th scope="row">
                        <i aria-hidden="true" style={{ background: yearColor(item.year, props.chartType) }} />
                        {item.year}
                        {item.year === props.activeYear && <small class={styles.currentYear}>当前</small>}
                      </th>
                      <td>{formatValue(item.values[index], props.indicator, false)}</td>
                      <td>{formatValue(item.average, props.indicator, false, averagePrecision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    };
  }
});
