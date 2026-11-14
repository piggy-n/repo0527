import { ElTooltip } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import { type IconName, SvgIcon } from '../../icons/SvgIcon';
import { MAP_TOOLTIP_PROPS } from '../tooltip';
import styles from './PanelToolbar.module.scss';

/** 工具栏的一个按钮 */
export interface PanelTool {
  readonly key: string;
  readonly icon: IconName;
  readonly label: string;
  /** 悬停提示，默认是 label；不可用时写原因 */
  readonly tip?: string;
  readonly disabled?: boolean;
  /** 开着对应的浮层 */
  readonly pressed?: boolean;
}

/** 按钮，或者分组之间的竖线 */
export type PanelToolItem = PanelTool | 'divider';

/**
 * 资源图层面板两段标题右边的一排图标按钮（ADR 0157）：只显示和报告点了哪个，操作由页面交给拥有者。
 * 不可用的按钮用 aria-disabled，不用 disabled：悬停仍能看到原因
 */
export const PanelToolbar = defineComponent({
  name: 'PanelToolbar',
  props: {
    items: { type: Array as PropType<readonly PanelToolItem[]>, required: true },
    /** 工具栏的无障碍名称 */
    label: { type: String, required: true }
  },
  emits: {
    action: (key: string) => typeof key === 'string'
  },
  setup(props, { emit }) {
    const renderTool = (tool: PanelTool) => (
      <ElTooltip key={tool.key} {...MAP_TOOLTIP_PROPS} content={tool.tip ?? tool.label} placement="top">
        <button
          type="button"
          class={styles.tool}
          aria-label={tool.label}
          aria-disabled={tool.disabled === true}
          aria-pressed={tool.pressed}
          data-tool={tool.key}
          onClick={() => {
            if (!tool.disabled) {
              emit('action', tool.key);
            }
          }}
        >
          <SvgIcon name={tool.icon} size={16} />
        </button>
      </ElTooltip>
    );

    return () => (
      <div class={styles.toolbar} role="toolbar" aria-label={props.label}>
        {props.items.map((item, index) =>
          item === 'divider' ? <span key={`divider-${index}`} class={styles.divider} /> : renderTool(item)
        )}
      </div>
    );
  }
});
