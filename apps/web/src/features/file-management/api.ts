import { z } from 'zod';
import { fetchFile } from '@/shared/file-transfer';
import { http, type TransferProgress } from '@/shared/http/client';
import { filePreviewType, type FileTransferTarget } from './file-types';

// 字段按 2026-10-08 实测的返回确定（docs/migration.md）；bucket、createdId 等用不到的字段不声明，解析时丢弃
const fileRecordSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  // 含扩展名
  name: z.string(),
  // 小写扩展名，与 name 的后缀一致
  type: z.string(),
  // 字节
  size: z.number(),
  year: z.string(),
  tag: z.string(),
  remark: z.string().nullable(),
  objectKey: z.string(),
  createdName: z.string(),
  // YYYY-MM-DD HH:mm:ss
  createdTime: z.string()
});

export type FileRecord = z.infer<typeof fileRecordSchema>;

// 后端是 Spring Data 的分页结构；页码越界时返回最后一页的数据，但 pageNo 原样返回，以 totalPages 为准
const filePageSchema = z.object({
  content: z.array(fileRecordSchema),
  pageNo: z.number(),
  pageSize: z.number(),
  totalElements: z.number(),
  totalPages: z.number()
});

export type FilePage = z.infer<typeof filePageSchema>;

export interface FilePageParams {
  categoryId: string;
  pageNo: number;
  pageSize: number;
  // 模糊匹配；后端不去掉首尾空格，由调用方处理
  name?: string;
  year?: string;
  tag?: string;
}

/** 分页查询某个分类下的文件；未设置的筛选条件不传 */
export function fetchFilePage(params: FilePageParams, signal?: AbortSignal) {
  return http.get('/file/page', { schema: filePageSchema, query: { ...params }, signal });
}

/** 删除文件；后端用 GET，文件不存在时返回业务错误"文件不存在" */
export function deleteFile(id: string) {
  return http.get('/file/delete', { schema: z.null(), query: { id } });
}

/**
 * 读取文件内容，下载和预览共用；用旧项目实际调用的 /file/download（声明了但没有调用的 /file/preview 不迁移）。
 * 请求出错时不弹全局提示，由下载、预览各自显示
 */
export function fetchFileContent(
  file: FileTransferTarget,
  signal: AbortSignal,
  onProgress?: (progress: TransferProgress) => void
) {
  return fetchFile('/file/download', {
    query: { objectKey: file.objectKey },
    fallbackName: file.name,
    fallbackType: filePreviewType(file.type)?.mime,
    signal,
    onDownloadProgress: onProgress,
    silent: true
  });
}

export interface FileUploadInput {
  files: readonly File[];
  categoryId: string;
  year: string;
  tag: string;
  remark: string;
}

/** 一次提交一批文件，共用分类、年份、标签和备注；字段名和旧页面一致（重复追加 files，备注为空时不传） */
export function uploadFiles(input: FileUploadInput, onProgress?: (progress: TransferProgress) => void) {
  const body = new FormData();
  for (const file of input.files) {
    body.append('files', file, file.name);
  }
  body.append('categoryId', input.categoryId);
  body.append('year', input.year);
  body.append('tag', input.tag);
  const remark = input.remark.trim();
  if (remark) {
    body.append('remark', remark);
  }
  return http.post('/file/upload', body, {
    // 后端不可达时用户确认先只判断 code：返回的 data 丢弃，不推断部分成功；后端恢复后按真实返回收紧（docs/modules/file-management.md）
    schema: z.unknown().transform(() => undefined),
    onUploadProgress: onProgress,
    silent: true
  });
}
