import { ElMessage } from 'element-plus';
import { defineComponent } from 'vue';
import { MessageCenterView } from '@/features/message-center/components/MessageCenterView';
import {
  DevMessageCenterPage,
  type MessagePreviewHeader
} from '@/pages/dev/message-center/DevMessageCenterPage';
import { AppHeader, type HeaderActions } from '../layout/components/AppHeader';

/** 由 app 装配真实 Header，开发页只通过插槽提供演示铃铛 */
export const MessageCenterPreview = defineComponent({
  name: 'MessageCenterPreview',
  setup() {
    return () => (
      <DevMessageCenterPage>
        {{
          header: ({ model }: MessagePreviewHeader) => (
            <AppHeader>
              {{
                actions: ({ headerBottom }: HeaderActions) => (
                  <MessageCenterView
                    model={model}
                    headerBottom={headerBottom}
                    navigate={async target => {
                      ElMessage.info(target.kind === 'reports' ? '演示：进入统计报表' : '演示：进入相关申请');
                      return true;
                    }}
                  />
                )
              }}
            </AppHeader>
          )
        }}
      </DevMessageCenterPage>
    );
  }
});
