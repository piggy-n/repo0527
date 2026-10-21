import { computed, onScopeDispose, reactive, ref, shallowRef } from 'vue';
import { DEFAULT_CATEGORY_ID, findCategoryPath } from '@/features/file-management/categories';

export type PreviewPhase = 'draft' | 'sending' | 'processing' | 'success' | 'error';
export type PreviewResult = 'success' | 'error' | 'processing' | 'unknown';

/** 原型只演示界面状态，不读取文件内容、不发业务请求 */
export function useUploadPreview(completed: (files: File[], fields: { year: string; tag: string }) => void) {
  const visible = ref(false);
  const fields = reactive({
    categoryId: DEFAULT_CATEGORY_ID, year: String(new Date().getFullYear()), tag: '', remark: ''
  });
  const files = shallowRef<File[]>([]);
  const phase = ref<PreviewPhase>('draft');
  const result = ref<PreviewResult>('success');
  const percent = ref(0);
  const attempted = ref(false);
  const busy = computed(() => phase.value === 'sending' || phase.value === 'processing');
  const locked = computed(() => busy.value || phase.value === 'success');
  const errors = computed(() => ({
    categoryId: !findCategoryPath(fields.categoryId).length || findCategoryPath(fields.categoryId).at(-1)?.children
      ? '请选择具体分类' : '',
    year: !/^\d{4}$/.test(fields.year) || Number(fields.year) > new Date().getFullYear() ? '请选择有效年份' : '',
    tag: fields.tag ? '' : '请选择业务类型标签',
    files: files.value.length ? '' : '请至少选择一个文件'
  }));
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { clearInterval(timer); timer = undefined; };

  function open(categoryId: string) {
    if (!files.value.length && phase.value === 'draft') {
      fields.categoryId = categoryId;
    }
    visible.value = true;
  }

  function addFiles(selected: File[]) {
    if (locked.value) {
      return;
    }
    files.value = [...files.value, ...selected];
    phase.value = 'draft';
  }

  function reset() {
    if (busy.value) {
      return;
    }
    files.value = [];
    fields.remark = '';
    phase.value = 'draft';
    attempted.value = false;
    percent.value = 0;
  }

  function finish() {
    stop();
    if (result.value === 'error') {
      phase.value = 'error';
    } else {
      phase.value = 'success';
      completed(files.value, fields);
    }
  }

  function submit() {
    if (locked.value) {
      return;
    }
    attempted.value = true;
    if (Object.values(errors.value).some(Boolean)) {
      return;
    }
    phase.value = 'sending';
    percent.value = 0;
    // 仅供原型观察，不用于正式上传；真实实现使用公共层的字节进度
    timer = setInterval(() => {
      if (phase.value === 'processing') {
        stop();
        if (result.value !== 'processing') {
          finish();
        }
        return;
      }
      percent.value = Math.min(100, percent.value + 20);
      if (percent.value === 100) {
        phase.value = 'processing';
      }
    }, 500);
  }

  onScopeDispose(stop);
  return {
    visible, fields, files, phase, result, percent, attempted, busy, locked, errors, open, addFiles, reset, finish, submit
  };
}

export type UploadPreview = ReturnType<typeof useUploadPreview>;
