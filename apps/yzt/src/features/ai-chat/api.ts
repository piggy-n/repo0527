import type { GeoJSON } from 'geojson';
import { z } from 'zod';
import { aiRequest, aiStream, aiUrl } from './ai-client';
import { type ChatChart, type ChatResult, featureCollectionOf } from './chat-result';
import { outputSucceeded, type ToolStep } from './tool-steps';

// 结构按旧项目的代码和 views/ai-chat/data.json（AI 后端实际返回的回答）写，尚未联调核对，见 docs/modules/ai-chat.md

const inputSchema = z.record(z.string(), z.unknown());

// 已结束的步骤（data.json 的 steps）：status 实测只见过 done，成败看输出里的 success
const stepSchema = z
  .object({ tool: z.string(), input: inputSchema, output: z.string() })
  .transform(({ tool, input, output }): ToolStep => ({
    name: tool,
    input,
    status: outputSucceeded(output) ? 'succeeded' : 'failed',
    output
  }));

// 图表的类型只认这三种，其余按柱状图（沿用旧项目）；分类为空时没有图表（data.json 第二条回答）
const chartSchema = z
  .object({
    title: z.string().optional(),
    type: z.string(),
    x_axis: z.array(z.string()),
    y_axis: z.array(z.number()),
    y_label: z.string().optional()
  })
  .transform(({ title, type, x_axis, y_axis, y_label }): ChatChart | null => {
    if (x_axis.length === 0 || y_axis.length === 0) {
      return null;
    }
    return {
      title: title ?? '',
      type: type === 'line' || type === 'pie' ? type : 'bar',
      labels: x_axis,
      values: y_axis,
      valueLabel: y_label ?? ''
    };
  });

const tableSchema = z
  .object({ columns: z.array(z.string()), rows: z.array(z.record(z.string(), z.unknown())) })
  .transform(table => (table.columns.length > 0 && table.rows.length > 0 ? table : null));

const GEOJSON_TYPES = new Set([
  'FeatureCollection',
  'Feature',
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection'
]);

// 只确认是 GeoJSON 对象（type 是 GeoJSON 的类型之一），坐标交给 MapLibre 校验
function isGeoJson(value: unknown): value is GeoJSON {
  const parsed = z.object({ type: z.string() }).safeParse(value);
  return parsed.success && GEOJSON_TYPES.has(parsed.data.type);
}

const geojsonSchema = z.custom<GeoJSON>(isGeoJson, '不是 GeoJSON 对象').transform(featureCollectionOf);

/** 一次回答的完整结果：同步接口的返回体，也是 SSE 的 done 事件 */
const chatResultSchema = z
  .object({
    answer: z.string(),
    geojson: geojsonSchema.nullable(),
    chart: chartSchema.nullable(),
    table_data: tableSchema.nullable(),
    excel_url: z.string().nullable(),
    layer_tag: z.string().nullable(),
    duration_ms: z.number(),
    token_count: z.number(),
    tps: z.number(),
    steps: z.array(stepSchema)
  })
  .transform(
    (raw): ChatResult => ({
      answer: raw.answer,
      geojson: raw.geojson,
      chart: raw.chart,
      table: raw.table_data,
      excelUrl: raw.excel_url,
      layerTag: raw.layer_tag,
      stats: { durationMs: raw.duration_ms, tokenCount: raw.token_count, tps: raw.tps },
      steps: raw.steps
    })
  );

export type ChatStreamEvent =
  | { readonly type: 'tool_start'; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly type: 'tool_end'; readonly name: string; readonly output: string; readonly success?: boolean }
  | { readonly type: 'token'; readonly content: string; readonly tokenCount?: number; readonly elapsedMs?: number }
  | { readonly type: 'done'; readonly result: ChatResult }
  | { readonly type: 'error'; readonly message: string };

// SSE 的事件：字段取旧项目读取时优先用的那个，联调时核对
const streamEventSchemas = {
  tool_start: z
    .object({ name: z.string(), input: inputSchema.optional() })
    .transform(({ name, input }): ChatStreamEvent => ({ type: 'tool_start', name, input: input ?? {} })),
  tool_end: z
    .object({ name: z.string(), output: z.string().optional(), success: z.boolean().optional() })
    .transform(
      ({ name, output, success }): ChatStreamEvent => ({ type: 'tool_end', name, output: output ?? '', success })
    ),
  token: z
    .object({ content: z.string(), token_count: z.number().optional(), elapsed_ms: z.number().optional() })
    .transform(
      ({ content, token_count, elapsed_ms }): ChatStreamEvent => ({
        type: 'token',
        content,
        tokenCount: token_count,
        elapsedMs: elapsed_ms
      })
    ),
  done: chatResultSchema.transform((result): ChatStreamEvent => ({ type: 'done', result })),
  error: z.object({ message: z.string() }).transform(({ message }): ChatStreamEvent => ({ type: 'error', message }))
};

const eventTypeSchema = z.object({ type: z.string() });

function isEventType(type: string): type is keyof typeof streamEventSchemas {
  return Object.hasOwn(streamEventSchemas, type);
}

/** 解析一行 SSE 数据：未知类型的事件返回 null（跳过）；不是 JSON、已知类型却格式不对时抛错 */
export function parseStreamEvent(data: string): ChatStreamEvent | null {
  const json: unknown = JSON.parse(data);
  const { type } = eventTypeSchema.parse(json);
  return isEventType(type) ? streamEventSchemas[type].parse(json) : null;
}

export interface ChatInput {
  readonly message: string;
  readonly sessionId: string;
}

const chatBody = ({ message, sessionId }: ChatInput) => ({ message, session_id: sessionId });

/** 流式回答；对话里显示失败原因，所以不触发全局提示 */
export function streamChat(
  input: ChatInput,
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void
): Promise<void> {
  return aiStream('/api/chat/stream', {
    method: 'POST',
    body: chatBody(input),
    signal,
    silent: true,
    onData: data => {
      const event = parseStreamEvent(data);
      if (event) {
        onEvent(event);
      }
    }
  });
}

/** 同步回答：流式请求建立不起来时使用；回答可能要几分钟，不限时 */
export function postChat(input: ChatInput, signal: AbortSignal): Promise<ChatResult> {
  return aiRequest('/api/chat', {
    method: 'POST',
    body: chatBody(input),
    schema: chatResultSchema,
    signal,
    silent: true,
    timeout: null
  });
}

const sessionSchema = z.object({
  session_id: z.string(),
  title: z.string().nullish(),
  message_count: z.number(),
  last_time: z.string(),
  duration_ms: z.number().optional()
});

export type AiSession = z.infer<typeof sessionSchema>;

const SESSION_LIMIT = 50;

/** 历史对话；暂时无法联调，失败时不弹全局提示，失败状态仍交给调用方（docs/modules/ai-chat.md 的临时处理） */
export function fetchAiSessions(signal?: AbortSignal): Promise<AiSession[]> {
  return aiRequest('/api/sessions', {
    query: { limit: SESSION_LIMIT },
    schema: z.array(sessionSchema),
    signal,
    silent: true
  });
}

const sessionMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string().optional(),
  steps: z.array(stepSchema).optional(),
  duration_ms: z.number().optional(),
  token_count: z.number().optional(),
  tps: z.number().optional()
});

export type AiSessionMessage = z.infer<typeof sessionMessageSchema>;

export function fetchAiSessionMessages(sessionId: string, signal?: AbortSignal): Promise<AiSessionMessage[]> {
  return aiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    schema: z.array(sessionMessageSchema),
    signal
  });
}

export function deleteAiSession(sessionId: string): Promise<unknown> {
  return aiRequest(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', schema: z.unknown() });
}

export function deleteAllAiSessions(): Promise<unknown> {
  return aiRequest('/api/sessions', { method: 'DELETE', schema: z.unknown() });
}

export interface AiCredentials {
  readonly username: string;
  readonly password: string;
}

/** 登录 AI 后端，返回 token；账号来源待定，暂时没有调用方，失败时不弹全局提示（docs/modules/ai-chat.md 的待办） */
export async function loginAi(credentials: AiCredentials, signal?: AbortSignal): Promise<string> {
  const { token } = await aiRequest('/api/auth/login', {
    method: 'POST',
    body: credentials,
    schema: z.object({ token: z.string().min(1) }),
    signal,
    silent: true
  });
  return token;
}

/** Excel 的下载地址：完整地址直接用，AI 后端给的路径补上 AI 的基础地址 */
export function excelDownloadUrl(path: string): string {
  return /^(?:https?:)?\/\//i.test(path) ? path : aiUrl(path);
}
