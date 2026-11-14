import { ElTooltip } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { type IconName, SvgIcon } from '@/shared/icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '@/shared/map/tooltip';
import type { ResourceStatus, ResourceStatusLevel } from '../resource-status';
import styles from './ResourceStatusIcon.module.scss';

// 状态图标（ADR 0059）：错误是实心圆、警告是实心三角、说明是放大镜，颜色由样式按级别给
const STATUS_ICONS = {
  error: 'status-error',
  warning: 'status-warning',
  info: 'status-zoom'
} as const satisfies Record<ResourceStatusLevel, IconName>;

/** 资源的状态图标（ADR 0059）：只显示最严重的那个，悬停时按严重程度列出全部，每条前面一个同色的小圆点；没有状态时不显示 */
export const ResourceStatusIcon = defineComponent({
  name: 'ResourceStatusIcon',
  props: {
    statuses: { type: Array as PropType<readonly ResourceStatus[]>, required: true }
  },
  setup(props) {
    return () => {
      const [top] = props.statuses;
      if (!top) {
        return null;
      }
      return (
        <ElTooltip {...MAP_TOOLTIP_PROPS} placement="top">
          {{
            default: () => (
              <span
                class={[styles.icon, styles[top.level]]}
                tabindex={0}
                role="img"
                aria-label={props.statuses.map(status => status.text).join('；')}
                data-status={top.kind}
              >
                <SvgIcon name={STATUS_ICONS[top.level]} size={14} />
              </span>
            ),
            content: () => (
              <ul class={styles.tipList}>
                {props.statuses.map(status => (
                  <li key={status.kind} class={styles.tipItem}>
                    <span class={[styles.dot, styles[status.level]]} />
                    {status.text}
                  </li>
                ))}
              </ul>
            )
          }}
        </ElTooltip>
      );
    };
  }
});
