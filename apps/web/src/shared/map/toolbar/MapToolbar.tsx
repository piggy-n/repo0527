import { ElButton } from 'element-plus';
import { useMap } from '@yzt/map-vue';
import { defineComponent, type PropType } from 'vue';
import {
  isToolbarTool,
  TOOLBAR_ACTIONS,
  TOOLBAR_TOOLS,
  type ToolbarActionId,
  type ToolbarItemId
} from './toolbar-items';
import styles from './MapToolbar.module.scss';

/**
 * 地图工具栏（联调用的外壳，5D 再设计）：按页面给出的列表显示按钮。
 * 工具按钮读当前工具、点击时激活或退出；动作按钮调用页面传入的回调。放在 provideMap 所在组件的子孙里
 */
export const MapToolbar = defineComponent({
  name: 'MapToolbar',
  props: {
    items: { type: Array as PropType<readonly ToolbarItemId[]>, required: true },
    /** 动作的回调；没有给出的动作按钮不可用 */
    actions: {
      type: Object as PropType<Partial<Readonly<Record<ToolbarActionId, () => void>>>>,
      default: () => ({})
    }
  },
  setup(props) {
    const map = useMap();

    return () => (
      <div class={styles.toolbar} role="toolbar">
        {props.items.map(id => {
          if (isToolbarTool(id)) {
            const { label, icon } = TOOLBAR_TOOLS[id];
            const active = map.activeTool.value === id;
            return (
              <ElButton
                key={id}
                type={active ? 'primary' : 'default'}
                icon={icon}
                onClick={() => (active ? map.releaseTool(id) : map.activateTool(id))}>
                {label}
              </ElButton>
            );
          }
          const { label, icon } = TOOLBAR_ACTIONS[id];
          const run = props.actions[id];
          return (
            <ElButton key={id} icon={icon} disabled={!run} onClick={() => run?.()}>
              {label}
            </ElButton>
          );
        })}
      </div>
    );
  }
});
