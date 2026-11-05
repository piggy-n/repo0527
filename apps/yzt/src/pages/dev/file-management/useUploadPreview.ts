import { onScopeDispose, ref } from 'vue';
import { useFileUploadForm } from '@/features/file-management/composables/useFileUploadForm';

export type PreviewResult = 'success' | 'error' | 'processing' | 'unknown';

// 每 500 毫秒发送 20%
const UPLOAD_TICK = 500;

/** 上传的演示：用正式的上传草稿（useFileUploadForm），按 result 模拟发送和结果；不读取文件内容、不发请求 */
export function useUploadPreview(completed: (files: File[], fields: { year: string; tag: string }) => void) {
  const form = useFileUploadForm();
  const { fields, files, phase, progress } = form;
  const result = ref<PreviewResult>('success');
  // 提交时的快照：发送中关窗会清空草稿，模拟完成时仍用这一批
  let submitted: { files: File[]; year: string; tag: string } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function stop() {
    clearInterval(timer);
    timer = undefined;
  }

  /** 结束这一批；"停在处理中"时由页面上的按钮手动结束 */
  function finish() {
    stop();
    if (result.value === 'error') {
      phase.value = 'error';
      form.failure.value = '上传未完成';
    } else {
      phase.value = 'success';
      if (submitted) {
        completed(submitted.files, submitted);
      }
    }
    submitted = undefined;
  }

  function submit() {
    if (!form.validate()) {
      return;
    }
    phase.value = 'sending';
    submitted = { files: [...files.value], year: fields.year, tag: fields.tag };
    progress.value = null;
    let percent = 0;
    const unknownTotal = result.value === 'unknown';
    timer = setInterval(() => {
      if (phase.value === 'processing') {
        stop();
        if (result.value !== 'processing') {
          finish();
        }
        return;
      }
      percent = Math.min(100, percent + 20);
      progress.value = { loaded: percent, total: unknownTotal ? null : 100, percent: unknownTotal ? null : percent };
      if (percent === 100) {
        phase.value = 'processing';
      }
    }, UPLOAD_TICK);
  }

  onScopeDispose(stop);
  return { ...form, result, finish, submit };
}
