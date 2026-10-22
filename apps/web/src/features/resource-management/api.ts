import { z } from 'zod';
import { http, type TransferProgress } from '@/shared/http/client';

// 按实际目录接口校验；空分组和叶子的 children 都可能为 null，层级由所在位置决定
const resourceDirectorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  code: z.string().nullish(),
  parentId: z.string().nullish(),
  icon: z.string().nullish(),
  iconSelected: z.string().nullish(),
  get children(): z.ZodOptional<z.ZodNullable<z.ZodArray<typeof resourceDirectorySchema>>> {
    return z.array(resourceDirectorySchema).nullable().optional();
  }
});

export type ResourceDirectory = z.infer<typeof resourceDirectorySchema>;

const resourceYearSchema = z.object({ label: z.string(), value: z.string() });

export type ResourceYear = z.infer<typeof resourceYearSchema>;

// 分页接口使用下划线字段名，年份为数字、enable 为字符串；界面只消费校验后的业务字段
const resourceRecordSchema = z.object({
  id: z.string().min(1),
  layer_name: z.string(),
  year: z.number().int().nullable(),
  dataset_name: z.string(),
  resource_name: z.string(),
  layer_code: z.string(),
  dataset_code: z.string(),
  slice: z.boolean(),
  enable: z.enum(['true', 'false'])
}).transform(row => ({
  id: row.id,
  name: row.layer_name,
  year: row.year,
  datasetName: row.dataset_name,
  resourceName: row.resource_name,
  layerCode: row.layer_code,
  datasetCode: row.dataset_code,
  hasSlice: row.slice,
  enabled: row.enable === 'true'
}));

export type ResourceRecord = z.infer<typeof resourceRecordSchema>;

// PageHelper 越界时会修正 pageNum；空列表的 pages 为 0，不能沿用文件管理的分页契约
const resourcePageSchema = z.object({
  list: z.array(resourceRecordSchema),
  total: z.number().int().nonnegative(),
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative()
});

export type ResourcePage = z.infer<typeof resourcePageSchema>;

export interface ResourcePageParams {
  /** 二级目录名称，接口不接收目录 ID */
  resource: string;
  pageNum: number;
  pageSize: number;
  layerName?: string;
  year?: string;
}

/** 目录顺序由后端决定；加载失败由目录面板展示并重试 */
export function fetchResourceDirectory(signal?: AbortSignal) {
  return http.get('/resource-center/tree', { schema: z.array(resourceDirectorySchema), signal, silent: true });
}

/** 年份保持接口的显示文本、值和顺序，不补造当前年份 */
export function fetchResourceYears(signal?: AbortSignal) {
  return http.get('/resource-center/year/list', { schema: z.array(resourceYearSchema), signal, silent: true });
}

/** POST 是分页读取，支持取消；错误交给列表状态展示，避免重复弹出提示 */
export function fetchResourcePage(params: ResourcePageParams, signal?: AbortSignal) {
  return http.post('/resource-management/layer/page', params, { schema: resourcePageSchema, signal, silent: true });
}

/** 目录写入的业务参数；成功只消费公共信封，不假设尚未确认的 data 形状 */
export type ResourceDirectoryChange =
  | { kind: 'add'; parentId: string; name: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'remove'; id: string };

/** 服务端写操作不随页面卸载取消；失败由目录弹窗呈现，401 仍由全局处理 */
export function changeResourceDirectory(change: ResourceDirectoryChange) {
  const options = { schema: z.unknown(), silent: true };
  if (change.kind === 'add') {
    return http.post('/resource-management/menu/add', {
      name: change.name,
      code: change.name,
      parentId: change.parentId,
      public: false,
      sort: 0,
      children: []
    }, options);
  }
  if (change.kind === 'rename') {
    return http.post('/resource-management/menu/edit', { id: change.id, name: change.name }, options);
  }
  return http.post('/resource-management/menu/delete', undefined, { ...options, query: { id: change.id } });
}

// 属性仅 name 可编辑；其余字段及尚未识别的扩展字段原样往返，不能在校验时剥离
const resourceAttributeSchema = z.looseObject({
  attrId: z.string().nullable(),
  name: z.string().nullable(),
  code: z.string(),
  fieldType: z.string(),
  fieldLength: z.string(),
  year: z.number().int().nullable()
});

export type ResourceAttribute = z.infer<typeof resourceAttributeSchema>;

// 2026-10-21、2026-10-22 实测的详情字段；数据来源是 submit_unit（旧页面读的 submitUnit 并不存在，显示为空）
const resourceDetailSchema = z.object({
  id: z.string().min(1),
  resourceName: z.string(),
  datasetName: z.string().nullish(),
  datasetCode: z.string().nullish(),
  // 同一数据集的图层代码，逗号分隔
  datasets: z.string().nullish(),
  year: z.number().int().nullable(),
  submit_unit: z.string().nullish(),
  layerName: z.string().nullish(),
  layerCode: z.string().nullish(),
  elementType: z.string().nullish(),
  layerRecord: z.number().int().nonnegative().nullish(),
  coordinate: z.string().nullish(),
  attributes: z.array(resourceAttributeSchema)
});

export type ResourceDetail = z.infer<typeof resourceDetailSchema>;

/** 详情和属性同源读取；校验响应身份，不能把另一资源的结构当作当前编辑目标 */
export function fetchResourceDetail(id: string, signal?: AbortSignal) {
  return http.get('/resource-management/layer/struct', {
    query: { id },
    schema: resourceDetailSchema.refine(detail => detail.id === id, '资源详情 ID 不匹配'),
    signal,
    silent: true
  });
}

export interface ResourceDetailChange {
  id: string;
  resourceName: string;
  attributes: ResourceAttribute[];
}

/** 保存数据分类和字段名称：资源 ID 和分类在 query 里，属性数组是正文（shared/http 两者可以同时传，不需要旧项目的兼容写法） */
export function saveResourceDetail(change: ResourceDetailChange) {
  return http.put('/resource-management/layer/edit-struct', change.attributes, {
    query: { id: change.id, resourceName: change.resourceName },
    schema: z.unknown(),
    silent: true
  });
}

/** 启用或停用图层；后端按 RequestParam 读取，状态是 query 里的字符串布尔值，没有正文 */
export function setResourceStatus(id: string, enabled: boolean) {
  return http.post('/resource-management/layer/status', undefined, {
    query: { id, status: enabled ? 'true' : 'false' },
    schema: z.unknown(),
    silent: true
  });
}

export interface ResourceExcelImport {
  file: File;
  year: number | null;
}

/** 导入属性规范 Excel；和旧页面一样只发 file 与详情的年份，不带图层 ID */
export function importResourceExcel(input: ResourceExcelImport, onUploadProgress?: (value: TransferProgress) => void) {
  const body = new FormData();
  body.append('file', input.file);
  if (input.year !== null) {
    body.append('year', String(input.year));
  }
  return http.post('/resource-management/layer/create-attribute-by-excel', body, {
    // 返回结构还没有实测，用户允许先只判断业务码；data 丢弃，不推断导入数量（docs/modules/resource-management.md）
    schema: z.unknown().transform(() => undefined),
    onUploadProgress,
    silent: true
  });
}
