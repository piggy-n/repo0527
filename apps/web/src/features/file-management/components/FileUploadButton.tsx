import { Upload } from '@element-plus/icons-vue';
import { ElButton, ElMessage } from 'element-plus';
import { defineComponent, onScopeDispose } from 'vue';
import { useSessionStore } from '@/shared/auth/session-store';
import { useFileUpload } from '../composables/useFileUpload';
import { FileUploadDialog } from './FileUploadDialog';

/** 上传入口持有整批任务，关窗后仍可查看进度 */
export const FileUploadButton = defineComponent({
  name: 'FileUploadButton',
  props: { categoryId: { type: String, required: true } },
  setup(props) {
    const upload = useFileUpload();
    const session = useSessionStore();
    let disposed = false;
    onScopeDispose(() => { disposed = true; });
    const submit = async () => {
      const sentSession = session.session;
      const success = await upload.submit();
      // UI 又经过一次等待，提示前再次确认页面和会话有效
      if (disposed || session.session !== sentSession || !session.isActive()) {
        return;
      }
      if (!upload.visible.value) {
        if (success) {
          ElMessage.success('上传成功');
        } else if (upload.phase.value === 'error') {
          ElMessage.error(`${upload.failure.value}，请先核对列表再决定是否重试`);
        }
      }
    };

    return () => <>
      <ElButton type="primary" icon={Upload} onClick={() => upload.open(props.categoryId)}>
        {upload.busy.value ? '查看上传进度' : '上传文档'}
      </ElButton>
      <FileUploadDialog model={upload} onSubmit={() => void submit()} />
    </>;
  }
});
