import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import { canvasBlob, waitForExportFonts } from '../export/image-export';

/** 同一张图防重复导出，卸载只作废尚未交给浏览器的结果 */
export function useImageExport() {
  const pending = shallowRef<ReadonlySet<string>>(new Set());
  const error = ref('');
  const lifetime = new AbortController();
  onScopeDispose(() => lifetime.abort());

  async function run(key: string, create: (signal: AbortSignal) => Promise<HTMLCanvasElement>): Promise<Blob | null> {
    if (pending.value.has(key) || lifetime.signal.aborted) {
      return null;
    }
    pending.value = new Set(pending.value).add(key);
    error.value = '';
    try {
      const canvas = await create(lifetime.signal);
      lifetime.signal.throwIfAborted();
      const blob = await canvasBlob(canvas);
      lifetime.signal.throwIfAborted();
      return blob;
    } catch (reason) {
      if (!lifetime.signal.aborted) {
        error.value = reason instanceof Error ? reason.message : '图片导出失败，请重试';
      }
      return null;
    } finally {
      pending.value = new Set([...pending.value].filter(item => item !== key));
    }
  }

  return { pending: computed(() => pending.value), error, run, waitForFonts: waitForExportFonts };
}
