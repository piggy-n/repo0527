import { computed, reactive, ref, shallowRef } from 'vue';
import type { TransferProgress } from '@/shared/http/client';
import { DEFAULT_CATEGORY_ID, fileTags, findCategoryPath } from '../categories';

export type UploadPhase = 'draft' | 'sending' | 'processing' | 'success' | 'error';

/** 文件管理的上传草稿与窗口状态，正式上传和开发预览共用 */
export function useFileUploadForm() {
  const visible = ref(false);
  const fields = reactive({
    categoryId: DEFAULT_CATEGORY_ID, year: String(new Date().getFullYear()), tag: '', remark: ''
  });
  const files = shallowRef<File[]>([]);
  const phase = ref<UploadPhase>('draft');
  const progress = shallowRef<TransferProgress | null>(null);
  const failure = ref('');
  const attempted = ref(false);
  // 关闭会丢弃草稿，已发送的批次仅保留进度视图
  const progressOnly = ref(false);
  const busy = computed(() => phase.value === 'sending' || phase.value === 'processing');
  const locked = computed(() => busy.value || phase.value === 'success');
  const errors = computed(() => ({
    categoryId: !findCategoryPath(fields.categoryId).length || findCategoryPath(fields.categoryId).at(-1)?.children
      ? '请选择具体分类' : '',
    year: !/^\d{4}$/.test(fields.year) || Number(fields.year) > new Date().getFullYear() ? '请选择有效年份' : '',
    tag: fileTags.some(tag => tag === fields.tag) ? '' : '请选择业务类型标签',
    files: files.value.length ? '' : '请至少选择一个文件'
  }));

  function reset() {
    if (busy.value) {
      return;
    }
    files.value = [];
    Object.assign(fields, { year: String(new Date().getFullYear()), tag: '', remark: '' });
    progressOnly.value = false;
    phase.value = 'draft';
    attempted.value = false;
    progress.value = null;
    failure.value = '';
  }

  function open(categoryId: string) {
    if (!busy.value && !visible.value) {
      reset();
    }
    if (!files.value.length && phase.value === 'draft') {
      fields.categoryId = categoryId;
    }
    visible.value = true;
  }

  function close() {
    visible.value = false;
    files.value = [];
    Object.assign(fields, {
      categoryId: DEFAULT_CATEGORY_ID, year: String(new Date().getFullYear()), tag: '', remark: ''
    });
    attempted.value = false;
    progressOnly.value = busy.value;
    if (!busy.value) {
      reset();
    }
  }

  function addFiles(selected: File[]) {
    if (!locked.value) {
      files.value = [...files.value, ...selected];
      phase.value = 'draft';
    }
  }

  function removeFile(index: number) {
    if (!locked.value) {
      files.value = files.value.filter((_, at) => at !== index);
    }
  }

  /** 提交前统一校验，不改变正在发送的批次 */
  function validate() {
    if (locked.value) {
      return false;
    }
    attempted.value = true;
    return !Object.values(errors.value).some(Boolean);
  }

  return {
    visible, fields, files, phase, progress, failure, attempted, progressOnly, busy, locked, errors,
    open, close, addFiles, removeFile, reset, validate
  };
}

export type FileUploadForm = ReturnType<typeof useFileUploadForm>;
