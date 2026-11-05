import { computed, reactive, ref, shallowRef } from 'vue';
import type { TransferProgress } from '@/shared/http/client';
import { DEFAULT_CATEGORY_ID, fileTags, findCategoryPath } from '../categories';

/** sending：发送中；processing：已发完，等服务端处理（发送 100% 不等于上传成功） */
export type UploadPhase = 'draft' | 'sending' | 'processing' | 'success' | 'error';

const currentYear = () => new Date().getFullYear();

// 年份默认今年；分类由打开时所在的叶子决定
function emptyFields(categoryId: string) {
  return { categoryId, year: String(currentYear()), tag: '', remark: '' };
}

// 只能选到叶子：分类不存在或选了中间层级都不行
function isLeafCategory(id: string): boolean {
  const leaf = findCategoryPath(id).at(-1);
  return leaf !== undefined && !leaf.children;
}

/** 上传弹窗的草稿与窗口状态，正式上传和开发预览共用；不发请求，阶段由 useFileUpload 推进 */
export function useFileUploadForm() {
  const visible = ref(false);
  const fields = reactive(emptyFields(DEFAULT_CATEGORY_ID));
  const files = shallowRef<File[]>([]);
  const phase = ref<UploadPhase>('draft');
  const progress = shallowRef<TransferProgress | null>(null);
  const failure = ref('');
  // 点过一次提交才显示校验错误
  const attempted = ref(false);
  // 发送中关闭了窗口：草稿已丢弃，再打开时只显示这一批的进度
  const progressOnly = ref(false);
  const busy = computed(() => phase.value === 'sending' || phase.value === 'processing');
  // 发送中和成功后不能再改草稿，要先"继续上传"
  const locked = computed(() => busy.value || phase.value === 'success');
  const errors = computed(() => ({
    categoryId: isLeafCategory(fields.categoryId) ? '' : '请选择具体分类',
    year: /^\d{4}$/.test(fields.year) && Number(fields.year) <= currentYear() ? '' : '请选择有效年份',
    tag: fileTags.some(tag => tag === fields.tag) ? '' : '请选择业务类型标签',
    files: files.value.length > 0 ? '' : '请至少选择一个文件'
  }));

  function clearDraft(categoryId: string) {
    files.value = [];
    Object.assign(fields, emptyFields(categoryId));
    attempted.value = false;
  }

  /** 开始新的一批："继续上传"时调用，保留当前分类；发送中不可用 */
  function reset() {
    if (busy.value) {
      return;
    }
    clearDraft(fields.categoryId);
    progressOnly.value = false;
    phase.value = 'draft';
    progress.value = null;
    failure.value = '';
  }

  function open(categoryId: string) {
    if (!busy.value && !visible.value) {
      reset();
    }
    // 还没开始填写时，分类跟随当前浏览的分类
    if (files.value.length === 0 && phase.value === 'draft') {
      fields.categoryId = categoryId;
    }
    visible.value = true;
  }

  /** 关闭即丢弃草稿（用户确认的规则）；发送中的这一批继续，结果由入口提示 */
  function close() {
    visible.value = false;
    clearDraft(DEFAULT_CATEGORY_ID);
    if (busy.value) {
      progressOnly.value = true;
    } else {
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

  /** 提交前统一校验；发送中和成功后不再校验，也不改变状态 */
  function validate() {
    if (locked.value) {
      return false;
    }
    attempted.value = true;
    return !Object.values(errors.value).some(Boolean);
  }

  return {
    visible,
    fields,
    files,
    phase,
    progress,
    failure,
    attempted,
    progressOnly,
    busy,
    locked,
    errors,
    open,
    close,
    addFiles,
    removeFile,
    reset,
    validate
  };
}

export type FileUploadForm = ReturnType<typeof useFileUploadForm>;
