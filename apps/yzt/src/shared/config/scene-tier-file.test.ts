import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../http/errors';
import { fetchSceneTierSetting } from './scene-tier-file';

const server = setupServer();
const FILE_URL = '*/scene-tier.json';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('fetchSceneTierSetting', () => {
  it('读发布目录的文件，不经过 /backend，每次绕过缓存', async () => {
    const requests: URL[] = [];
    let body: JsonBodyType = { tier: 'high' };
    server.use(
      mock.get(FILE_URL, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(body);
      })
    );

    await expect(fetchSceneTierSetting()).resolves.toBe('high');
    body = { tier: 'auto' };
    await expect(fetchSceneTierSetting()).resolves.toBe('auto');
    expect(requests.map(url => url.pathname)).toStrictEqual(['/scene-tier.json', '/scene-tier.json']);
    expect(requests.every(url => url.searchParams.has('t'))).toBe(true);
  });

  it.each([
    ['文件缺失', () => new HttpResponse(null, { status: 404 })],
    ['nginx 回退成 index.html', () => HttpResponse.html('<!doctype html><title>现状图</title>')],
    ['不认识的档位', () => HttpResponse.json({ tier: 'ultra' })],
    ['没写档位', () => HttpResponse.json({})],
    ['网络失败', () => HttpResponse.error()]
  ])('%s：是 null（不是 auto），不抛错', async (_, respond) => {
    server.use(mock.get(FILE_URL, respond));
    using warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(fetchSceneTierSetting()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('请求被取消时照样抛出，不当成读取失败', async () => {
    server.use(mock.get(FILE_URL, () => HttpResponse.json({ tier: 'low' })));
    using warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = new AbortController();
    controller.abort();

    await expect(fetchSceneTierSetting(controller.signal)).rejects.toBeInstanceOf(ApiError);
    expect(warn).not.toHaveBeenCalled();
  });
});
