import { Upload } from '@element-plus/icons-vue';
import { ElButton, ElMessage } from 'element-plus';
import { defineComponent } from 'vue';
import { useFileUpload } from '../composables/useFileUpload';
import { FileUploadDialog } from './FileUploadDialog';

/** 上传入口：持有这一批的上传任务，关窗后仍可点开查看进度 */
export const FileUploadButton = defineComponent({
  name: 'FileUploadButton',
  props: {
    categoryId: { type: String, required: true }
  },
  setup(props) {
    const upload = useFileUpload();

    // 窗口开着时结果显示在窗口里；关窗后在后台结束的这一批用消息提示。
    // 页面销毁、换会话后 submit 返回 false 且不进入失败，这里也就不提示
    async function submit() {
      const success = await upload.submit();
      if (upload.visible.value) {
        return;
      }
      if (success) {
        ElMessage.success('上传成功');
      } else if (upload.phase.value === 'error') {
        ElMessage.error(`${upload.failure.value}，请先核对列表再决定是否重试`);
      }
    }

    return () => (
      <>
        <ElButton type="primary" icon={Upload} onClick={() => upload.open(props.categoryId)}>
          {upload.busy.value ? '查看上传进度' : '上传文件'}
        </ElButton>
        <FileUploadDialog model={upload} onSubmit={() => void submit()} />
      </>
    );
  }
});
