import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/http/errors';
import { deleteFile, fetchFilePage } from './api';
import { filePageResponse } from './test-data';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// 记录收到的查询参数
function mockFilePage(body: JsonBodyType = filePageResponse({ totalElements: 2 })) {
  const received: Record<string, string>[] = [];
  server.use(
    mock.get('/backend/file/page', ({ request }) => {
      received.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(body);
    })
  );
  return received;
}

describe('fetchFilePage', () => {
  it('未设置的筛选条件不出现在查询参数中', async () => {
    const received = mockFilePage();

    await fetchFilePage({ categoryId: 'policy-law-local', pageNo: 2, pageSize: 20, name: '政区' });

    expect(received).toEqual([{ categoryId: 'policy-law-local', pageNo: '2', pageSize: '20', name: '政区' }]);
  });

  it('按实测结构解析，丢弃未声明的字段', async () => {
    mockFilePage();

    const page = await fetchFilePage({ categoryId: 'technical-standard-current-survey', pageNo: 1, pageSize: 20 });

    expect(page).toEqual({
      pageNo: 1,
      pageSize: 20,
      totalElements: 2,
      totalPages: 1,
      content: [
        expect.objectContaining({ id: 'file-technical-standard-current-survey-1', remark: '备注' }),
        expect.objectContaining({ id: 'file-technical-standard-current-survey-2', remark: null })
      ]
    });
    expect(Object.keys(page.content[0] ?? {}).toSorted()).toEqual(
      ['categoryId', 'createdName', 'createdTime', 'id', 'name', 'objectKey', 'remark', 'size', 'tag', 'type', 'year'].toSorted()
    );
  });

  it('缺少 categoryId 时后端返回 400，抛出 ApiError', async () => {
    server.use(
      mock.get('/backend/file/page', () =>
        HttpResponse.json({ code: 400, msg: '请求参数缺失:categoryId', data: null }, { status: 400 })
      )
    );

    const error = await fetchFilePage({ categoryId: '', pageNo: 1, pageSize: 20 }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: '请求参数缺失:categoryId' });
  });
});

describe('deleteFile', () => {
  it('以 GET 传 id，成功时返回 null', async () => {
    const received: string[] = [];
    server.use(
      mock.get('/backend/file/delete', ({ request }) => {
        received.push(new URL(request.url).searchParams.get('id') ?? '');
        return HttpResponse.json({ code: 200, data: null, msg: '删除成功', success: true });
      })
    );

    await expect(deleteFile('file-1')).resolves.toBeNull();
    expect(received).toEqual(['file-1']);
  });

  it('文件不存在时是业务错误，带后端的提示', async () => {
    server.use(
      mock.get('/backend/file/delete', () =>
        HttpResponse.json({ code: 40000, data: null, msg: '文件不存在', success: false })
      )
    );

    const error = await deleteFile('missing').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'business', message: '文件不存在', code: 40000 });
  });
});
