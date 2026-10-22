import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http } from '@/shared/http/client';
import { ApiError } from '@/shared/http/errors';
import { deleteFile, fetchFileContent, fetchFilePage, uploadFiles } from './api';
import { filePageResponse } from './test-data';

const server = setupServer();

describe('fetchFileContent', () => {
  const file = { id: 'one', name: '后备.pdf', type: 'pdf', objectKey: '目录/文件 +1.pdf' };
  it('复用下载接口，准确传 objectKey，响应名优先，只补缺失 MIME', async () => {
    const received: string[] = [];
    server.use(mock.get('/backend/file/download', ({ request }) => {
      received.push(new URL(request.url).searchParams.get('objectKey') ?? '');
      return new HttpResponse('binary', { headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': "attachment; filename*=UTF-8''%E6%96%87%E6%A1%A3.pdf"
      } });
    }));
    const result = await fetchFileContent(file, new AbortController().signal);
    expect(received).toEqual([file.objectKey]);
    expect(result.fileName).toBe('文档.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(result.blob.size).toBe(6);
  });

  it('失败信封不能作为文件', async () => {
    server.use(mock.get('/backend/file/download', () => HttpResponse.json({ code: 40000, msg: '文件不存在' })));
    await expect(fetchFileContent(file, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'business', message: '文件不存在' });
  });
});

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

describe('uploadFiles', () => {
  const input = {
    files: [new File(['甲'], '说明甲.txt'), new File(['乙'], '说明乙.txt')],
    categoryId: 'policy-law-national', year: '2025', tag: '综合', remark: '  本批说明  '
  };

  it('重复 files 字段携带整批文件及元数据，不发送上传人', async () => {
    // 检查交给公共层的 FormData；jsdom 与 Node 的 File 不兼容，原生 multipart 由浏览器用例覆盖
    const post = vi.spyOn(http, 'post');
    server.use(mock.post('/backend/file/upload', () => HttpResponse.json({ code: 200 })));

    await expect(uploadFiles(input)).resolves.toBeUndefined();
    const body = post.mock.calls[0]?.[1];
    expect(body).toBeInstanceOf(FormData);
    const received = Array.from(body as FormData, ([name, value]) => ({
      name, value: typeof value === 'string' ? value : value.name
    }));
    expect(received).toEqual([
      { name: 'files', value: '说明甲.txt' }, { name: 'files', value: '说明乙.txt' },
      { name: 'categoryId', value: 'policy-law-national' }, { name: 'year', value: '2025' },
      { name: 'tag', value: '综合' }, { name: 'remark', value: '本批说明' }
    ]);
  });

  it('空备注不发送', async () => {
    const post = vi.spyOn(http, 'post');
    server.use(mock.post('/backend/file/upload', () => HttpResponse.json({ code: 200, data: null })));
    await uploadFiles({ ...input, remark: '  ' });
    const body = post.mock.calls[0]?.[1] as FormData;
    expect(Array.from(body.keys())).not.toContain('remark');
  });

  it.each([null, [], { succeeded: 1, failed: 1 }, '未知返回'])('暂不解释成功响应的 data：%j', async data => {
    server.use(mock.post('/backend/file/upload', () => HttpResponse.json({ code: 200, data })));
    await expect(uploadFiles(input)).resolves.toBeUndefined();
  });

  it.each([
    { body: { code: 500, msg: '上传失败' }, kind: 'business' },
    { body: { success: true }, kind: 'invalid-response' },
    { body: { code: '200' }, kind: 'invalid-response' }
  ])('拒绝失败或缺少有效 code 的响应：$kind', async ({ body, kind }) => {
    server.use(mock.post('/backend/file/upload', () => HttpResponse.json(body)));
    await expect(uploadFiles(input)).rejects.toMatchObject({ kind });
  });
});
