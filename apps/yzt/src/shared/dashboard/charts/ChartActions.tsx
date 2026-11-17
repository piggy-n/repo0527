import { defineComponent, type PropType } from 'vue';
import { SvgIcon, type IconName } from '../../icons/SvgIcon';
import type { ChartPreference, ChartType } from '../model';
import styles from './charts.module.scss';

/** 按钮只改一项偏好：均值线开关或图表类型 */
export type ChartActionPatch = { readonly showAverage: boolean } | { readonly type: ChartType };

const TYPE_NAMES: Record<ChartType, string> = { bar: '柱状', line: '折线', radar: '雷达' };
const TYPE_ICONS: Record<ChartType, IconName> = {
  bar: 'dashboard-bar',
  line: 'dashboard-line',
  radar: 'dashboard-radar'
};

/** 卡片和详情右上角的操作：均值线、图表类型、放大、下载；状态由调用方给出 */
export const ChartActions = defineComponent({
  name: 'DashboardChartActions',
  props: {
    /** 读屏文字的前缀，如指标名或"详情图" */
    prefix: { type: String, required: true },
    types: { type: Array as PropType<readonly ChartType[]>, default: () => ['bar', 'line'] },
    /** 显示中的偏好；均值线画不出来时（如堆叠）调用方把 showAverage 传成 false */
    preference: { type: Object as PropType<ChartPreference<ChartType>>, required: true },
    averageDisabled: { type: Boolean, default: false },
    averageTitle: { type: String, default: '显示或隐藏均值线' },
    downloadDisabled: { type: Boolean, default: false },
    /** 有它才显示放大按钮 */
    expandLabel: { type: String, default: undefined },
    downloadLabel: { type: String, required: true }
  },
  emits: {
    preference: (_patch: ChartActionPatch) => true,
    expand: () => true,
    download: () => true
  },
  setup(props, { emit }) {
    // 两种类型时是一个切换按钮，图标显示切换后的类型，与原驾驶舱一致
    function renderToggle(current: ChartType) {
      const next = props.types.find(type => type !== current) ?? current;
      return (
        <button
          type="button"
          class={[styles.iconButton, current === 'line' && styles.lineType]}
          aria-label={`${props.prefix}切换为${TYPE_NAMES[next]}图`}
          title={`切换为${TYPE_NAMES[next]}图`}
          onClick={() => emit('preference', { type: next })}
        >
          <SvgIcon name={TYPE_ICONS[next]} />
        </button>
      );
    }

    // 三种以上时是互斥的一组按钮
    function renderChoices(current: ChartType) {
      return (
        <div class={styles.typeGroup} role="group" aria-label={`${props.prefix}图表类型`}>
          {props.types.map(type => (
            <button
              key={type}
              type="button"
              class={[styles.iconButton, type === current && styles.typeActive]}
              aria-label={`${props.prefix}显示为${TYPE_NAMES[type]}图`}
              aria-pressed={type === current}
              title={`${TYPE_NAMES[type]}图`}
              onClick={() => {
                if (type !== current) {
                  emit('preference', { type });
                }
              }}
            >
              <SvgIcon name={TYPE_ICONS[type]} />
            </button>
          ))}
        </div>
      );
    }

    return () => {
      const { preference } = props;
      return (
        <div class={styles.actions}>
          <button
            type="button"
            class={[styles.iconButton, preference.showAverage && styles.averageActive]}
            aria-label={`${props.prefix}${preference.showAverage ? '隐藏' : '显示'}均值线`}
            aria-pressed={preference.showAverage}
            title={props.averageTitle}
            disabled={props.averageDisabled}
            onClick={() => emit('preference', { showAverage: !preference.showAverage })}
          >
            <SvgIcon name="dashboard-average" />
          </button>
          {props.types.length > 2 ? renderChoices(preference.type) : renderToggle(preference.type)}
          {props.expandLabel && (
            <button
              type="button"
              class={styles.iconButton}
              aria-label={props.expandLabel}
              title="放大图表"
              onClick={() => emit('expand')}
            >
              <SvgIcon name="dashboard-expand" />
            </button>
          )}
          <button
            type="button"
            class={styles.iconButton}
            aria-label={props.downloadLabel}
            title="下载图片"
            disabled={props.downloadDisabled}
            onClick={() => emit('download')}
          >
            <SvgIcon name="dashboard-download" />
          </button>
        </div>
      );
    };
  }
});
