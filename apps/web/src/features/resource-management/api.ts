import { z } from 'zod';
import { http } from '@/shared/http/client';

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

const resourceDetailSchema = z.object({
  id: z.string().min(1),
  resourceName: z.string(),
  datasetName: z.string().nullish(),
  datasetCode: z.string().nullish(),
  datasets: z.string().nullish(),
  year: z.number().int().nullable(),
  submit_unit: z.string().nullish(),
  submitUnit: z.string().nullish(),
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

/** shared HTTP 同时支持 PUT query 和 JSON body，无需旧项目的兼容分支 */
export function saveResourceDetail(change: ResourceDetailChange) {
  return http.put('/resource-management/layer/edit-struct', change.attributes, {
    query: { id: change.id, resourceName: change.resourceName }, schema: z.unknown(), silent: true
  });
}

/** 后端按 RequestParam 读取启停状态，使用 POST query、字符串布尔值和空正文 */
export function setResourceStatus(id: string, enabled: boolean) {
  return http.post('/resource-management/layer/status', undefined, {
    query: { id, status: enabled ? 'true' : 'false' }, schema: z.unknown(), silent: true
  });
}
