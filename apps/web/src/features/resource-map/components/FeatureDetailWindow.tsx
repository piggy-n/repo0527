import { ArrowDown, ArrowUp, Close } from '@element-plus/icons-vue';
import { useMapOverlay } from '@yzt/map-vue';
import { MxPanel } from '@yzt/ui';
import { ElButton } from 'element-plus';
import { defineComponent, type PropType, ref } from 'vue';
import type { FeaturePick } from '../composables/useFeaturePick';
import { FeatureDetailPanel } from './FeatureDetailPanel';
import styles from './FeatureDetailWindow.module.scss';

/** 独立的查询结果外壳，收起保留内容，关闭由页面清除查询与高亮 */
export const FeatureDetailWindow = defineComponent({
  name: 'FeatureDetailWindow',
  props: {
    pick: { type: Object as PropType<FeaturePick>, required: true },
    visible: { type: Boolean, default: true },
    collapsed: { type: Boolean, default: false }
  },
  emits: {
    close: () => true,
    activate: () => true,
    'update:collapsed': (value: boolean) => typeof value === 'boolean'
  },
  setup(props, { emit }) {
    const element = ref<HTMLElement>();
    useMapOverlay(element, 'right');
    return () => (
      <div
        ref={element}
        class={[styles.window, props.collapsed && styles.collapsed]}
        style={props.visible ? undefined : { display: 'none' }}
        data-feature-detail-window
        onPointerdown={() => !props.collapsed && emit('activate')}>
        <MxPanel floating flush={props.collapsed} title="资源详情" class={styles.shell}>
          {{
            actions: () => [
              <ElButton
                link
                icon={props.collapsed ? ArrowDown : ArrowUp}
                aria-label={props.collapsed ? '展开资源详情' : '收起资源详情'}
                aria-expanded={!props.collapsed}
                onClick={() => emit('update:collapsed', !props.collapsed)}
              />,
              <ElButton link icon={Close} aria-label="关闭资源详情" onClick={() => emit('close')} />
            ],
            default: () => [
              <div class={styles.content} style={props.collapsed ? { display: 'none' } : undefined}>
                <FeatureDetailPanel pick={props.pick} />
              </div>
            ]
          }}
        </MxPanel>
      </div>
    );
  }
});
