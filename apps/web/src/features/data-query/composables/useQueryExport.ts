import { LatestController } from '@yzt/utils';
import { computed, type ComputedRef, getCurrentScope, onScopeDispose, readonly, type Ref, ref } from 'vue';
import { saveFile } from '@/shared/file-transfer';
import { type ExportFormat, exportResult } from '../api';
import type { QueryResult } from './useQueryResult';

/** 导出最后一次成功的查询（同旧页面）：导出的范围和地图、结果表一致，不受表单里没提交的修改影响 */
export interface QueryExport {
  readonly exporting: Readonly<Ref<boolean>>;
  /** 不能导出的原因；可以导出时为 null */
  readonly blocked: ComputedRef<string | null>;
  /** 上一次确认的格式，下次打开时默认选中；第一次是 Excel */
  readonly formats: Readonly<Ref<readonly ExportFormat[]>>;
  /** 读取文件并交给浏览器保存；导出中再调用不发请求。出错由全局提示，返回是否交给了浏览器 */
  readonly run: (formats: readonly ExportFormat[]) => Promise<boolean>;
}

export function useQueryExport(
  result: Pick<QueryResult, 'request' | 'layer' | 'initialLoading' | 'isError' | 'total'>
): QueryExport {
  if (!getCurrentScope()) {
    throw new Error('useQueryExport 只能在组件的 setup 或 effectScope 中调用');
  }
  const exporting = ref(false);
  const formats = ref<readonly ExportFormat[]>(['excel']);
  const downloads = new LatestController();
  onScopeDispose(() => downloads[Symbol.dispose]());

  const blocked = computed(() => {
    const request = result.request.value;
    if (request === null) {
      return '请先完成一次查询后再导出';
    }
    if (request.kind === 'attribute' && request.origin === 'advanced') {
      return '高级查询暂不支持导出';
    }
    if (result.initialLoading.value) {
      return '查询中';
    }
    return result.isError.value || result.total.value === 0 ? '当前查询结果为空，无可导出数据' : null;
  });

  return {
    exporting: readonly(exporting),
    blocked,
    formats: readonly(formats),
    run: async selected => {
      const request = result.request.value;
      const layer = result.layer.value;
      if (exporting.value || blocked.value !== null || request === null || layer === null) {
        return false;
      }
      formats.value = selected;
      const signal = downloads.next();
      exporting.value = true;
      try {
        const file = await exportResult(request, selected, layer.label, signal);
        if (signal.aborted) {
          return false;
        }
        saveFile(file);
        return true;
      } catch {
        // 取消的不提示，其余的已由全局提示
        return false;
      } finally {
        if (!signal.aborted) {
          exporting.value = false;
        }
      }
    }
  };
}
