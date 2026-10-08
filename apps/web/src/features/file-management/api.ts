import { z } from 'zod';
import { http } from '@/shared/http/client';

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
