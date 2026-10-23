import { MxTitle } from '@yzt/ui';
import { ElButton, ElOption, ElSelect } from 'element-plus';
import { defineComponent, type SlotsType, type VNode } from 'vue';
import type { MessageViewModel } from '@/features/message-center/components/MessageCenterView';
import { type MessageScene, useMessagePreview } from './useMessagePreview';
import styles from './preview.module.scss';

export interface MessagePreviewHeader {
  model: MessageViewModel;
}

/** Header 下的消息弹框设计预览：所有已读操作仅修改内存样例 */
export const DevMessageCenterPage = defineComponent({
  name: 'DevMessageCenterPage',
  slots: Object as SlotsType<{ header: (props: MessagePreviewHeader) => VNode[] }>,
  setup(_props, { slots }) {
    const { scene, model, reset } = useMessagePreview();

    return () => (
      <div class={styles.page}>
        {slots.header({ model })}
        <main class={styles.workspace}>
          <section class={styles.introduction}>
            <MxTitle level="panel">消息中心 · 弹框预览</MxTitle>
            <p>点击 Header 右侧铃铛，在当前页面上查看消息。</p>
            <p class={styles.hint}>固定演示数据；查看、全部已读和加载更多仅影响本次预览。</p>
            <div class={styles.previewControls}>
              <ElSelect
                aria-label="消息演示状态"
                modelValue={scene.value}
                onUpdate:modelValue={(value: MessageScene) => (scene.value = value)}
              >
                <ElOption value="normal" label="正常列表" />
                <ElOption value="empty" label="空列表" />
                <ElOption value="loading" label="加载中" />
                <ElOption value="error" label="加载失败" />
              </ElSelect>
              <ElButton onClick={reset}>重置演示</ElButton>
            </div>
          </section>
          <section class={styles.backgroundPanel}>
            <MxTitle level="panel">当前业务页面</MxTitle>
            <p class={styles.hint}>消息弹框打开时保留页面；查看通知不会切换路由。</p>
          </section>
        </main>
      </div>
    );
  }
});
