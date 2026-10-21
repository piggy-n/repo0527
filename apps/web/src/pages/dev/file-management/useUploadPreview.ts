import { onScopeDispose, ref } from 'vue';
import { useFileUploadForm } from '@/features/file-management/composables/useFileUploadForm';

export type PreviewResult = 'success' | 'error' | 'processing' | 'unknown';

/** 原型只演示界面状态，不读取文件内容、不发业务请求 */
export function useUploadPreview(completed: (files: File[], fields: { year: string; tag: string }) => void) {
  const form = useFileUploadForm();
  const { fields, files, phase, progress } = form;
  const result = ref<PreviewResult>('success');
  let submitted: { files: File[]; year: string; tag: string } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { clearInterval(timer); timer = undefined; };

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
    let percent = 0;
    progress.value = null;
    // 仅供原型观察，不用于正式上传；真实实现使用公共层的字节进度
    timer = setInterval(() => {
      if (phase.value === 'processing') {
        stop();
        if (result.value !== 'processing') {
          finish();
        }
        return;
      }
      percent = Math.min(100, percent + 20);
      progress.value = { loaded: percent, total: result.value === 'unknown' ? null : 100,
        percent: result.value === 'unknown' ? null : percent };
      if (percent === 100) {
        phase.value = 'processing';
      }
    }, 500);
  }

  onScopeDispose(stop);
  return { ...form, result, finish, submit };
}
