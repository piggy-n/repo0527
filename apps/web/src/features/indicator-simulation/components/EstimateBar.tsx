import { ArrowDown, ArrowUp } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElRadioButton, ElRadioGroup } from 'element-plus';
import { computed, defineComponent, type PropType, ref } from 'vue';
import { estimate, type EstimatePass } from '../compose/estimate';
import type { SimulationModel } from '../composables/useSimulationModel';
import { formatDelta, formatValue } from '../format';
import type { SimulationConditions, SimulationParams } from '../model/params';
import styles from './EstimateBar.module.scss';

// 最多列出几项指标
const ROWS = 4;
// 变化小于这个值算不变
const FLAT = 0.005;

const PASS_LABELS = { pass: '达标', near: '接近达标', fail: '未达标' } as const;

const renderPass = (pass: EstimatePass) =>
  pass.kind === 'single' ? (
    <span class={[styles.badge, styles[pass.state]]}>{PASS_LABELS[pass.state]}</span>
  ) : (
    <span>
      预估达标 {pass.count}/{pass.total} 市
    </span>
  );

/**
 * 编排图下方的指标预估：这组参数（参数弹窗打开时是草稿）下的值、相对标准口径的变化、目标与达标；上升红色、下降绿色。
 * 选了几个年度时可以切换，默认最新一年
 */
export const EstimateBar = defineComponent({
  name: 'EstimateBar',
  props: {
    model: { type: Object as PropType<SimulationModel>, required: true },
    conditions: { type: Object as PropType<SimulationConditions>, required: true },
    params: { type: Object as PropType<SimulationParams>, required: true },
    /** 参数弹窗的草稿：标出"参数预览中" */
    previewing: Boolean
  },
  setup(props) {
    const collapsed = ref(false);
    // 用户切到的年度；不在条件里（换了年度）时按最新一年
    const year = ref<number | null>(null);
    const result = computed(() =>
      props.model.status === 'ready'
        ? estimate(props.model.calculator, props.conditions, props.params, year.value ?? undefined)
        : null
    );
    const years = computed(() => props.conditions.years.toSorted((a, b) => a - b));

    const renderRows = () => {
      const { model, conditions } = props;
      if (model.status === 'loading') {
        return <p class={styles.status}>区县数据加载中，稍后显示预估</p>;
      }
      if (model.status === 'failed') {
        return <p class={styles.status}>区县数据加载失败，无法预估</p>;
      }
      const current = result.value;
      if (!current) {
        return <p class={styles.status}>选好年份、范围和指标后显示预估</p>;
      }
      const more = conditions.indicatorIds.length - ROWS;
      return (
        <div class={styles.rows}>
          {current.rows.slice(0, ROWS).map(row => {
            const { indicator, value, standard, target } = row;
            const delta = standard === null ? 0 : value - standard;
            const tone = Math.abs(delta) < FLAT ? 'flat' : delta > 0 ? 'up' : 'down';
            return (
              <div key={indicator.id} class={styles.card}>
                <div class={styles.head}>
                  <span class={styles.name} title={indicator.name}>
                    {indicator.name}
                  </span>
                  <span class={styles.code}>{indicator.id}</span>
                </div>
                <div class={styles.value}>
                  <b>{formatValue(value, indicator)}</b>
                  {standard === null ? (
                    <span>标准口径</span>
                  ) : (
                    <>
                      <span class={styles[tone]}>较标准口径 {tone === 'flat' ? '不变' : formatDelta(delta, indicator)}</span>
                      <span class={styles.scenario}>自定义口径</span>
                    </>
                  )}
                </div>
                <div class={styles.target}>
                  <span>目标 ≥ {formatValue(target, indicator)}</span>
                  <span>较目标 {formatDelta(value - target, indicator)}</span>
                  {renderPass(row.pass)}
                </div>
              </div>
            );
          })}
          {more > 0 && <p class={styles.status}>另有 {more} 项指标，开始计算后查看</p>}
        </div>
      );
    };

    // 一个年度时写在标题后面，几个年度时由右边的切换显示
    const description = () => {
      const current = result.value;
      if (!current) {
        return undefined;
      }
      return years.value.length > 1 ? current.scope : `${current.scope} · ${current.year} 年`;
    };

    return () => (
      <section class={styles.root} aria-label="指标预估结果">
        <div class={styles.header}>
          <MxTitle description={description()}>{{ default: () => '指标预估结果' }}</MxTitle>
          {years.value.length > 1 && result.value && (
            <ElRadioGroup
              size="small"
              modelValue={result.value.year}
              aria-label="预估的年度"
              onUpdate:modelValue={value => {
                if (typeof value === 'number') {
                  year.value = value;
                }
              }}
            >
              {years.value.map(item => (
                <ElRadioButton key={item} value={item}>
                  {item}
                </ElRadioButton>
              ))}
            </ElRadioGroup>
          )}
          {props.previewing && <span class={styles.previewing}>参数预览中</span>}
          <ElButton
            class={styles.toggle}
            link
            icon={collapsed.value ? ArrowUp : ArrowDown}
            aria-label={collapsed.value ? '展开指标预估结果' : '收起指标预估结果'}
            aria-expanded={!collapsed.value}
            onClick={() => (collapsed.value = !collapsed.value)}
          />
        </div>
        {!collapsed.value && <div aria-live="polite">{renderRows()}</div>}
      </section>
    );
  }
});
