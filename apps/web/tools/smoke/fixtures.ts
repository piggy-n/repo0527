import { expect, test as base } from 'playwright/test';

/** 固定账号的测试 JWT，签名只作占位，前端照常检查有效期 */
function sessionToken(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: 'smoke', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${header}.${payload}.signature`;
}

/** 每例使用独立上下文，所有业务接口在浏览器中拦截，不访问后端或公网 */
export const test = base.extend<{ localBackend: undefined }>({
  localBackend: [async ({ context, page, baseURL }, use) => {
    const unexpected: string[] = [];
    const unhandled: string[] = [];
    page.on('pageerror', error => unhandled.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseURL) {
        unexpected.push(`外部请求：${url.origin}${url.pathname}`);
        await route.abort('blockedbyclient');
        return;
      }
      if (!url.pathname.startsWith('/backend/')) {
        await route.continue();
        return;
      }
      let data: unknown;
      if (url.pathname === '/backend/user/login' && request.method() === 'POST') {
        data = { token: sessionToken(), loginName: 'smoke', realName: '冒烟测试', roleCode: 'user' };
      } else if (url.pathname === '/backend/resource-map/base/tree' && request.method() === 'GET') {
        // 空目录不请求业务瓦片，地图仍用真实引擎和构建内的省界 GeoJSON
        data = [];
      } else if (url.pathname === '/backend/file/page' && request.method() === 'GET') {
        data = { content: [], pageNo: 1, pageSize: 10, totalElements: 0, totalPages: 0 };
      } else {
        unexpected.push(`未模拟接口：${request.method()} ${url.pathname}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.fulfill({ json: { code: 200, data } });
    });
    await use(undefined);
    expect(unexpected, '不得访问后端、公网或未声明的接口').toEqual([]);
    expect(unhandled, '不得出现未处理的异常或 Promise 拒绝').toEqual([]);
  }, { auto: true }]
});

export { expect } from 'playwright/test';
