import { useMap, useMapOverlay } from '@yzt/map-vue';
import { ElTooltip } from 'element-plus';
import { defineComponent, type PropType, ref, type VNode } from 'vue';
import { SvgIcon } from '../../icons/SvgIcon';
import {
  isToolbarTool,
  buttonLines,
  TOOLBAR_ACTIONS,
  TOOLBAR_TOOLS,
  type ToolbarActionId,
  type ToolbarItemId
} from './toolbar-items';
import styles from './MapToolbar.module.scss';

/**
 * 地图的业务组（ADR 0053 第 2 节）：竖排，按页面给出的分组显示按钮，组之间有分隔线；图标在上，文字每行两个字。
 * 工具按钮读当前工具、点击时激活或退出；动作按钮调用页面传入的回调。贴在右边、会挡住定位，登记为悬浮元素（第 9 节）；
 * 放在 provideMap 所在组件的子孙里
 */
export const MapToolbar = defineComponent({
  name: 'MapToolbar',
  props: {
    /** 按钮的分组，组之间画分隔线 */
    groups: { type: Array as PropType<readonly (readonly ToolbarItemId[])[]>, required: true },
    /** 动作的回调；没有给出的动作按钮不可用 */
    actions: {
      type: Object as PropType<Partial<Readonly<Record<ToolbarActionId, () => void>>>>,
      default: () => ({})
    },
    /** 显示为按下的动作，如打开着面板的"区划定位"；工具栏自己不保存开关 */
    pressed: { type: Array as PropType<readonly ToolbarActionId[]>, default: () => [] },
    /** 只显示图标，悬停提示名称；现状底图始终启用（ADR 0066） */
    compact: { type: Boolean, default: false },
    /** 矮屏下图标分成两列，和下方地图控制栏错开 */
    columns: { type: Boolean, default: false }
  },
  setup(props) {
    const map = useMap();
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');

    const renderButton = (id: ToolbarItemId): VNode => {
      const tool = isToolbarTool(id);
      const item = tool ? TOOLBAR_TOOLS[id] : TOOLBAR_ACTIONS[id];
      const { label, icon } = item;
      const active = tool && map.activeTool.value === id;
      const pressed = !tool && props.pressed.includes(id);
      const run = tool ? undefined : props.actions[id];
      const onClick = () => {
        if (!tool) {
          run?.();
        } else if (active) {
          map.releaseTool(id);
        } else {
          map.activateTool(id);
        }
      };
      const button = (
        <button
          key={id}
          type="button"
          class={[styles.button, active && styles.active, pressed && styles.pressed]}
          aria-label={label}
          aria-pressed={active || pressed}
          disabled={!tool && !run}
          onClick={onClick}>
          <SvgIcon name={icon} size={20} />
          {!props.compact && (
            <span class={styles.label}>
              {buttonLines(item).map((line, index) => [index > 0 && <br />, line])}
            </span>
          )}
        </button>
      );
      return props.compact ? (
        <ElTooltip key={id} content={label} placement="left">
          {button}
        </ElTooltip>
      ) : (
        button
      );
    };

    return () => (
      <div
        ref={element}
        class={[styles.toolbar, props.compact && styles.compact, props.columns && styles.columns]}
        role="toolbar"
        aria-orientation="vertical">
        {props.groups.map((group, index) => [
          index > 0 && <div key={`separator-${index}`} class={styles.separator} role="separator" />,
          ...group.map(renderButton)
        ])}
      </div>
    );
  }
});
