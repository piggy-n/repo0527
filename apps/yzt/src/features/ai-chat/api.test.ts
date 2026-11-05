import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttp, type HttpHooks } from '@/shared/http/configure';
import { AI_UNAUTHORIZED_MESSAGE } from './ai-client';
import {
  type ChatStreamEvent,
  deleteAiSession,
  excelDownloadUrl,
  fetchAiSessions,
  loginAi,
  parseStreamEvent,
  postChat,
  streamChat
} from './api';
import { useAiAuthStore } from './store';
import { chatResultBody, sseLine, sseResponse } from './test-data';

const server = setupServer();
const onError = vi.fn<NonNullable<HttpHooks['onError']>>();
const onUnauthorized = vi.fn<NonNullable<HttpHooks['onUnauthorized']>>();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  setActivePinia(createPinia());
  configureHttp({ onError, onUnauthorized });
});

afterEach(() => {
  server.resetHandlers();
  configureHttp({});
  onError.mockReset();
  onUnauthorized.mockReset();
});

afterAll(() => {
  server.close();
});

const input = { message: '江苏省农用地分类统计', sessionId: 'a1b2c3d4' };

describe('postChat', () => {
  it('按 data.json 的结构解析：图表、表格、步骤和用量，snake_case 转成界面用的字段', async () => {
    let body: unknown;
    server.use(
      mock.post('/ai-backend/api/chat', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(chatResultBody());
      })
    );

    const result = await postChat(input, new AbortController().signal);

    expect(body).toEqual({ message: input.message, session_id: input.sessionId });
    expect(result).toMatchObject({
      answer: '江苏省2022年农用地分类统计结果如下',
      geojson: null,
      chart: { title: '全表 DLBM 分类统计', type: 'bar', labels: ['0101 水田', '0102 水浇地'], valueLabel: '面积(亩)' },
      table: { columns: ['编码', '名称', '面积(亩)'] },
      excelUrl: '/api/exports/download/breakdown_全表_bgdc_dltb_2022_0670b837.xlsx',
      layerTag: '统计',
      stats: { durationMs: 964931, tokenCount: 981, tps: 1 },
      steps: [{ name: 'spatial_breakdown', status: 'succeeded', input: { group_field: 'DLBM' } }]
    });
  });

  it('分类为空的图表、没有行的表格都当作没有（data.json 第二条回答）', async () => {
    server.use(
      mock.post('/ai-backend/api/chat', () =>
        HttpResponse.json(
          chatResultBody({
            chart: { type: 'bar', x_axis: [], y_axis: [], y_label: '面积(亩)', title: '南京市 面积变化趋势' },
            table_data: { columns: ['年份'], rows: [] }
          })
        )
      )
    );

    const result = await postChat(input, new AbortController().signal);

    expect(result.chart).toBeNull();
    expect(result.table).toBeNull();
  });

  it('GeoJSON 统一成要素集合；不认识的图表类型按柱状图', async () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [118, 32],
          [119, 32],
          [119, 33],
          [118, 32]
        ]
      ]
    };
    server.use(
      mock.post('/ai-backend/api/chat', () =>
        HttpResponse.json(
          chatResultBody({ geojson: polygon, chart: { type: 'radar', x_axis: ['南京'], y_axis: [1] } })
        )
      )
    );

    const result = await postChat(input, new AbortController().signal);

    expect(result.geojson).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: polygon }]
    });
    expect(result.chart).toMatchObject({ type: 'bar', title: '', valueLabel: '' });
  });

  it('不是 GeoJSON 的 geojson 字段按返回格式不正确处理', async () => {
    server.use(mock.post('/ai-backend/api/chat', () => HttpResponse.json(chatResultBody({ geojson: { type: 'Map' } }))));

    await expect(postChat(input, new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid-response' });
    // 对话里显示失败原因，不弹全局提示
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('streamChat', () => {
  it('跨块的事件拼完整后依次交出，未知类型的事件跳过', async () => {
    const lines = [
      sseLine({ type: 'tool_start', name: 'spatial_breakdown', input: { admin_name: '南京市' } }),
      sseLine({ type: 'heartbeat' }),
      sseLine({ type: 'tool_end', name: 'spatial_breakdown', output: "content='{\"success\": false}'" }),
      sseLine({ type: 'token', content: '南京市', token_count: 3 }),
      sseLine({ type: 'done', ...chatResultBody({ answer: '南京市耕地' }) }),
      'data: [DONE]\n'
    ].join('');
    // 在一个事件的中间切开
    server.use(mock.post('/ai-backend/api/chat/stream', () => sseResponse([lines.slice(0, 40), lines.slice(40)])));
    const events: ChatStreamEvent[] = [];

    await streamChat(input, new AbortController().signal, event => events.push(event));

    expect(events.map(event => event.type)).toEqual(['tool_start', 'tool_end', 'token', 'done']);
    expect(events[0]).toEqual({ type: 'tool_start', name: 'spatial_breakdown', input: { admin_name: '南京市' } });
    expect(events[1]).toMatchObject({ type: 'tool_end', output: "content='{\"success\": false}'" });
    expect(events[2]).toEqual({ type: 'token', content: '南京市', tokenCount: 3, elapsedMs: undefined });
    expect(events[3]).toMatchObject({ type: 'done', result: { answer: '南京市耕地' } });
  });

  it('已知类型的事件格式不对时以 invalid-response 结束，不弹全局提示', async () => {
    server.use(
      mock.post('/ai-backend/api/chat/stream', () => sseResponse([sseLine({ type: 'token', text: '缺少 content' })]))
    );

    await expect(streamChat(input, new AbortController().signal, () => undefined)).rejects.toMatchObject({
      kind: 'invalid-response'
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('读取中取消：以 canceled 结束', async () => {
    server.use(
      mock.post('/ai-backend/api/chat/stream', () =>
        sseResponse([sseLine({ type: 'token', content: '南' })], { hold: true })
      )
    );
    const controller = new AbortController();
    const events: ChatStreamEvent[] = [];

    const reading = streamChat(input, controller.signal, event => {
      events.push(event);
      controller.abort();
    });

    await expect(reading).rejects.toMatchObject({ kind: 'canceled' });
    expect(events).toHaveLength(1);
  });
});

describe('parseStreamEvent', () => {
  it('不是 JSON 时抛错', () => {
    expect(() => parseStreamEvent('{')).toThrow(SyntaxError);
  });

  it('error 事件带上原因', () => {
    expect(parseStreamEvent('{"type":"error","message":"模型超时"}')).toEqual({ type: 'error', message: '模型超时' });
  });
});

describe('AI 后端的请求', () => {
  it('有 AI 的 token 时带上 Bearer，没有时不带；不带系统登录的 token', async () => {
    const authorizations: (string | null)[] = [];
    server.use(
      mock.get('/ai-backend/api/sessions', ({ request }) => {
        authorizations.push(request.headers.get('Authorization'));
        expect(request.headers.get('token')).toBeNull();
        expect(new URL(request.url).searchParams.get('limit')).toBe('50');
        return HttpResponse.json([]);
      })
    );

    await fetchAiSessions();
    useAiAuthStore().setToken('ai-token');
    await fetchAiSessions();

    expect(authorizations).toEqual([null, 'Bearer ai-token']);
  });

  it('历史对话加载失败：不弹全局提示，失败仍交给调用方', async () => {
    server.use(mock.get('/ai-backend/api/sessions', () => new HttpResponse(null, { status: 500 })));

    await expect(fetchAiSessions()).rejects.toMatchObject({ kind: 'http', status: 500 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('401 只提示 AI 服务未登录，不结束系统的登录会话', async () => {
    server.use(mock.delete('/ai-backend/api/sessions/a1b2c3d4', () => new HttpResponse(null, { status: 401 })));

    await expect(deleteAiSession('a1b2c3d4')).rejects.toMatchObject({
      kind: 'unauthorized',
      message: AI_UNAUTHORIZED_MESSAGE
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unauthorized' }));
  });

  it('连不上时按网络错误提示', async () => {
    server.use(mock.delete('/ai-backend/api/sessions/a1b2c3d4', () => HttpResponse.error()));

    await expect(deleteAiSession('a1b2c3d4')).rejects.toMatchObject({ kind: 'network' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('删除的返回体为空也算成功', async () => {
    server.use(mock.delete('/ai-backend/api/sessions/a1b2c3d4', () => new HttpResponse(null, { status: 204 })));

    await expect(deleteAiSession('a1b2c3d4')).resolves.toBeUndefined();
  });
});

describe('loginAi', () => {
  it('返回 token；失败时不弹全局提示', async () => {
    server.use(
      mock.post('/ai-backend/api/auth/login', async ({ request }) => {
        const body = await request.json();
        return body && typeof body === 'object' && 'password' in body && body.password === 'right'
          ? HttpResponse.json({ token: 'ai-token' })
          : new HttpResponse(null, { status: 401 });
      })
    );

    await expect(loginAi({ username: 'admin', password: 'right' })).resolves.toBe('ai-token');
    await expect(loginAi({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('excelDownloadUrl', () => {
  it('AI 后端给的路径补上 AI 的基础地址，完整地址不变', () => {
    expect(excelDownloadUrl('/api/exports/download/a.xlsx')).toBe(
      `${window.location.origin}/ai-backend/api/exports/download/a.xlsx`
    );
    expect(excelDownloadUrl('https://example.com/a.xlsx')).toBe('https://example.com/a.xlsx');
  });
});
